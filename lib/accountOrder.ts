/**
 * Ordre d'affichage des comptes — UNIQUE dans toute l'app (listes, sélecteurs, filtres, virements).
 *
 * Règles, dans cet ordre :
 *   1. le COMPTE COURANT PAR DÉFAUT de l'utilisateur (is_default) passe toujours en tête ;
 *   2. puis par TYPE : Courant → Épargne → Investissement → Autre ;
 *   3. puis par nom (alphabétique) — stable et prévisible.
 *
 * Le tri est appliqué À LA SOURCE (hooks/useAccounts) : toutes les listes en héritent, aucune page
 * n'a à re-trier. Module PUR → testé dans __tests__/accountOrder.test.ts.
 */

/** Rang d'affichage par type de compte (les types inconnus finissent en dernier). */
export const ACCOUNT_TYPE_RANK: Record<string, number> = {
  checking: 0,
  savings: 1,
  investment: 2,
  other: 3,
};

export function accountTypeRank(type: string | null | undefined): number {
  return ACCOUNT_TYPE_RANK[type ?? ''] ?? 9;
}

interface SortableAccount {
  name?: string | null;
  type?: string | null;
  is_default?: boolean | null;
}

/** Comparateur : défaut d'abord, puis type, puis nom. */
export function compareAccounts(a: SortableAccount, b: SortableAccount): number {
  const da = a.is_default ? 0 : 1;
  const db = b.is_default ? 0 : 1;
  if (da !== db) return da - db;
  const ta = accountTypeRank(a.type);
  const tb = accountTypeRank(b.type);
  if (ta !== tb) return ta - tb;
  return (a.name ?? '').localeCompare(b.name ?? '', 'fr');
}

/** Copie triée (n'altère pas le tableau d'origine). */
export function sortAccounts<T extends SortableAccount>(accounts: T[]): T[] {
  return [...accounts].sort(compareAccounts);
}
