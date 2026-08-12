/**
 * Ordre d'affichage des transactions : jour le plus récent en haut. AU SEIN d'un même jour, ordre
 * ANTI-chronologique (created_at décroissant = plus récent en haut), avec les transactions « déjà
 * incluses » dans une régularisation poussées tout en bas. Résultat autour d'une régul (haut→bas) :
 *   - les transactions saisies APRÈS la régul (nouvelles / postérieures) → au-dessus ;
 *   - la régul ;
 *   - les transactions saisies AVANT elle (qu'elle a absorbées) et les « déjà incluses » → en-dessous.
 * Une régul (saisie après les écritures du jour qu'elle réconcilie) remonte donc au-dessus d'elles ;
 * une transaction normale saisie après la régul passe au-dessus de la régul.
 */

/** Une ligne est-elle une régularisation de solde ? (catégorie nulle + libellé « …gul… »/« Ajustement de solde ».) */
export function isRegulRow(t: { category_id?: string | null; note?: string | null }): boolean {
  const note = t.note ?? '';
  return (t.category_id == null) && (/gul/i.test(note) || note === 'Ajustement de solde');
}

type OrderableTx = { date: string; created_at?: string; regul_covered?: boolean };

/** Comparateur : date décroissante ; même jour → « déjà incluses » en bas, sinon created_at décroissant. */
export function compareTransactionsForDisplay(a: OrderableTx, b: OrderableTx): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  const ca = a.regul_covered ? 1 : 0;
  const cb = b.regul_covered ? 1 : 0;
  if (ca !== cb) return ca - cb; // couverte (1) → plus bas
  return (b.created_at ?? '').localeCompare(a.created_at ?? ''); // plus récent en haut
}
