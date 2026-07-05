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

type Kind = 'support' | 'suggestion' | 'ai_ticket';
const VALID_KINDS: Kind[] = ['support', 'suggestion', 'ai_ticket'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // 1) Authentifier l'appelant : il doit être un utilisateur connecté (pas d'appel anonyme).
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { kind, title, body } = await req.json().catch(() => ({}));
    if (!VALID_KINDS.includes(kind)) return json({ error: 'invalid kind' }, 400);
    const safeTitle = String(title ?? '').slice(0, 120) || 'Relyka — notification';
    const safeBody = String(body ?? '').slice(0, 240);

    const admin = createClient(URL, SERVICE);

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
    let sent = 0;
    if (targetIds.length) {
      const { data: toks } = await admin
        .from('push_tokens')
        .select('token, profiles!inner(notifications_enabled)')
        .eq('profiles.notifications_enabled', true)
        .in('profile_id', targetIds);
      const tokens = [...new Set((toks ?? []).map((t: any) => t.token))]
        .filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
      sent = tokens.length;
      if (tokens.length) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(tokens.map((to) => ({ to, title: safeTitle, body: safeBody, sound: 'default' }))),
        });
      }
    }

    // 5) Historique admin (toujours, même si push coupé). Le badge in-app vient des compteurs d'ouverts.
    await admin.from('admin_notifications').insert({
      title: safeTitle, body: safeBody, sent_count: sent, source: kind, target_label: 'Admins',
    });

    return json({ ok: true, sent });
  } catch (e) {
    console.error('[notify-admins]', e);
    return json({ error: String(e) }, 500);
  }
});
