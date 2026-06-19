/**
 * Apport « actuel » d'un compte d'investissement, DÉRIVÉ chronologiquement des transactions.
 * Base = apport à la création (initial_contributed) ; chaque apport/virement entrant l'augmente ;
 * chaque retrait (virement sortant) en retire la part de capital selon la règle du prorata.
 * Comme c'est calculé à la volée, l'ajout/la modification/la suppression d'une transaction
 * est automatiquement reflété (pas de valeur figée à resynchroniser).
 *
 * Retourne null si non suivi (compte non-investissement ou aucun apport de base défini).
 */
interface TxLike {
  account_id: string;
  amount: number;
  date: string;
  is_draft?: boolean | null;
  linked_account_id?: string | null;
  note?: string | null;
}

interface AccountLike {
  id: string;
  type: string;
  balance: number;
  initial_contributed?: number | null;
}

export function computeContributed(
  account: AccountLike,
  txs: TxLike[],
  opts?: { estimateBaseWhenMissing?: boolean },
): number | null {
  if (account.type !== 'investment') return null;

  const accTxs = txs
    .filter((t) => t.account_id === account.id && !t.is_draft)
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
    const isDepositIn = amt > 0 && (!!t.linked_account_id || /apport/i.test(t.note || ''));
    const isWithdrawal = amt < 0 && !!t.linked_account_id;
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
