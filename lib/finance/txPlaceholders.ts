/**
 * Exemples affichés dans le champ « Libellé » d'une transaction.
 * Centralisés ici : le champ existe à l'identique sur l'écran d'AJOUT et sur celui d'ÉDITION,
 * et les exemples doivent rester les mêmes des deux côtés (ils avaient déjà divergé).
 * Ils dépendent du type : on ne libelle pas une dépense comme une recette.
 */
export type TxNoteKind = 'expense' | 'income' | 'transfer';

const NOTE_PLACEHOLDERS: Record<TxNoteKind, string> = {
  expense: 'Ex. Courses, essence, restaurant…',
  income: 'Ex. Salaire, prime…',
  transfer: 'Ex. Virement épargne, apport projet…',
};

export function notePlaceholder(kind: TxNoteKind): string {
  return NOTE_PLACEHOLDERS[kind];
}
