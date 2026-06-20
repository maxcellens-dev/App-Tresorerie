/**
 * Ordre d'affichage des transactions : jour le plus récent en haut ; AU SEIN d'un même jour,
 * ordre CHRONOLOGIQUE de saisie (created_at croissant). Cela place une régularisation de solde
 * naturellement APRÈS les transactions saisies avant elle (qu'elle réconcilie) et AVANT celles
 * saisies après (les « nouvelles » opérations postérieures à la régul).
 */

/** Une ligne est-elle une régularisation de solde ? (catégorie nulle + libellé « …gul… »/« Ajustement de solde ».) */
export function isRegulRow(t: { category_id?: string | null; note?: string | null }): boolean {
  const note = t.note ?? '';
  return (t.category_id == null) && (/gul/i.test(note) || note === 'Ajustement de solde');
}

type OrderableTx = { date: string; created_at?: string };

/** Comparateur : date décroissante (jour récent en haut), puis created_at croissant (chronologique). */
export function compareTransactionsForDisplay(a: OrderableTx, b: OrderableTx): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  return (a.created_at ?? '').localeCompare(b.created_at ?? '');
}
