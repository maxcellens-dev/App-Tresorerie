// Détection des CHANGEMENTS À VENIR (12 mois) pour l'instantané Conseils IA — fonction PURE
// (testable hors React). Voir hooks/useUserSnapshot.ts pour l'assemblage des données.
//
// ⚠ Sémantique des récurrences : la matérialisation crée de VRAIES lignes pour chaque occurrence
// passée (materialized_from = id du template, is_recurring=false) PUIS avance l'ancre (date) du
// template vers le futur. Une série vivante a donc TOUJOURS une ancre future → on ne peut pas la
// juger « nouvelle » sur sa seule date. On la compare aux occurrences PASSÉES (matérialisées).
import type { SnapshotUpcoming, SnapshotUpcomingChange } from './aiSnapshot';
import { isRegul } from '../finance/regul';

export interface UpcomingTx {
  id: string;
  date: string;                       // 'YYYY-MM-DD'
  amount: number;
  category_id?: string | null;
  linked_account_id?: string | null;
  is_draft?: boolean;
  regul_target?: number | null;
  /* Une régularisation ANCIENNE n'a pas de `regul_target` : elle ne se reconnaît qu'à sa note
     (cf. `isRegul`). Sans elle, un écart de solde était présenté à l'IA comme un engagement à
     venir ou une nouveauté du mois. */
  note?: string | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  recurrence_end_date?: string | null;
  materialized_from?: string | null;
  /** Type du compte porteur de la transaction ('checking' | 'savings' | ...). */
  accountType?: string | null;
}

export interface UpcomingOptions {
  today: string;                      // 'YYYY-MM-DD'
  /** type de compte par id (pour classer les virements selon leur destination). */
  acctTypeById: Record<string, string>;
  /** Libellé anonyme « Parent > Sous-catégorie ». */
  fullCat: (id: string | null | undefined) => string;
  /** true si un montant positif est un remboursement (catégorie de dépense) et non un revenu. */
  isRefund: (t: UpcomingTx) => boolean;
  /** Comptes joints en mode « contribution » : un virement récurrent vers eux = engagement foyer. */
  jointContribAcctIds?: Set<string>;
  /** Horizon en mois (défaut 12). */
  monthsAhead?: number;
}

function addMonths(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function detectUpcomingChanges(txs: UpcomingTx[], opts: UpcomingOptions): SnapshotUpcoming {
  const { today, acctTypeById, fullCat, isRefund } = opts;
  const jointContribAcctIds = opts.jointContribAcctIds ?? new Set<string>();
  const horizon = addMonths(today, opts.monthsAhead ?? 12);
  // Libellé anonyme : un virement vers un joint « contribution » est un engagement du foyer, pas
  // une catégorie vide (« Sans catégorie » n'apprend rien à l'IA sur ce flux structurant).
  const labelOf = (t: UpcomingTx): string =>
    t.linked_account_id && jointContribAcctIds.has(t.linked_account_id)
      ? 'Contribution au compte JOINT (engagement du foyer)'
      : fullCat(t.category_id);

  const isRecurringTpl = (t: UpcomingTx) => Boolean(t.is_recurring) && Boolean(t.recurrence_rule);
  // Série vivante : pas de fin, ou fin ≥ aujourd'hui ET ≥ ancre (une série tronquée voit son ancre
  // avancer AU-DELÀ de sa fin → morte même si sa fin est future).
  const isLiveSeries = (t: UpcomingTx) => {
    if (!isRecurringTpl(t)) return false;
    const end = t.recurrence_end_date ?? null;
    if (!end) return true;
    return end >= today && end >= t.date;
  };
  const kindOf = (t: UpcomingTx): SnapshotUpcomingChange['kind'] | null => {
    if (t.accountType !== 'checking') return null; // une seule jambe (côté courant)
    if (!t.linked_account_id) return Number(t.amount) < 0 ? 'expense' : 'income';
    const lt = acctTypeById[t.linked_account_id];
    if (Number(t.amount) < 0 && lt === 'savings') return 'transfer_saving';
    if (Number(t.amount) < 0 && lt === 'investment') return 'transfer_invest';
    return 'transfer_other';
  };

  // Occurrences RÉCURRENTES passées : template récurrent OU ligne matérialisée (materialized_from).
  // Les ponctuelles pures (sans materialized_from) ne « vieillissent » PAS un nouvel engagement.
  const catSig = (t: UpcomingTx, kind: string) => `${kind}|${t.category_id ?? 'x'}`;
  const establishedTplIds = new Set<string>();
  const pastRecurringCatSigs = new Set<string>();
  for (const t of txs) {
    if (t.is_draft || isRegul(t) || t.date > today) continue;
    if (!isRecurringTpl(t) && t.materialized_from == null) continue;
    if (t.materialized_from) establishedTplIds.add(t.materialized_from);
    const kind = kindOf(t);
    if (kind) pastRecurringCatSigs.add(catSig(t, kind));
  }
  const isEstablished = (t: UpcomingTx, kind: string) =>
    establishedTplIds.has(t.id) || pastRecurringCatSigs.has(catSig(t, kind));

  const endings: SnapshotUpcomingChange[] = [];
  const starts: SnapshotUpcomingChange[] = [];
  const oneOffs: SnapshotUpcoming['oneOffs'] = [];
  const seenEnd = new Set<string>();
  const seenStart = new Set<string>();
  for (const t of txs) {
    if (t.is_draft || isRegul(t)) continue;
    if (isRecurringTpl(t)) {
      if (!isLiveSeries(t)) continue; // série tronquée → ni fin ni nouveauté
      const kind = kindOf(t);
      if (!kind) continue;
      const dedup = `${kind}|${t.category_id ?? 'x'}|${t.recurrence_rule ?? ''}`;
      // Montant de BASE (pas l'override d'un mois précis).
      const amount = Math.abs(Number(t.amount));
      if (Math.round(amount) === 0) continue;
      const rule = String(t.recurrence_rule);
      const end = t.recurrence_end_date ?? null;
      if (end && end <= horizon && !seenEnd.has(dedup)) {
        seenEnd.add(dedup);
        endings.push({ kind, category: labelOf(t), amount, rule, ym: end.slice(0, 7) });
      }
      if (t.date > today && t.date <= horizon && !isEstablished(t, kind) && !seenStart.has(dedup)) {
        seenStart.add(dedup);
        starts.push({ kind, category: labelOf(t), amount, rule, ym: t.date.slice(0, 7) });
      }
    } else if (!t.linked_account_id && t.materialized_from == null && t.accountType === 'checking' && t.date > today && t.date <= horizon) {
      const abs = Math.abs(Number(t.amount));
      if (abs < 50) continue; // ponctuelles futures notables (hors occurrences matérialisées)
      oneOffs.push({ date: t.date, category: fullCat(t.category_id), amount: abs, income: Number(t.amount) > 0 && !isRefund(t) });
    }
  }
  endings.sort((a, b) => a.ym.localeCompare(b.ym));
  starts.sort((a, b) => a.ym.localeCompare(b.ym));
  oneOffs.sort((a, b) => a.date.localeCompare(b.date));
  return { endings: endings.slice(0, 10), starts: starts.slice(0, 10), oneOffs: oneOffs.slice(0, 8) };
}
