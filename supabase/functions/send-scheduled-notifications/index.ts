// Edge Function — send-scheduled-notifications
// Envoie les notifications PLANIFIÉES dues (ponctuelles ou périodiques) à tous les utilisateurs ayant
// activé les notifications. Appelée ~chaque minute par cron-job.org (même principe que
// `refresh-currency-rates`).
//
// Sécurité : déployée SANS vérif JWT (--no-verify-jwt). Protégée par un secret partagé `CRON_SECRET`
// (header `Authorization: Bearer <secret>`). Sans le bon secret → 401.
//
// Logique « est-ce dû maintenant ? » :
//   - kind='once'      → trigger_at <= now ET last_sent_at IS NULL → envoyer puis désactiver.
//   - kind='recurring' → l'heure LOCALE (timezone) a atteint time_of_day, le bon jour (selon la
//                        récurrence) ET pas déjà envoyé aujourd'hui (last_sent_at, jour local distinct).
//     Robuste si le cron rate une minute : ça part au 1er passage après l'heure cible, 1×/jour.
//
// Variables d'env :
//   - CRON_SECRET                : à définir (supabase secrets set CRON_SECRET=...)
//   - SUPABASE_URL               : injectée automatiquement
//   - SUPABASE_SERVICE_ROLE_KEY  : injectée automatiquement (bypass RLS)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendExpoPush, pruneDeadTokens, normalizeTokens, summarizePush } from '../_shared/expoPush.ts';
// Logique « c'est dû maintenant ? » PARTAGÉE avec les campagnes e-mail récurrentes (_shared/recurrence).
import { isRecurringDue } from '../_shared/recurrence.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// profile_ids correspondant à la cible d'une planif, ou null = pas de filtre (Tous).
async function profileIdsForTarget(supabase: any, s: any): Promise<string[] | null> {
  const kind = s.target_kind || 'all';
  if (kind === 'all') return null;
  if (kind === 'group') {
    if (!s.target_group_id) return [];
    const { data } = await supabase.from('user_group_members').select('profile_id').eq('group_id', s.target_group_id);
    return (data ?? []).map((r: any) => r.profile_id);
  }
  const { data } = await supabase.from('profiles').select('id').eq('is_premium', kind === 'premium');
  return (data ?? []).map((r: any) => r.id);
}

interface SendOutcome { targeted: number; accepted: number; failed: number; summary: string; configFailure: boolean }

