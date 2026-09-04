/**
 * Apport « actuel » d'un compte d'investissement, DÉRIVÉ chronologiquement des transactions.
 * Base = apport à la création (initial_contributed) ; chaque apport/virement entrant l'augmente ;
 * chaque retrait (virement sortant) en retire la part de capital selon la règle du prorata.
 * Comme c'est calculé à la volée, l'ajout/la modification/la suppression d'une transaction
 * est automatiquement reflété (pas de valeur figée à resynchroniser).
 *
 * Retourne null si non suivi (compte non-investissement ou aucun apport de base défini).
 */
import { isInvestmentDeposit } from './investment';
import { isWealthRegul } from './regul';

interface TxLike {
  account_id: string;
  amount: number;
  date: string;
  is_draft?: boolean | null;
  linked_account_id?: string | null;
  note?: string | null;
  /** Marqueur de nature (migration 196) — prime toujours sur le libellé. */
  investment_kind?: string | null;
  /** Mise à jour de solde d'un compte d'épargne / d'investissement (migration 223). */
  regul_kind?: string | null;
}

interface AccountLike {
  id: string;
  type: string;
  balance: number;
  initial_contributed?: number | null;
}

/** Date du jour (locale) au format YYYY-MM-DD — même référentiel que le solde « à date ». */
function localTodayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function computeContributed(
  account: AccountLike,
  txs: TxLike[],
  opts?: { estimateBaseWhenMissing?: boolean },
): number | null {
  if (account.type !== 'investment') return null;

  // Apport « actuel » = à date : on ne compte que les mouvements ÉCHUS (date ≤ aujourd'hui),
  // exactement comme le solde du compte. Inclure des apports/virements datés dans le futur
  // surévaluerait l'apport (l'argent n'est pas encore entré).
  const today = localTodayISO();
  const accTxs = txs
    .filter((t) => t.account_id === account.id && !t.is_draft && t.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sumAll = accTxs.reduce((s, t) => s + Number(t.amount), 0);
  // Valeur du compte avant toute transaction (solde actuel − somme des transactions).
  const preTxValue = Number(account.balance) - sumAll;

  let base = account.initial_contributed;
  if (base == null) {
    // Sans apport de base défini : « non suivi » par défaut (null). Avec l'option d'estimation,
    // on considère la valeur AVANT toute transaction comme du capital apporté → les +/- values
    // (mouvements ni apport ni retrait) n'augmentent jamais l'apport, seulement la valeur.
    if (!opts?.estimateBaseWhenMissing) return null;
    base = Math.max(0, preTxValue);
  }

  let value = preTxValue;
  let apport = base;

  for (const t of accTxs) {
    const amt = Number(t.amount);
    /* Un virement ENTRANT est un apport par nature (il vient d'un autre compte). Pour une saisie
       directe, c'est le MARQUEUR qui tranche (`investment_kind`, migration 196) — plus le libellé :
       renommer sa plus-value la faisait basculer en apport, ce qui gonflait le capital investi et
       écrasait la performance affichée du compte. Le repli par libellé ne sert plus qu'aux lignes
       d'avant la migration (cf. lib/finance/investment). */
    /* MISE À JOUR DE SOLDE (migration 223) : « j'ai versé 500 € sans le noter ». Elle vaut virement
       — entrant si positive, sortant si négative — donc apport de capital dans un sens, retrait au
       prorata dans l'autre. La traiter comme une plus-value aurait affiché une performance qui n'a
       jamais eu lieu : le capital serait resté au même niveau pendant que la valeur montait. */
    const wealth = isWealthRegul(t);
    const isDepositIn = amt > 0 && (!!t.linked_account_id || wealth || isInvestmentDeposit(t));
    const isWithdrawal = amt < 0 && (!!t.linked_account_id || wealth);
    if (isDepositIn) {
      apport += amt;
      value += amt;
    } else if (isWithdrawal) {
      const ratio = value > 0 ? Math.min(1, apport / value) : 0;
      apport -= Math.abs(amt) * ratio;
      value += amt;
    } else {
      // Plus/moins-value, autres mouvements : la valeur évolue, l'apport ne change pas.
      value += amt;
    }
  }
  return Math.max(0, Math.round(apport));
}
