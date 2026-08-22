/**
 * Métriques de succès calculables côté client — SOURCE UNIQUE.
 *
 * Ces calculs servaient à DEUX endroits qui n'en faisaient pas le même usage :
 *   • `GamificationSync` : pour DÉBLOQUER les succès (écriture) ;
 *   • l'écran Succès : pour afficher la barre « 7/12 » (lecture).
 *
 * Ils étaient écrits deux fois, et pas à l'identique : l'écran Succès ne calculait que 5 des
 * 9 métriques (les 4 autres n'avaient donc jamais de barre de progression, sans raison visible pour
 * l'utilisateur) et refaisait son propre « mois suivant » à côté de `addMonthKey`. Deux
 * implémentations d'une même règle finissent toujours par diverger : la barre annonce alors une
 * progression qui ne correspond pas au seuil réellement testé au déblocage.
 *
 * Tout est PUR (aucun react-query, aucun Supabase) → testable en Node.
 */
import { addMonthKey } from '../finance/monthKeys';
import type { BadgeContext } from './gamification';

/** Ce dont on a besoin d'une transaction ici (le reste est ignoré). */
export interface MetricTransaction {
  amount: number | string;
  date?: string | null;
  is_draft?: boolean | null;
  account?: { type?: string | null } | null;
  linked_account?: { type?: string | null } | null;
}

/** Ce dont on a besoin d'une clôture ici. */
export interface MetricClosure {
  month_key: string;
  status?: 'confirmed' | 'estimated' | null;
}

/**
 * `invest_followed` : nombre de virements sortants d'un compte courant vers un compte
 * d'investissement (une reco « investir » suivie).
 * `surplus_months_streak` : mois PASSÉS consécutifs (en partant du plus récent) terminés à
 * solde net positif sur les comptes courants.
 */
export function transactionMetrics(transactions: readonly MetricTransaction[], now: Date = new Date()) {
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let investFollowed = 0;
  const netByMonth: Record<string, number> = {};
  for (const t of transactions) {
    if (t.is_draft) continue;
    if (t.account?.type !== 'checking') continue;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue; // une ligne corrompue ne doit pas empoisonner le cumul
    if (t.linked_account?.type === 'investment' && amt < 0) investFollowed += 1;
    const mk = (t.date ?? '').slice(0, 7);
    if (mk && mk < currentMonthKey) netByMonth[mk] = (netByMonth[mk] ?? 0) + amt;
  }

  const pastMonths = Object.keys(netByMonth).sort().reverse();
  let surplusStreak = 0;
  for (const mk of pastMonths) {
    if (netByMonth[mk] > 0) surplusStreak += 1;
    else break;
  }

  return { invest_followed: investFollowed, surplus_months_streak: surplusStreak };
}

/**
 * `closures_count` : nombre de mois RÉELLEMENT clôturés (statut `confirmed` — un mois `estimated`
 * a été auto-marqué faute de réponse, il n'a pas été clôturé par l'utilisateur).
 * `consecutive_closures` : la plus longue suite de mois consécutifs clôturés.
 */
export function closureMetrics(closures: readonly MetricClosure[]) {
  const confirmed = [...new Set(
    closures
      .filter((c) => (c.status ?? 'confirmed') === 'confirmed')
      .map((c) => c.month_key)
      .filter((k): k is string => typeof k === 'string' && /^\d{4}-\d{2}$/.test(k)),
  )].sort();

  let bestRun = 0;
  let run = 0;
  for (let i = 0; i < confirmed.length; i++) {
    run = i > 0 && addMonthKey(confirmed[i - 1], 1) === confirmed[i] ? run + 1 : 1;
    if (run > bestRun) bestRun = run;
  }
  return { closures_count: confirmed.length, consecutive_closures: bestRun };
}

/** Ancienneté du compte en jours (0 si la date est absente ou illisible). */
export function accountAgeDays(createdAt: string | null | undefined, now: Date = new Date()): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

export interface BadgeMetricsInput {
  transactions?: readonly MetricTransaction[];
  closures?: readonly MetricClosure[];
  createdAt?: string | null;
  /** Photo de profil TÉLÉVERSÉE (pas l'avatar Google seedé à la création). */
  profilePhoto?: boolean;
  /** Toutes les étapes du guide « Pour bien démarrer » sont faites. */
  onboardingDone?: boolean;
  now?: Date;
}

/**
 * Toutes les métriques calculables SANS l'état de gamification (séries, relyks cumulés). Ces
 * dernières sont relues à la source par `evaluate()` (plus fraîches que le cache) et ajoutées à
 * l'affichage par l'écran Succès.
 */
export function buildBadgeMetrics(input: BadgeMetricsInput): BadgeContext {
  const now = input.now ?? new Date();
  return {
    ...transactionMetrics(input.transactions ?? [], now),
    ...closureMetrics(input.closures ?? []),
    account_age_days: accountAgeDays(input.createdAt, now),
    profile_photo: input.profilePhoto ? 1 : 0,
    onboarding_done: input.onboardingDone ? 1 : 0,
  };
}
