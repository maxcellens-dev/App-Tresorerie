// Supabase Edge Function — Notification ÉVÉNEMENTIELLE des admins.
// Déploiement :
//   supabase functions deploy notify-admins
//
// Déclenchée par l'app dès qu'un utilisateur GÉNÈRE quelque chose qui doit remonter aux admins
// (nouvelle demande d'assistance, nouvelle suggestion…). Pas de cron : c'est un push à l'INSERT.
//
// Pourquoi une Edge Function (rôle service) et pas un push direct côté client ?
//  → Un utilisateur normal n'a PAS le droit RLS de lire les push_tokens des admins, ni la table
//    admin_notification_prefs (réservée aux admins). On passe donc par le service role ici.
//
// Respecte admin_notification_prefs.push (par admin × par type). Si aucune préférence n'est
// enregistrée pour un admin, le push est ACTIVÉ par défaut (comportement « je reçois déjà »).
// Trace toujours l'événement dans admin_notifications (historique in-app), même push coupé.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendExpoPush, pruneDeadTokens, normalizeTokens, summarizePush } from '../_shared/expoPush.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type Kind = 'support' | 'suggestion' | 'ai_ticket' | 'crash';
const VALID_KINDS: Kind[] = ['support', 'suggestion', 'ai_ticket', 'crash'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // 1) Authentifier l'appelant : il doit être un utilisateur connecté (pas d'appel anonyme).
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const reqBody = await req.json().catch(() => ({}));
    const { kind, title, body } = reqBody;
    if (!VALID_KINDS.includes(kind)) return json({ error: 'invalid kind' }, 400);

    const admin = createClient(URL, SERVICE);

    let safeTitle: string, safeBody: string;
    if (kind === 'crash') {
      // Crash : config dédiée (app_config.crash_notify), THROTTLÉE (anti-boucle-de-crash multi-users).
      const { data: acfg } = await admin.from('app_config').select('crash_notify').eq('id', 'default').maybeSingle();
      const cfg = acfg?.crash_notify ?? {};
      if (cfg.enabled === false) return json({ ok: true, skipped: 'disabled' });
      const throttleMin = Math.max(1, Number(cfg.throttle_minutes ?? 30));
      const since = new Date(Date.now() - throttleMin * 60_000).toISOString();
      const { count: recent } = await admin.from('admin_notifications')
        .select('id', { count: 'exact', head: true }).eq('source', 'crash').gte('created_at', since);
      if ((recent ?? 0) > 0) return json({ ok: true, skipped: 'throttled' });
      const sub = (s: string) => String(s ?? '')
        .replaceAll('{kind}', String(reqBody.errKind ?? 'error'))
        .replaceAll('{platform}', String(reqBody.platform ?? '?'))
        .replaceAll('{version}', String(reqBody.version ?? '?'));
      safeTitle = (sub(cfg.title) || '🚨 Erreur détectée dans l\'app').slice(0, 120);
      safeBody = (sub(cfg.body) || 'Une erreur est remontée depuis l\'app.').slice(0, 240);
    } else {
      // Titre/message ÉDITABLES par l'admin (app_config.admin_notif_templates) — prioritaires sur ce que
      // le client envoie (le client ne fait que déclencher). Repli sur les valeurs reçues puis défaut.
      let tplTitle = '', tplBody = '';
      try {
        const { data: acfg } = await admin.from('app_config').select('admin_notif_templates').eq('id', 'default').maybeSingle();
        const tpl = (acfg?.admin_notif_templates ?? {})[kind] ?? {};
        tplTitle = String(tpl.title ?? '');
        tplBody = String(tpl.body ?? '');
      } catch { /* défaut ci-dessous */ }
      safeTitle = (tplTitle || String(title ?? '')).slice(0, 120) || 'Relyka — notification';
      safeBody = (tplBody || String(body ?? '')).slice(0, 240);
    }

    // 2) Liste des admins.
    const { data: admins } = await admin.from('profiles').select('id').eq('is_admin', true);
    const adminIds = (admins ?? []).map((a: any) => a.id).filter((id: string) => id !== user.id);

    // 3) Filtrer par préférence push (défaut = activé si aucune ligne enregistrée).
    let targetIds = adminIds;
    if (adminIds.length) {
      const { data: prefs } = await admin
        .from('admin_notification_prefs')
        .select('profile_id, push')
        .eq('kind', kind)
        .in('profile_id', adminIds);
      const prefMap = new Map((prefs ?? []).map((p: any) => [p.profile_id, p.push]));
      targetIds = adminIds.filter((id: string) => (prefMap.has(id) ? prefMap.get(id) === true : true));
    }

    // 4) Envoi push Expo aux appareils des admins ciblés (qui ont activé les notifications).
    //    La réponse d'Expo est LUE (cf. _shared/expoPush) : `sent` compte désormais les envois
    //    réellement acceptés, et non le nombre d'appareils auxquels on a bien voulu écrire.
    let sent = 0;
    let targeted = 0;
    let summary = 'Aucun admin ciblé.';
    if (targetIds.length) {
      const { data: toks } = await admin
        .from('push_tokens')
        .select('token, profiles!inner(notifications_enabled)')
        .eq('profiles.notifications_enabled', true)
        .in('profile_id', targetIds);
      const tokens = normalizeTokens((toks ?? []).map((t: any) => t.token));
      targeted = tokens.length;
      if (tokens.length) {
        const r = await sendExpoPush(tokens, { title: safeTitle, body: safeBody });
        await pruneDeadTokens(admin, r.deadTokens);
        sent = r.accepted;
        summary = summarizePush(r);
        if (r.failed > 0) console.warn(`[notify-admins] ${kind} : ${summary}`);
      }
    }

    // 5) Historique admin (toujours, même si push coupé). Le badge in-app vient des compteurs d'ouverts.
    await admin.from('admin_notifications').insert({
      title: safeTitle, body: safeBody, sent_count: sent, source: kind, target_label: 'Admins',
    });

    return json({ ok: true, sent, targeted, summary });
  } catch (e) {
    console.error('[notify-admins]', e);
    return json({ error: String(e) }, 500);
  }
});
