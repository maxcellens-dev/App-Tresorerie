/**
 * Relyka World — le CALCUL des soldes entre participants, sans React ni Supabase.
 *
 * Ces trois fonctions décident de MONTANTS : ce que chacun a avancé, ce que chacun doit, et qui
 * rembourse qui à la fin. Une erreur y est invisible à la relecture et se solde par une dette
 * annoncée à la mauvaise personne. Elles vivaient dans `hooks/useRelykaWorld`, qui importe le
 * client Supabase — donc intestables en Node. Même extraction que `lib/closureForm` et
 * `lib/pilotageView` (cf. docs/PLAN_REFACTOR_TESTS.md).
 *
 * `hooks/useRelykaWorld` les réexporte : les écrans ne changent pas de chemin d'import.
 *
 * ── MULTI-DEVISES ────────────────────────────────────────────────────────────────────────────
 * Une DÉPENSE est libellée dans la devise où elle a réellement été payée (celle du compte utilisé,
 * celle du projet pour du cash) ; ses avances et ses parts le sont donc aussi. Le PROJET, lui, a
 * une devise unique — celle de tous ses totaux. D'où le convertisseur `toProject` : sans lui, on
 * écrivait « 40 CHF + 40 € = 80 » et les soldes étaient faux dès qu'un participant réglait depuis
 * un compte en devise étrangère.
 */

/** Réduit aux seuls champs dont le calcul a besoin (le hook fournit l'objet complet). */
export interface RwBalanceExpense {
  id: string;
  amount: number;
  paid_by: string;
  /** Devise de la dépense. Absente sur les lignes d'avant la migration 195 → devise du projet. */
  currency?: string | null;
}
export interface RwBalanceShare { expense_id: string; participant_id: string; amount: number }
export interface RwBalancePayer { expense_id: string; participant_id: string; amount: number }
export interface RwBalanceParticipant { id: string }

/**
 * Découpe `total` en `count` parts égales au centime près, l'arrondi tombant sur la PREMIÈRE part.
 * Sert à deux choses — proposer le partage égal, et reconnaître à la relecture qu'une répartition
 * enregistrée était bien égale (sans quoi rouvrir une dépense finement répartie l'aurait aplatie
 * au premier enregistrement).
 */
export function splitEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((total / count) * 100) / 100;
  const parts = Array.from({ length: count }, () => base);
  parts[0] = Math.round((base + (total - base * count)) * 100) / 100;
  return parts;
}

/**
 * Ce que chaque participant a AVANCÉ sur une dépense.
 *
 * Depuis la migration 184 une dépense peut avoir plusieurs payeurs (60 € par l'un, 40 € par
 * l'autre). Les lignes de `rw_expense_payers` font foi quand elles existent ; sinon on retombe sur
 * la colonne historique `paid_by`, qui porte alors la totalité. Les deux chemins cohabitent le
 * temps du déploiement, et l'historique n'a rien à rattraper.
 */
export function paidByParticipant<E extends RwBalanceExpense>(
  expense: E,
  payers: RwBalancePayer[],
): Array<{ participant_id: string; amount: number }> {
  const own = payers.filter((p) => p.expense_id === expense.id && p.amount > 0);
  return own.length
    ? own.map((p) => ({ participant_id: p.participant_id, amount: p.amount }))
    : [{ participant_id: expense.paid_by, amount: expense.amount }];
}

/** Solde net par participant : positif = on lui doit, négatif = il doit. */
export function computeBalances<E extends RwBalanceExpense>(
  participants: RwBalanceParticipant[],
  expenses: E[],
  shares: RwBalanceShare[],
  payers: RwBalancePayer[] = [],
  /** Ramène un montant de la devise de SA dépense vers celle du projet. Défaut : identité. */
  toProject: (amount: number, expense: E) => number = (amount) => amount,
): Map<string, number> {
  const net = new Map<string, number>();
  participants.forEach((p) => net.set(p.id, 0));
  const expenseById = new Map(expenses.map((e) => [e.id, e]));
  for (const e of expenses) {
    for (const p of paidByParticipant(e, payers)) {
      net.set(p.participant_id, (net.get(p.participant_id) ?? 0) + toProject(p.amount, e));
    }
  }
  for (const s of shares) {
    // Part dont la dépense est introuvable : on ne convertit pas au hasard, on prend le montant tel
    // quel (comportement d'avant la conversion). En pratique la cascade SQL l'empêche.
    const e = expenseById.get(s.expense_id);
    const amount = e ? toProject(s.amount, e) : s.amount;
    net.set(s.participant_id, (net.get(s.participant_id) ?? 0) - amount);
  }
  return net;
}

/** Suggestions de remboursement « qui paie qui » (algorithme glouton). */
export function settleUp(balances: { id: string; amount: number }[]): { from: string; to: string; amount: number }[] {
  const debtors = balances.filter((b) => b.amount < -0.005).map((b) => ({ ...b })).sort((a, b) => a.amount - b.amount);
  const creditors = balances.filter((b) => b.amount > 0.005).map((b) => ({ ...b })).sort((a, b) => b.amount - a.amount);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(-debtors[i].amount, creditors[j].amount);
    if (pay > 0.005) out.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(pay * 100) / 100 });
    debtors[i].amount += pay; creditors[j].amount -= pay;
    if (Math.abs(debtors[i].amount) < 0.005) i++;
    if (Math.abs(creditors[j].amount) < 0.005) j++;
  }
  return out;
}
