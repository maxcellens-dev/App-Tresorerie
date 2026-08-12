// Module Crédit — MATÉRIALISATION des échéances échues (migration 143).
//
// Calcul PUR (testable) des échéances d'un crédit devenues réelles : chaque échéance échue du
// tableau d'amortissement (remboursement + assurance, dates distinctes possibles) devient une vraie
// transaction sur le compte de prélèvement. La fenêtre est bornée par credits.materialized_until
// (exclusif) et « aujourd'hui » (inclusif) — le passé antérieur à la borne reste porté par les
// vraies transactions / régularisations de l'utilisateur (anti double-compte).
import { computeAmortization, addMonthsISO } from './amortization';
import type { Credit } from '../../types/database';
import type { CreditEventRow } from '../../hooks/data/useCreditEvents';

export interface CreditOccurrence {
  credit_id: string;
  credit_kind: 'pay' | 'ins';
  credit_period: number;
  account_id: string;
  category_id: string | null;
  amount: number; // négatif (sortie), montant RÉEL complet — la pondération partagée reste aux agrégats
  date: string;
  note: string;
}

/**
 * Tableau COMPLET des échéances d'un crédit (toutes périodes, passées et futures) — publié en base
 * dans `credit_schedule` par le client du propriétaire : c'est ce cache que la RPC serveur
 * `materialize_credit_from_schedule` consomme pour matérialiser les échéances échues, y compris
 * quand c'est un AUTRE participant qui se connecte.
 * Retourne [] si le crédit n'est pas matérialisable (inactif, simulation, sans compte).
 */
export function computeCreditSchedule(
  c: Credit,
  events: CreditEventRow[] | null | undefined,
): CreditOccurrence[] {
  if (!c.is_active || c.is_simulation || !c.account_id) return [];
  const amort = computeAmortization({ ...c, events: events ?? null } as any);
  const insFirst = c.first_insurance_date || c.first_payment_date || c.start_date;
  // Mêmes catégories/libellés que les flux virtuels (useCreditFlows) : continuité visuelle parfaite.
  const repayCatName = c.category?.name ?? 'Crédits';
  const insCatName = c.insurance_category?.name ?? 'Assurance Crédit';
  const out: CreditOccurrence[] = [];
  for (const r of amort.schedule) {
    if (r.payment > 0) {
      out.push({
        credit_id: c.id, credit_kind: 'pay', credit_period: r.period,
        account_id: c.account_id, category_id: c.category_id ?? null,
        amount: -r.payment, date: r.date, note: `${repayCatName} — ${c.label}`,
      });
    }
    if (r.insurance > 0) {
      out.push({
        credit_id: c.id, credit_kind: 'ins', credit_period: r.period,
        account_id: c.account_id, category_id: c.insurance_category_id ?? null,
        amount: -r.insurance, date: addMonthsISO(insFirst, r.period - 1), note: `${insCatName} — ${c.label}`,
      });
    }
  }
  return out;
}

/** Échéances échues dans la fenêtre (fromExclusive, toInclusive] — même filtre que la RPC serveur. */
export function computeDueCreditOccurrences(
  c: Credit,
  events: CreditEventRow[] | null | undefined,
  fromExclusive: string,
  toInclusive: string,
): CreditOccurrence[] {
  if (fromExclusive >= toInclusive) return [];
  return computeCreditSchedule(c, events).filter((o) => o.date > fromExclusive && o.date <= toInclusive);
}

/**
 * Empreinte déterministe du tableau (djb2) — stockée sur credits.schedule_hash pour ne republier le
 * cache `credit_schedule` que quand le tableau change réellement (édition, événement, palier…).
 */
export function creditScheduleHash(occ: CreditOccurrence[]): string {
  let h = 5381;
  for (const o of occ) {
    const s = `${o.credit_kind}|${o.credit_period}|${o.date}|${o.amount.toFixed(2)}|${o.account_id}|${o.category_id ?? ''}|${o.note}`;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return `v1:${occ.length}:${h.toString(36)}`;
}
