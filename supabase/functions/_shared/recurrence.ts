// ============================================================================
// recurrence — « cette planification est-elle due maintenant ? »
//
// Extrait de `send-scheduled-notifications` pour être PARTAGÉ avec les campagnes e-mail récurrentes.
// Une logique de calendrier recopiée dans deux fonctions finit toujours par diverger — et une
// divergence ici veut dire « la notification est partie mais pas l'e-mail », ou l'inverse, sans que
// personne comprenne pourquoi.
//
// Convention commune aux deux usages :
//   • l'heure est LOCALE au fuseau de la planification (`timezone`), pas UTC ;
//   • ça part au 1ᵉʳ passage APRÈS l'heure cible, une seule fois par jour — donc un cron qui rate
//     quelques minutes ne perd rien ;
//   • `day_of_month = 0` signifie « dernier jour du mois », résolu au dernier jour réel (28/29/30/31).
// ============================================================================

export interface RecurringSchedule {
  recurrence?: 'daily' | 'weekly' | 'monthly' | null;
  time_of_day?: string | null;   // 'HH:MM'
  day_of_week?: number | null;   // 0 = dimanche
  day_of_month?: number | null;  // 1-31, ou 0 = dernier jour du mois
  timezone?: string | null;
  last_sent_at?: string | null;
}

/** Parties d'une date dans un fuseau horaire donné. */
export function localParts(date: Date, tz: string) {
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

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month 1-12 → jour 0 du mois suivant = dernier jour
}

/** La planification périodique doit-elle partir maintenant ? */
export function isRecurringDue(s: RecurringSchedule, now: Date): boolean {
  const tz = s.timezone || 'Europe/Paris';
  const p = localParts(now, tz);
  const [th, tm] = String(s.time_of_day || '00:00').split(':').map(Number);
  const targetMin = (th || 0) * 60 + (tm || 0);
  if (p.hour * 60 + p.minute < targetMin) return false;          // heure cible pas encore atteinte
  if (s.recurrence === 'weekly' && p.weekday !== s.day_of_week) return false;
  if (s.recurrence === 'monthly') {
    const dom = s.day_of_month === 0
      ? daysInMonth(p.year, p.month)
      : Math.min(s.day_of_month || 1, daysInMonth(p.year, p.month));
    if (p.day !== dom) return false;
  }
  if (s.last_sent_at) {                                           // déjà parti aujourd'hui ?
    if (localParts(new Date(s.last_sent_at), tz).ymd === p.ymd) return false;
  }
  return true;
}

/** Résumé lisible d'une récurrence (« Tous les mois, le 1, à 09:00 »). */
export function describeRecurrence(s: RecurringSchedule): string {
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const at = s.time_of_day ?? '09:00';
  if (s.recurrence === 'weekly') return `Chaque ${days[s.day_of_week ?? 1]} à ${at}`;
  if (s.recurrence === 'monthly') {
    return s.day_of_month === 0
      ? `Le dernier jour du mois à ${at}`
      : `Le ${s.day_of_month ?? 1} de chaque mois à ${at}`;
  }
  return `Chaque jour à ${at}`;
}
