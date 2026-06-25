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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Parties d'une date dans un fuseau horaire donné.
function localParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month 1-12 → jour 0 du mois suivant = dernier jour
}

function isRecurringDue(s: any, now: Date): boolean {
  const tz = s.timezone || 'Europe/Paris';
  const p = localParts(now, tz);
  const [th, tm] = String(s.time_of_day || '00:00').split(':').map(Number);
  const targetMin = (th || 0) * 60 + (tm || 0);
  if (p.hour * 60 + p.minute < targetMin) return false;          // heure cible pas encore atteinte
  if (s.recurrence === 'weekly' && p.weekday !== s.day_of_week) return false;
  if (s.recurrence === 'monthly') {
    // day_of_month = 0 → « dernier jour du mois » (résolu au dernier jour réel).
    const dom = s.day_of_month === 0 ? daysInMonth(p.year, p.month) : Math.min(s.day_of_month || 1, daysInMonth(p.year, p.month));
    if (p.day !== dom) return false;
  }
  if (s.last_sent_at) {                                           // déjà envoyé aujourd'hui ?
    if (localParts(new Date(s.last_sent_at), tz).ymd === p.ymd) return false;
  }
  return true;
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

async function sendPushToTarget(supabase: any, s: any): Promise<number> {
  const ids = await profileIdsForTarget(supabase, s);
  let query = supabase
    .from('push_tokens')
    .select('token, profile_id, profiles!inner(notifications_enabled)')
    .eq('profiles.notifications_enabled', true);
  if (ids !== null) {
    if (ids.length === 0) return 0;
    query = query.in('profile_id', ids);
  }
  const { data } = await query;
  const title = s.title; const body = s.body;
  const tokens = [...new Set((data ?? []).map((r: any) => r.token))]
    .filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')) as string[];
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE).map((to) => ({ to, title, body, sound: 'default' }));
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch (e) {
      console.warn('[send-scheduled] envoi Expo échoué (lot ignoré):', e);
    }
  }
  return tokens.length;
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
    const results: Array<{ id: string; title: string; devices: number }> = [];
    for (const s of schedules ?? []) {
      const due = s.kind === 'once'
        ? (!!s.trigger_at && new Date(s.trigger_at) <= now && !s.last_sent_at)
        : isRecurringDue(s, now);
      if (!due) continue;

      const devices = await sendPushToTarget(supabase, s);
      let targetLabel = 'Tous';
      if (s.target_kind === 'premium') targetLabel = 'Premium';
      else if (s.target_kind === 'normal') targetLabel = 'Normal';
      else if (s.target_kind === 'group') {
        const { data: g } = await supabase.from('user_groups').select('name').eq('id', s.target_group_id).maybeSingle();
        targetLabel = g?.name ? `Groupe : ${g.name}` : 'Groupe';
      }
      await supabase.from('admin_notifications').insert({
        title: s.title, body: s.body, sent_count: devices,
        created_by: s.created_by ?? null, scheduled_id: s.id, source: s.kind, target_label: targetLabel,
      });
      const patch: Record<string, unknown> = { last_sent_at: now.toISOString() };
      if (s.kind === 'once') patch.active = false;   // ponctuel → une seule fois
      await supabase.from('scheduled_notifications').update(patch).eq('id', s.id);

      fired++;
      results.push({ id: s.id, title: s.title, devices });
    }

    return json({ ok: true, processed: schedules?.length ?? 0, fired, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
