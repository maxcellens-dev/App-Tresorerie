/**
 * Investissement — plus/moins-values.
 * Une plus/moins-value est saisie comme une transaction SANS catégorie sur un compte
 * d'investissement, reconnaissable à sa note (« Plus-value », « Moins-value », « gain », « perte »).
 * Ce n'est donc ni un versement ni une dépense : c'est la variation de valeur du placement.
 *
 * Source unique : le détail de compte (saisie) et le Pouls (« combien ça t'a rapporté ») lisent la
 * MÊME définition — sinon les deux écrans annonceraient des totaux différents.
 */

export const INVESTMENT_GAIN_NOTE = 'Plus-value';
export const INVESTMENT_LOSS_NOTE = 'Moins-value';

/** true si la note d'une transaction désigne une plus/moins-value (et non un versement). */
export function isInvestmentGainLossNote(note: string | null | undefined): boolean {
  return !!note && /plus|moins|gain|perte/i.test(note);
}

export interface InvestmentTx {
  amount: number;
  note?: string | null;
  is_draft?: boolean | null;
  account?: { type?: string | null } | null;
  linked_account_id?: string | null;
}

/**
 * Bilan des investissements : ce qui a été VERSÉ (virements entrants), ce que ça a RAPPORTÉ
 * (somme des plus/moins-values) — le solde actuel vient des comptes, pas d'ici.
 */
export function computeInvestmentGains(transactions: InvestmentTx[]): { gains: number; deposits: number } {
  let gains = 0;
  let deposits = 0;
  for (const t of transactions) {
    if (t.is_draft) continue;
    if (t.account?.type !== 'investment') continue;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount)) continue;
    if (isInvestmentGainLossNote(t.note)) gains += amount;
    else if (amount > 0 && t.linked_account_id) deposits += amount; // jambe de crédit d'un virement
  }
  return { gains, deposits };
}
