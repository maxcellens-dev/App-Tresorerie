// ============================================================================
// admin-push — envoi push ADMIN (immédiat / test) + diagnostic « Qui est joignable ».
//
// Déploiement :
//   supabase functions deploy admin-push
//   (vérif JWT ACTIVE : seul un admin connecté doit pouvoir appeler.)
//
// Pourquoi côté serveur alors que l'admin envoyait déjà depuis le navigateur ?
//   1. Le navigateur ne peut RIEN faire des jetons morts : `push_tokens` n'a pas de policy DELETE
//      pour les admins (063_notifications). Seul le rôle service peut purger.
//   2. Un envoi depuis le navigateur dépend du CORS d'exp.host et du réseau du poste admin ; toute
//      erreur y était avalée (`try { await fetch(...) } catch {}`), et l'écran annonçait quand même
//      « envoyé à N appareils ». On ne saura jamais, après coup, si un envoi est réellement parti.
//   3. La réponse d'Expo (les « tickets ») doit être lue et RENDUE À L'ADMIN. C'est tout l'objet de
//      `_shared/expoPush.ts`.
//
// Actions (POST, corps JSON) :
//   { action: 'diagnose' }                              → état de joignabilité de la base
//   { action: 'send',  target, title, body }            → envoi immédiat à une cible
//   { action: 'test',  title?, body? }                  → envoi à SES PROPRES appareils uniquement
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { sendExpoPush, pruneDeadTokens, normalizeTokens, summarizePush } from '../_shared/expoPush.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BREVO_KEYS = (Deno.env.get('BREVO_API_KEYS') ?? Deno.env.get('BREVO_API_KEY') ?? '')
  .split(/[\s,;\n]+/).map((k) => k.trim()).filter(Boolean);

type TargetKind = 'all' | 'premium' | 'normal' | 'group';
interface Target { kind: TargetKind; groupId?: string | null }

/** profile_ids d'une cible, ou `null` = pas de filtre (Tous). */
async function profileIdsForTarget(admin: any, target: Target): Promise<string[] | null> {
  if (!target || target.kind === 'all') return null;
  if (target.kind === 'group') {
    if (!target.groupId) return [];
    const { data } = await admin.from('user_group_members').select('profile_id').eq('group_id', target.groupId);
    return (data ?? []).map((r: any) => r.profile_id);
  }
  const { data } = await admin.from('profiles').select('id').eq('is_premium', target.kind === 'premium');
  return (data ?? []).map((r: any) => r.id);
}

/** Jetons joignables d'une cible : notifications activées ET jeton Expo plausible. */
async function tokensForTarget(admin: any, target: Target): Promise<string[]> {
  const ids = await profileIdsForTarget(admin, target);
  let q = admin.from('push_tokens')
    .select('token, profiles!inner(notifications_enabled)')
    .eq('profiles.notifications_enabled', true);
  if (ids !== null) {
    if (ids.length === 0) return [];
    q = q.in('profile_id', ids);
  }
  const { data, error } = await q;
  if (error) throw new Error(`lecture des jetons : ${error.message}`);
  return normalizeTokens((data ?? []).map((r: any) => r.token));
}

/**
 * Quota e-mail restant chez Brevo, clé par clé (`/v3/account`). Le plan gratuit est plafonné par
 * JOUR : c'est le chiffre qui dit si une campagne peut partir maintenant. Une clé injoignable ou
 * refusée est signalée telle quelle plutôt que comptée pour zéro sans explication.
 */
async function brevoQuota(): Promise<{ total: number | null; keys: Array<{ index: number; remaining: number | null; error?: string }> }> {
  if (!BREVO_KEYS.length) return { total: null, keys: [] };
  const keys: Array<{ index: number; remaining: number | null; error?: string }> = [];
  let total = 0;
  let anyOk = false;
  for (let i = 0; i < BREVO_KEYS.length; i++) {
    try {
      const r = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': BREVO_KEYS[i], accept: 'application/json' },
      });
      if (!r.ok) { keys.push({ index: i, remaining: null, error: `HTTP ${r.status}` }); continue; }
      const a = await r.json();
      // Brevo expose le crédit restant dans `plan[]` (type 'free' → `credits` = e-mails du jour).
      const plans: any[] = Array.isArray(a?.plan) ? a.plan : [];
      const credits = plans.reduce((s, p) => s + (Number(p?.credits) || 0), 0);
      keys.push({ index: i, remaining: credits });
      total += credits; anyOk = true;
    } catch (e) {
      keys.push({ index: i, remaining: null, error: String(e).slice(0, 120) });
    }
  }
  return { total: anyOk ? total : null, keys };
}

