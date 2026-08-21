/**
 * Totaux de la page Comptes — la « Vue d'ensemble » et le total liquidités.
 *
 * ── POURQUOI CE CALCUL EST SORTI DE L'ÉCRAN ─────────────────────────────────────────────────────
 * Il tient en quelques lignes, mais il a porté trois erreurs à la fois, toutes muettes :
 *   • le périmètre était la liste des comptes PERSO, alors que le filtre proposait « Partagés » —
 *     une puce qui ne pouvait afficher que 0 €, et qui n'était en fait jamais rendue puisque sa
 *     condition d'affichage portait sur cette même liste sans partagé ;
 *   • la pondération par % d'impact ne s'appliquait donc à aucun compte ;
 *   • le type « Autre », proposé à la création, n'avait pas de carte : les cartes ne totalisaient
 *     pas le montant affiché juste en dessous.
 * Un total faux ne se voit pas — c'est un nombre plausible. D'où une fonction pure, testée, avec
 * une règle explicite : LA SOMME DES POSTES RENDUS ÉGALE LE TOTAL.
 *
 * La conversion de devise est injectée (`toRef`) : ce module ne connaît ni les taux ni la devise de
 * référence, il ne fait que répartir et additionner.
 */

export type AccountsTotalsFilter = 'all' | 'perso' | 'shared';

export interface TotalsAccount {
  balance: number | string;
  currency?: string | null;
  type?: string | null;
  is_joint?: boolean | null;
  _role?: string | null;
  /** % d'impact du user courant (#5, migration 103). Absent ⇒ compte perso ⇒ 100 %. */
  _impact_pct?: number | null;
}

export interface AccountTotals {
  total: number;
  checking: number;
  savings: number;
  investment: number;
  other: number;
  /** Vrai si des comptes « Autre » sont dans le périmètre → la 4ᵉ carte doit être rendue. */
  hasOther: boolean;
  /** Vrai si le périmètre mêle plusieurs devises → afficher « ≈ ». */
  mixedCurrencies: boolean;
  /** Filtre RÉELLEMENT appliqué (voir `resolveFilter`). */
  appliedFilter: AccountsTotalsFilter;
}

/** Un compte est « partagé » s'il est joint, ou s'il appartient à quelqu'un d'autre. */
export function isSharedAccount(a: TotalsAccount): boolean {
  return !!a.is_joint || (a._role != null && a._role !== 'owner');
}

/**
 * Sans aucun compte partagé, les puces du filtre sont masquées. Une préférence « Partagés » restée
 * en mémoire d'une période où il y en avait afficherait alors 0 € — sans commande visible pour en
 * sortir. On retombe donc sur « Tout ».
 */
export function resolveFilter(saved: AccountsTotalsFilter, accounts: TotalsAccount[]): AccountsTotalsFilter {
  return accounts.some(isSharedAccount) ? saved : 'all';
}

export function computeAccountTotals(
  accounts: TotalsAccount[],
  savedFilter: AccountsTotalsFilter,
  toRef: (balance: number, currency: string) => number,
): AccountTotals {
  const appliedFilter = resolveFilter(savedFilter, accounts);
  const inScope = accounts.filter((a) => {
    if (appliedFilter === 'all') return true;
    return appliedFilter === 'shared' ? isSharedAccount(a) : !isSharedAccount(a);
  });

  // `_impact_pct` absent ⇒ 100 % (compte perso). Un 0 explicite reste 0 : le compte ne pèse rien.
  const weighted = (a: TotalsAccount) => {
    const factor = a._impact_pct != null ? a._impact_pct / 100 : 1;
    const raw = Number(a.balance);
    // Un solde illisible (null, chaîne vide, NaN) ne doit pas propager NaN au total affiché.
    return (Number.isFinite(raw) ? toRef(raw, a.currency || 'EUR') : 0) * factor;
  };
  const sumOf = (pred: (a: TotalsAccount) => boolean) =>
    inScope.filter(pred).reduce((s, a) => s + weighted(a), 0);

  const checking = sumOf((a) => a.type === 'checking');
  const savings = sumOf((a) => a.type === 'savings');
  const investment = sumOf((a) => a.type === 'investment');
  /* « Autre » ramasse aussi tout type inconnu (une valeur ajoutée plus tard, une donnée abîmée) :
     c'est la seule façon de garantir que la somme des postes rendus reste égale au total. */
  const other = sumOf((a) => a.type !== 'checking' && a.type !== 'savings' && a.type !== 'investment');

  return {
    total: checking + savings + investment + other,
    checking,
    savings,
    investment,
    other,
    hasOther: inScope.some((a) => a.type !== 'checking' && a.type !== 'savings' && a.type !== 'investment'),
    mixedCurrencies: new Set(inScope.map((a) => a.currency || 'EUR')).size > 1,
    appliedFilter,
  };
}
