import { isRegul } from './regul';

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

/**
 * Une ligne est-elle une régularisation de solde ?
 *
 * ⚠️ Ce prédicat exigeait `category_id == null`. C'était vrai jusqu'à la migration 175, qui RANGE
 * désormais les régularisations dans une catégorie (« Régularisation Solde », en frais variables ou
 * en autres recettes). Depuis, ce test ne reconnaissait plus une seule régularisation catégorisée —
 * dont TOUTES celles écrites par la clôture. Symptôme visible : la ligne n'affichait plus le solde
 * cible (« → solde 100 000,00 € ») dans le détail d'un compte, alors qu'une régularisation manuelle
 * sur un référentiel sans cette catégorie, elle, l'affichait encore. Deux comportements pour la même
 * notion, selon un détail invisible.
 *
 * La définition canonique vit dans lib/regul (`isRegul`) : marqueur `regul_target`, avec repli sur
 * le libellé pour les lignes d'avant la colonne. Une seule règle, partagée avec le moteur SQL
 * (`is_regul_tx`). On la réutilise ici plutôt que d'en entretenir une troisième.
 */
export function isRegulRow(t: {
  category_id?: string | null;
  note?: string | null;
  regul_target?: number | null;
  category?: { name?: string | null } | null;
}): boolean {
  return isRegul(t);
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
