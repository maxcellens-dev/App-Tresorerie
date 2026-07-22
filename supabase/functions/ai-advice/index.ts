// Supabase Edge Function — Conseils IA (Lot A2).
// Déploiement :
//   supabase secrets set GEMINI_API_KEY=ta_cle
//   supabase functions deploy ai-advice
// La clé API n'apparaît JAMAIS côté client. Cette fonction : authentifie le user, vérifie le quota
// (mois) + le cap global (jour), assemble le prompt (template admin + instantané fourni par le client,
// déjà anonymisé), interroge Gemini avec BASCULE de modèles, stocke l'historique, crée un ticket si échec.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Historique RÉCENT d'une conversation (chat) : le modèle est sans état — sans ça, ses questions de
// relance perdent tout contexte au message suivant. Injecté via {{HISTORY}} dans le prompt chat_system.
async function conversationHistory(admin: any, conversationId: string | null): Promise<string> {
  if (!conversationId) return '(première question de la conversation)';
  const { data } = await admin.from('ai_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(10);
  const rows = (data ?? []).reverse();
  if (!rows.length) return '(première question de la conversation)';
  return rows
    .map((m: any) => `${m.role === 'user' ? 'Utilisateur' : 'Toi'} : ${String(m.content ?? '').slice(0, 800)}`)
    .join('\n---\n');
}

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Multi-clés : on peut configurer 2 (ou plus) clés API Gemini. On alterne pour répartir la charge et
// on bascule si l'une est épuisée/HS. Secrets : GEMINI_API_KEY (+ GEMINI_API_KEY_2 optionnelle).
const GEMINI_KEYS = [Deno.env.get('GEMINI_API_KEY'), Deno.env.get('GEMINI_API_KEY_2')].filter(Boolean) as string[];
// Clé PAYANTE dédiée (facturation Google activée) pour les requêtes RECHARGÉES : quotas énormes, pas de
// cap gratuit commun. Repli sur les clés gratuites si non configurée (le crédit reste décompté).
const GEMINI_PAID_KEYS = [Deno.env.get('GEMINI_API_KEY_PAID')].filter(Boolean) as string[];

// Notifie les ADMINS UNIQUEMENT (push Expo) qu'un conseil IA a échoué, et trace l'alerte dans
// l'historique admin (admin_notifications) pour qu'elle soit visible/gérable côté admin.
async function notifyAdmins(admin: any, body: string, pushEnabled: boolean) {
  const title = 'Conseils IA — ticket';
  try {
    let sent = 0;
    if (pushEnabled) {
      const { data: admins } = await admin.from('profiles').select('id').eq('is_admin', true);
      const ids = (admins ?? []).map((a: any) => a.id);
      if (ids.length) {
        const { data: toks } = await admin.from('push_tokens').select('token').in('profile_id', ids);
        const tokens = [...new Set((toks ?? []).map((t: any) => t.token))].filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
        sent = tokens.length;
        if (tokens.length) {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default' }))),
          });
        }
      }
    }
    // Historique admin (toujours, même push coupé). Le badge in-app vient du compte de tickets ouverts.
    await admin.from('admin_notifications').insert({ title, body, sent_count: sent, source: 'ai_ticket', target_label: 'Admins' });
  } catch { /* best effort */ }
}

async function callGemini(model: string, prompt: string, key: string): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // thinkingBudget:0 → désactive la « réflexion » des modèles 2.5 (sinon elle mange tout le budget
      // de tokens et la réponse est tronquée). maxOutputTokens large pour des analyses complètes.
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  if (!text.trim()) throw new Error('empty response');
  return text.trim();
}