async function sendPushToTarget(supabase: any, s: any): Promise<SendOutcome> {
  const ids = await profileIdsForTarget(supabase, s);
  let query = supabase
    .from('push_tokens')
    .select('token, profile_id, profiles!inner(notifications_enabled)')
    .eq('profiles.notifications_enabled', true);
  if (ids !== null) {
    if (ids.length === 0) return { targeted: 0, accepted: 0, failed: 0, summary: 'Aucun destinataire.', configFailure: false };
    query = query.in('profile_id', ids);
  }
  const { data, error } = await query;
  if (error) throw new Error(`lecture des jetons : ${error.message}`);
  const tokens = normalizeTokens((data ?? []).map((r: any) => r.token));
  /* La réponse d'Expo est LUE (cf. _shared/expoPush) : sans ça, une planification pouvait « partir »
     tous les mois sans que rien n'arrive, et le journal admin affichait fièrement le nombre
     d'appareils visés. Ce qu'on inscrit désormais, c'est le nombre d'envois ACCEPTÉS. */
  const r = await sendExpoPush(tokens, { title: s.title, body: s.body });
  await pruneDeadTokens(supabase, r.deadTokens);
  const summary = summarizePush(r);
  if (r.failed > 0) console.warn(`[send-scheduled] « ${s.title} » : ${summary}`);
  if (r.configFailure) {
    console.error('[send-scheduled] PANNE GLOBALE : Expo refuse tous les envois (credentials FCM/APNs du projet). Détail :', JSON.stringify(r.errors.slice(0, 3)));
  }
  return { targeted: tokens.length, accepted: r.accepted, failed: r.failed, summary, configFailure: r.configFailure };
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. Auth : secret partagé avec cron-job.org.
  const secret = Deno.env.get('CRON_SECRET');
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.headers.get('x-cron-secret') ??
    '';
  if (!secret || provided !== secret) return json({ error: 'unauthorized' }, 401);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const now = new Date();

    const { data: schedules, error } = await supabase
      .from('scheduled_notifications')
      .select('*')
      .eq('active', true);
    if (error) return json({ error: error.message }, 500);

    let fired = 0;
    const results: Array<{ id: string; title: string; targeted: number; accepted: number; failed: number }> = [];
    // Planifications dues qui n'ont RIEN pu envoyer — renvoyées dans la réponse HTTP pour que le
    // journal du cron (cron-job.org) montre la panne au lieu d'un « ok » trompeur.
    const failures: Array<{ id: string; title: string; reason: string }> = [];
    for (const s of schedules ?? []) {
      const due = s.kind === 'once'
        ? (!!s.trigger_at && new Date(s.trigger_at) <= now && !s.last_sent_at)
        : isRecurringDue(s, now);
      if (!due) continue;

      const outcome = await sendPushToTarget(supabase, s);
      let targetLabel = 'Tous';
      if (s.target_kind === 'premium') targetLabel = 'Premium';
      else if (s.target_kind === 'normal') targetLabel = 'Normal';
      else if (s.target_kind === 'group') {
        const { data: g } = await supabase.from('user_groups').select('name').eq('id', s.target_group_id).maybeSingle();
        targetLabel = g?.name ? `Groupe : ${g.name}` : 'Groupe';
      }

      /* Échec TOTAL (des appareils visés, aucun envoi accepté) : on NE marque PAS la planification
         comme envoyée. Le faire, c'était perdre l'occurrence — la notification mensuelle « partait »
         et l'utilisateur ne recevait rien jusqu'au mois suivant. On laisse donc le cron réessayer.
         La reprise est naturellement bornée : une périodique n'est due que le bon jour, et un envoi
         ponctuel finit par être abandonné au bout de 24 h (sinon il retenterait indéfiniment). */
      const totalFailure = outcome.accepted === 0 && outcome.failed > 0;
      const giveUp = s.kind === 'once'
        && !!s.trigger_at && (now.getTime() - new Date(s.trigger_at).getTime()) > 24 * 3600_000;

      if (totalFailure && !giveUp) {
        // Une seule trace par jour et par planification : sinon chaque passage du cron (toutes les
        // minutes) inonderait l'historique admin avec le même échec.
        const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
        const { count } = await supabase.from('admin_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('scheduled_id', s.id).gte('created_at', dayStart.toISOString());
        if ((count ?? 0) === 0) {
          await supabase.from('admin_notifications').insert({
            title: s.title, body: s.body, sent_count: 0,
            created_by: s.created_by ?? null, scheduled_id: s.id, source: s.kind, target_label: targetLabel,
          });
        }
        failures.push({ id: s.id, title: s.title, reason: outcome.summary });
        continue; // ni last_sent_at, ni désactivation : on retentera.
      }

      await supabase.from('admin_notifications').insert({
        title: s.title, body: s.body, sent_count: outcome.accepted,
        created_by: s.created_by ?? null, scheduled_id: s.id, source: s.kind, target_label: targetLabel,
      });
      const patch: Record<string, unknown> = { last_sent_at: now.toISOString() };
      if (s.kind === 'once') patch.active = false;   // ponctuel → une seule fois
      await supabase.from('scheduled_notifications').update(patch).eq('id', s.id);

      fired++;
      results.push({ id: s.id, title: s.title, targeted: outcome.targeted, accepted: outcome.accepted, failed: outcome.failed });
    }

    return json({ ok: true, processed: schedules?.length ?? 0, fired, results, failures });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