/** État de joignabilité de toute la base — ce que lit le panneau « Qui est joignable ». */
async function diagnose(admin: any) {
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, email, notifications_enabled, email_opt_in, is_premium');
  if (error) throw new Error(`lecture des profils : ${error.message}`);

  const { data: tokenRows, error: tErr } = await admin.from('push_tokens').select('profile_id, token, platform');
  if (tErr) throw new Error(`lecture des jetons : ${tErr.message}`);

  const devicesByProfile = new Map<string, number>();
  let malformed = 0;
  for (const r of (tokenRows ?? []) as any[]) {
    if (normalizeTokens([r.token]).length === 0) { malformed++; continue; }
    devicesByProfile.set(r.profile_id, (devicesByProfile.get(r.profile_id) ?? 0) + 1);
  }

  const all = (profiles ?? []) as any[];
  const pushReachable = all.filter((p) => p.notifications_enabled && (devicesByProfile.get(p.id) ?? 0) > 0);
  const hasEmail = all.filter((p) => typeof p.email === 'string' && p.email.includes('@'));
  const optedOut = hasEmail.filter((p) => p.email_opt_in === false);
  const emailReachable = hasEmail.filter((p) => p.email_opt_in !== false);
  // Ni push ni e-mail : personne ne peut les atteindre, quoi qu'on envoie.
  const unreachable = all.filter(
    (p) => !(p.notifications_enabled && (devicesByProfile.get(p.id) ?? 0) > 0)
        && !(typeof p.email === 'string' && p.email.includes('@') && p.email_opt_in !== false),
  );

  const quota = await brevoQuota();
  const name = (p: any) => p.email ?? p.id.slice(0, 8);

  return {
    users: all.length,
    push_reachable: pushReachable.length,
    push_disabled: all.filter((p) => !p.notifications_enabled).length,
    no_device: all.filter((p) => (devicesByProfile.get(p.id) ?? 0) === 0).length,
    malformed_tokens: malformed,
    email_reachable: emailReachable.length,
    email_opted_out: optedOut.length,
    email_missing: all.length - hasEmail.length,
    unreachable: unreachable.length,
    brevo: { keys: BREVO_KEYS.length, remaining_today: quota.total, per_key: quota.keys },
    // Listes dépliables du panneau. Volontairement bornées : ce panneau est un diagnostic, pas un export.
    lists: {
      push_reachable: pushReachable.slice(0, 200).map((p) => ({ id: p.id, label: name(p), devices: devicesByProfile.get(p.id) ?? 0 })),
      unreachable: unreachable.slice(0, 200).map((p) => ({
        id: p.id, label: name(p),
        reason: !p.notifications_enabled ? 'notifications coupées'
          : (devicesByProfile.get(p.id) ?? 0) === 0 ? 'aucun appareil enregistré'
          : 'e-mail manquant ou désinscrit',
      })),
      email_opted_out: optedOut.slice(0, 200).map((p) => ({ id: p.id, label: name(p) })),
    },
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  try {
    // Authentification : un admin CONNECTÉ, re-vérifié ici et jamais sur la foi du client.
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'unauthenticated' }, 401);
    const { data: isAdmin } = await asUser.rpc('is_app_admin');
    if (!isAdmin) return json({ error: 'forbidden' }, 403);

    const admin = createClient(URL_, SERVICE);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'send');

    if (action === 'diagnose') return json({ ok: true, ...(await diagnose(admin)) });

    const title = String(body.title ?? '').slice(0, 120);
    const message = String(body.body ?? '').slice(0, 240);
    if (!title && !message) return json({ error: 'titre ou message requis' }, 400);

    // ── Test : uniquement MES appareils. Le geste de diagnostic le plus simple — si ça n'arrive
    //    pas sur son propre téléphone, inutile de chercher du côté de l'audience. ──
    if (action === 'test') {
      const { data } = await admin.from('push_tokens').select('token').eq('profile_id', user.id);
      const tokens = normalizeTokens((data ?? []).map((r: any) => r.token));
      if (!tokens.length) {
        return json({
          ok: false, targeted: 0, accepted: 0, failed: 0, errors: [],
          summary: "Aucun appareil enregistré pour ton compte : ouvre l'app mobile et autorise les notifications.",
        });
      }
      const r = await sendExpoPush(tokens, { title: title || 'Test Relyka', body: message || 'Si tu lis ceci, les pushs fonctionnent.' });
      const pruned = await pruneDeadTokens(admin, r.deadTokens);
      return json({ ok: r.accepted > 0, targeted: tokens.length, accepted: r.accepted, failed: r.failed, errors: r.errors, pruned, config_failure: r.configFailure, summary: summarizePush(r) });
    }

    // ── Envoi immédiat à une cible. ──
    const target: Target = body.target ?? { kind: 'all' };
    const tokens = await tokensForTarget(admin, target);
    const r = await sendExpoPush(tokens, { title, body: message });
    const pruned = await pruneDeadTokens(admin, r.deadTokens);

    let targetLabel = 'Tous';
    if (target.kind === 'premium') targetLabel = 'Premium';
    else if (target.kind === 'normal') targetLabel = 'Normal';
    else if (target.kind === 'group') {
      const { data: g } = await admin.from('user_groups').select('name').eq('id', target.groupId).maybeSingle();
      targetLabel = g?.name ? `Groupe : ${g.name}` : 'Groupe';
    }
    // `sent_count` = les envois RÉELLEMENT acceptés par Expo, plus le nombre d'appareils visés :
    // l'historique admin doit refléter ce qui est parti, pas ce qu'on espérait envoyer.
    await admin.from('admin_notifications').insert({
      title, body: message, sent_count: r.accepted,
      created_by: user.id, source: 'manual', target_label: targetLabel,
    });

    return json({
      ok: r.accepted > 0 || tokens.length === 0,
      targeted: tokens.length, accepted: r.accepted, failed: r.failed,
      errors: r.errors.slice(0, 50), pruned, config_failure: r.configFailure,
      summary: summarizePush(r),
    });
  } catch (e) {
    console.error('[admin-push]', e);
    return json({ error: String(e) }, 500);
  }
});