// Essaie les modèles (ordre = bascule) × les clés API (alternées au hasard pour répartir la charge ;
// si une clé est épuisée/HS on passe à la suivante, puis au modèle suivant).
async function generateWithFallback(models: any[], prompt: string, keys: string[] = GEMINI_KEYS): Promise<{ reply: string; model: string; lastErr: string }> {
  const useKeys = keys.length ? keys : GEMINI_KEYS; // repli sur les clés gratuites si le jeu est vide
  const n = Math.max(1, useKeys.length);
  const start = Math.floor(Math.random() * n);
  let lastErr = 'no model';
  for (const m of models) {
    for (let k = 0; k < useKeys.length; k++) {
      const key = useKeys[(start + k) % useKeys.length];
      try { return { reply: await callGemini(m.id, prompt, key), model: m.id, lastErr: '' }; }
      catch (e) { lastErr = String(e); }
    }
  }
  return { reply: '', model: '', lastErr };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // 1) Qui est le user (via son JWT) ?
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'unauthenticated' }, 401);

  const admin = createClient(URL, SERVICE); // bypass RLS (lecture data + écriture historique)
  const body = await req.json().catch(() => ({}));
  const kind: string = body.kind === 'analysis' ? 'analysis' : 'chat';
  const analysisKey: string | null = kind === 'analysis' ? String(body.analysis_key ?? '') : null;
  const question: string = kind === 'chat' ? String(body.question ?? '').slice(0, 2000) : '';
  const snapshot: string = String(body.snapshot ?? '').slice(0, 20000);
  const wantedModel: string | undefined = body.model || undefined; // choix éventuel du user
  // Conversation (fil) à laquelle rattacher les messages. Le client en fournit toujours une.
  const conversationId: string | null = typeof body.conversation_id === 'string' ? body.conversation_id : null;

  // ── Test ADMIN : ping chaque modèle pour connaître sa disponibilité en temps réel (OK / 429 / 404…).
  if (body.admin_check_models === true) {
    const { data: callerIsAdmin } = await asUser.rpc('is_app_admin');
    if (!callerIsAdmin) return json({ error: 'forbidden' }, 403);
    const { data: acfg } = await admin.from('ai_config').select('models').single();
    // Ping chaque modèle sur un JEU DE CLÉS donné → dispo réelle (OK / 429 / 404 / 403…).
    const pingAll = async (keys: string[]) => {
      const out: { id: string; ok: boolean; status: number; reason: string }[] = [];
      for (const m of (acfg!.models as any[])) {
        let ok = false, status = 0, reason = 'Erreur';
        for (const key of keys) {
          try { await callGemini(m.id, 'ping', key); ok = true; reason = 'OK'; break; }
          catch (e) {
            const code = Number(String(e).match(/HTTP (\d+)/)?.[1] ?? 0);
            status = code;
            reason = code === 429 ? 'Quota épuisé' : code === 404 ? 'Modèle introuvable' : code === 503 ? 'Surchargé' : code === 403 ? 'Clé/API refusée' : 'Erreur';
          }
        }
        out.push({ id: m.id, ok, status: ok ? 200 : status, reason });
      }
      return out;
    };
    // Clés GRATUITES + (si configurée) clé PAYANTE, testées séparément.
    const results = await pingAll(GEMINI_KEYS);
    const paid = GEMINI_PAID_KEYS.length ? await pingAll(GEMINI_PAID_KEYS) : null;
    return json({ ok: true, results, paid, paid_configured: GEMINI_PAID_KEYS.length > 0 });
  }

  // ── Relance ADMIN : l'admin rejoue une requête échouée pour un user cible, SANS quota ni décompte.
  const adminRelaunch = body.admin_relaunch === true;
  if (adminRelaunch) {
    // is_app_admin() s'évalue sur auth.uid() = l'appelant → on le vérifie via le client authentifié.
    const { data: callerIsAdmin } = await asUser.rpc('is_app_admin');
    if (!callerIsAdmin) return json({ error: 'forbidden' }, 403);
    const targetUser: string = String(body.target_user ?? '');
    if (!targetUser) return json({ error: 'target_missing' }, 400);
    const akey = kind === 'analysis' ? analysisKey! : 'chat_system';
    const { data: pr } = await admin.from('ai_prompts').select('prompt_template').eq('key', akey).maybeSingle();
    if (!pr) return json({ error: 'prompt_missing' }, 500);
    // Conversation cible = celle du ticket (pour que la réponse arrive dans le bon fil + historique).
    let convId: string | null = typeof body.conversation_id === 'string' ? body.conversation_id : null;
    if (!convId && body.ticket_id) {
      const { data: tk } = await admin.from('ai_tickets').select('conversation_id').eq('id', body.ticket_id).maybeSingle();
      convId = (tk as any)?.conversation_id ?? null;
    }
    const fp = pr.prompt_template
      .replaceAll('{{SNAPSHOT}}', snapshot)
      .replaceAll('{{HISTORY}}', kind === 'chat' ? await conversationHistory(admin, convId) : '')
      .replaceAll('{{QUESTION}}', question);
    const { data: acfg } = await admin.from('ai_config').select('models').single();
    const { reply: rep, model: mdl, lastErr: le } = await generateWithFallback((acfg!.models as any[]).filter((x) => x.enabled), fp);
    if (!rep) return json({ ok: false, queued: true, error: le });
    await admin.from('ai_messages').insert({ profile_id: targetUser, role: 'assistant', content: rep, model: mdl, conversation_id: convId });
    if (body.ticket_id) await admin.from('ai_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', body.ticket_id);
    return json({ ok: true, reply: rep, model: mdl });
  }

  // 2) Config + droit d'accès + quota.
  const [{ data: cfg }, { data: featRow }, { data: profile }] = await Promise.all([
    admin.from('ai_config').select('*').eq('id', 'default').single(),
    admin.from('app_config').select('features').eq('id', 'default').maybeSingle(),
    admin.from('profiles').select('is_premium').eq('id', user.id).single(),
  ]);
  if (!cfg) return json({ error: 'config' }, 500);
  const features = (featRow?.features ?? {}) as Record<string, unknown>;
  // Le bouton est toujours visible côté app ; l'ACCÈS réel = Premium OU « Ouvrir à tous ».
  const premiumEnabled = !!features.premium_enabled;
  const isPremium = premiumEnabled && !!profile?.is_premium;
  // Crédits payants (achetés OU offerts par un admin) : utilisables MÊME sans Premium — l'utilisateur
  // les a acquis, il doit pouvoir les dépenser. On lit le solde AVANT le mur Premium.
  const { data: extraBal0 } = await admin.rpc('ai_extra_credits_balance', { p_user: user.id });
  const creditBalance = Number(extraBal0 ?? 0);
  if (!cfg.open_to_all && !isPremium && creditBalance <= 0) return json({ error: 'premium_required' }, 403);

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const limit = isPremium ? cfg.premium_monthly_limit : cfg.free_monthly_limit;
  // Décompte lu depuis le REGISTRE (non effaçable) → effacer l'historique ne rend pas de quota. Les
  // usages servis par la bascule payante éditeur (paid_fallback) ne comptent PAS dans le quota inclus.
  const { count: used } = await admin.from('ai_usage').select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id).eq('paid_fallback', false).gte('created_at', monthStart);
  // Routage des PREMIUM sur la clé PAYANTE dès leurs requêtes INCLUSES : leur usage (couvert par
  //    l'abonnement) est facturé sur la clé dédiée et ne tape PAS dans le pool gratuit partagé →
  //    le stock gratuit reste aux non-premium. (Sans clé payante configurée : repli sur le gratuit.)
  const isPremiumPaid = isPremium && GEMINI_PAID_KEYS.length > 0;

  // Quota mensuel épuisé → 1) crédits ACHETÉS s'il y en a ; 2) sinon, si la bascule payante auto est
  //    activée (cfg.paid_fallback_enabled), on continue sur la clé PAYANTE aux frais de l'éditeur
  //    (pas de crédit consommé, pas de mur) ; 3) sinon paywall.
  let usePaidCredit = false;   // consomme 1 crédit acheté par l'utilisateur
  let usePaidFallback = false; // clé payante, coût éditeur (phase de lancement)
  if ((used ?? 0) >= limit) {
    if (creditBalance > 0) usePaidCredit = true;      // crédits achetés/offerts (premium ou non)
    else if (cfg.paid_fallback_enabled) usePaidFallback = true;
    else return json({ error: 'quota_exceeded', used, limit, extra_credits: 0 }, 429);
  }
  // Toute requête sur la clé payante : premium inclus, crédits achetés, ou bascule éditeur.
  const usePaidKey = usePaidCredit || usePaidFallback || isPremiumPaid;

  // 3) Prompt : template admin + instantané (déjà anonymisé côté client) + historique de la
  //    conversation (chat) — AVANT l'insertion du message user pour ne pas l'inclure deux fois.
  const key = kind === 'analysis' ? analysisKey! : 'chat_system';
  const { data: prompt } = await admin.from('ai_prompts').select('prompt_template, title').eq('key', key).maybeSingle();
  if (!prompt) return json({ error: 'prompt_missing' }, 500);
  const finalPrompt = prompt.prompt_template
    .replaceAll('{{SNAPSHOT}}', snapshot)
    .replaceAll('{{HISTORY}}', kind === 'chat' ? await conversationHistory(admin, conversationId) : '')
    .replaceAll('{{QUESTION}}', question);
  const userContent = kind === 'analysis' ? `📊 ${prompt.title}` : question;

  // 4) Trace le message user (non décompté tant qu'on n'a pas de réponse), rattaché à la conversation.
  const { data: userMsg } = await admin.from('ai_messages')
    .insert({ profile_id: user.id, role: 'user', content: userContent, kind, analysis_key: analysisKey, counted: false, conversation_id: conversationId })
    .select('id').single();
  // Remonte la conversation en tête de liste (dernière activité).
  if (conversationId) await admin.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

  // 5) Cap global du jour (garde-fou quota gratuit Gemini) : ne compte QUE les requêtes du POOL
  //    GRATUIT (paid_key=false). Les requêtes sur la clé payante (premium, crédits, fallback) ne
  //    tapent pas dans ce pool et ignorent le cap.
  const { count: globalToday } = await admin.from('ai_usage').select('id', { count: 'exact', head: true })
    .eq('paid_key', false).gte('created_at', dayStart);
  const overGlobal = !usePaidKey && (globalToday ?? 0) >= cfg.daily_global_cap;

  // 6) Appel modèle avec bascule modèles × clés. Requête payée → clé PAYANTE dédiée (pas de cap commun).
  let models = (cfg.models as any[]).filter((m) => m.enabled);
  if (wantedModel) models = [...models.filter((m) => m.id === wantedModel), ...models.filter((m) => m.id !== wantedModel)];
  // Voie payante (premium inclus, crédits achetés/offerts, bascule éditeur) : clé PAYANTE d'abord,
  // puis REPLI sur les clés gratuites si la payante échoue (facturation lapsée → 403, quota → 429,
  // modèle non servi → 400). Sans ce repli, une clé payante HS fait échouer une requête que
  // l'utilisateur a POURTANT payée (ou qu'un admin a offerte pour test) → ticket au lieu de réponse.
  const keysToUse = usePaidKey
    ? [...new Set([...GEMINI_PAID_KEYS, ...GEMINI_KEYS])]
    : GEMINI_KEYS;
  const gen = overGlobal ? { reply: '', model: '', lastErr: 'daily_global_cap' } : await generateWithFallback(models, finalPrompt, keysToUse);
  const reply = gen.reply, modelUsed = gen.model;

  // 7a) Échec → ticket admin (relance gratuite plus tard), le user sera notifié. Pas de décompte.
  if (!reply) {
    await admin.from('ai_tickets').insert({
      profile_id: user.id, user_message_id: userMsg?.id ?? null, conversation_id: conversationId,
      request: { kind, analysis_key: analysisKey, question, snapshot }, error: gen.lastErr, status: 'open',
    });
    await notifyAdmins(admin, 'Une demande de conseil a échoué et attend une relance.', cfg.notify_admins_push !== false);
    return json({ ok: false, queued: true });
  }

  // 7b) Succès → réponse + décompte. Requête PAYÉE → on consomme 1 crédit du ledger (delta -1) et on ne
  //     touche PAS le quota mensuel. Requête incluse → registre d'usage mensuel (non effaçable).
  await admin.from('ai_messages').insert({ profile_id: user.id, role: 'assistant', content: reply, model: modelUsed, conversation_id: conversationId });
  await admin.from('ai_messages').update({ counted: true }).eq('id', userMsg!.id);
  if (usePaidCredit) {
    await admin.from('ai_extra_credits').insert({ profile_id: user.id, delta: -1, reason: 'consumption', ref: userMsg?.id ?? null });
    const { data: bal } = await admin.rpc('ai_extra_credits_balance', { p_user: user.id });
    return json({ ok: true, reply, model: modelUsed, used, limit, paid: true, extra_credits: Number(bal ?? 0) });
  }
  if (usePaidFallback) {
    // Bascule payante éditeur : pas de crédit consommé, pas de décompte mensuel (déjà au-delà). On
    // trace tout de même l'usage (hors quota, sur clé payante) pour suivre le volume/coût.
    await admin.from('ai_usage').insert({ profile_id: user.id, kind, paid_fallback: true, paid_key: true });
    return json({ ok: true, reply, model: modelUsed, used, limit, paid: true });
  }
  // Requête INCLUSE (décomptée du quota mensuel). paid_key=true pour un premium (clé facturée, hors
  // pool gratuit) → n'entame pas le stock gratuit des non-premium.
  await admin.from('ai_usage').insert({ profile_id: user.id, kind, paid_key: isPremiumPaid });
  return json({ ok: true, reply, model: modelUsed, used: (used ?? 0) + 1, limit });
});
