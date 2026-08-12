/**
 * Rattachement d'une transaction MANUELLE à un projet personnel (saisie via l'écran Transaction).
 *
 * Un utilisateur qui saisit ses opérations à la main peut tenir son projet à jour sans repasser par
 * l'écran Projets : si sa saisie correspond à un projet EN COURS (mêmes comptes pour un virement,
 * même compte + catégorie pour une dépense), on lui propose de la rattacher. La transaction devient
 * alors une échéance du projet (progression, échéancier, mensualité recalculée en mode « date »).
 *
 * Module PUR (aucun accès réseau) — testé dans __tests__/projectMatch.test.ts.
 */
import { projectMode } from './projectTx';
import type { Project } from '../../types/database';

export interface ProjectMatchArgs {
  kind: 'transfer' | 'expense';
  accountId: string;
  /** Compte de destination (kind 'transfer'). */
  targetAccountId?: string | null;
  /** (Sous-)catégorie choisie (kind 'expense'). */
  categoryId?: string | null;
  projects: Project[];
  /** Avancement (%) par projet — depuis pilotage.projects_with_progress (dérivé des transactions). */
  progressPctById: Record<string, number>;
}

/**
 * Projets EN COURS correspondant à la saisie :
 *  - virement  → projet « Mettre de côté » (mode 'transfer') avec les MÊMES source + destination ;
 *  - dépense   → projet « Dépenser petit à petit » (mode 'spend') avec le MÊME compte + la MÊME catégorie.
 * Les projets « Conserver » (reserve) sont exclus : une réservation n'est pas une transaction saisie.
 * Un projet terminé (≥ 100 %) ou non actif (archivé/terminé) n'est jamais proposé.
 */
export function matchProjectsForTransaction(a: ProjectMatchArgs): Project[] {
  return a.projects.filter((p) => {
    if (p.status !== 'active') return false;
    const pct = a.progressPctById[p.id];
    if (pct != null && pct >= 100) return false;
    const mode = projectMode(p);
    if (a.kind === 'transfer') {
      return mode === 'transfer'
        && !!p.source_account_id && p.source_account_id === a.accountId
        && !!p.linked_account_id && p.linked_account_id === a.targetAccountId;
    }
    return mode === 'spend'
      && !!p.source_account_id && p.source_account_id === a.accountId
      && !!p.expense_category_id && p.expense_category_id === a.categoryId;
  });
}

/**
 * Mode « date cible » : nouvelle mensualité après un apport (le restant change → la mensualité
 * change, réparti sur les échéances restantes jusqu'à la date cible).
 * `null` = ne pas toucher (autre mode d'allocation, cible dépassée/du mois courant, ou mensualité
 * inchangée à 1 centime près).
 */
export function nextMonthlyAllocation(
  p: { allocation_type?: string | null; target_amount: number; target_date?: string | null; monthly_allocation: number },
  accumulatedAfter: number,
  todayISO: string,
): number | null {
  if (p.allocation_type !== 'date' || !p.target_date) return null;
  const [y1, m1] = todayISO.split('-').map(Number);
  const [y2, m2] = p.target_date.split('-').map(Number);
  // Échéances restantes = mois STRICTEMENT postérieurs au mois courant, jusqu'au mois cible inclus
  // (le mois courant est soit déjà pourvu — c'est l'apport qu'on vient de faire — soit passé).
  const monthsLeft = (y2 - y1) * 12 + (m2 - m1);
  if (monthsLeft <= 0) return null;
  const remaining = Math.max(0, p.target_amount - accumulatedAfter);
  const next = Math.round((remaining / monthsLeft) * 100) / 100;
  if (!Number.isFinite(next)) return null;
  return Math.abs(next - p.monthly_allocation) < 0.01 ? null : next;
}
