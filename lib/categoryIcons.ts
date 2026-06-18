/**
 * Glossaire d'icônes des sous-catégories (§13).
 * - Les catégories sont par utilisateur (table `categories`, colonne `icon`) → chaque user peut
 *   choisir ses propres icônes sans impacter les autres.
 * - Si aucune icône n'est définie, on retombe sur une icône par défaut déduite du nom
 *   (DEFAULT_SUBCATEGORY_ICONS), sinon sur FALLBACK_ICON.
 * - Les virements ont leur icône dédiée (VIREMENT_ICON).
 * Toutes les valeurs sont des noms d'icônes Ionicons (cohérent avec le reste de l'app).
 */
import type { Category } from '../types/database';

export const FALLBACK_ICON = 'pricetag-outline';
export const VIREMENT_ICON = 'swap-horizontal-outline';

/** Liste proposée dans le sélecteur d'icônes (modal de choix). */
export const CATEGORY_ICON_GLOSSARY: string[] = [
  'pricetag-outline', 'cart-outline', 'restaurant-outline', 'fast-food-outline', 'cafe-outline',
  'cash-outline', 'card-outline', 'wallet-outline', 'briefcase-outline', 'business-outline',
  'home-outline', 'bed-outline', 'flash-outline', 'water-outline', 'bulb-outline',
  'car-outline', 'bus-outline', 'train-outline', 'airplane-outline', 'bicycle-outline',
  'medkit-outline', 'fitness-outline', 'barbell-outline', 'heart-outline', 'happy-outline',
  'game-controller-outline', 'tv-outline', 'film-outline', 'musical-notes-outline', 'book-outline',
  'school-outline', 'shirt-outline', 'gift-outline', 'paw-outline', 'people-outline',
  'person-outline', 'phone-portrait-outline', 'wifi-outline', 'cloud-outline', 'repeat-outline',
  'trending-up-outline', 'shield-outline', 'shield-checkmark-outline', 'document-text-outline', 'receipt-outline',
  'construct-outline', 'hammer-outline', 'flag-outline', 'star-outline', 'gift-outline',
  'arrow-undo-outline', 'sync-outline', 'sparkles-outline', 'leaf-outline', 'ellipsis-horizontal',
];

/** Normalise un nom (minuscule, sans accents) pour les correspondances. */
function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Icône par défaut selon le nom de la sous-catégorie (défauts livrés avec l'app). */
const DEFAULT_BY_NAME: Record<string, string> = {
  // Nouveaux libellés par défaut (§N11)
  'salaire, traitement': 'cash-outline',
  'dividendes': 'trending-up-outline',
  'dons': 'gift-outline',
  'autres frais personnels': 'person-outline',
  'animaux': 'paw-outline',
  'vetements': 'shirt-outline',
  'vacances': 'airplane-outline',
  'mutuelle': 'medkit-outline',
  'assurance sante': 'shield-checkmark-outline',
  'loyer': 'home-outline',
  'copropriete': 'business-outline',
  "taxe d'habitation": 'document-text-outline',
  'taxe fonciere': 'document-text-outline',
  'electricite, eau, gaz': 'flash-outline',
  'plateformes streaming': 'tv-outline',
  // Revenus
  'gerant societe': 'briefcase-outline',
  'salaire': 'cash-outline',
  'autres produits': 'add-circle-outline',
  'remboursements': 'arrow-undo-outline',
  'regularisation solde': 'sync-outline',
  'caf': 'people-outline',
  'cpf': 'school-outline',
  'apport personnels': 'wallet-outline',
  'interets bancaires': 'trending-up-outline',
  // Mouvements
  'epargne': 'shield-outline',
  'investissements': 'trending-up-outline',
  // Frais variables
  'courses': 'cart-outline',
  'restaurants': 'restaurant-outline',
  'loisirs': 'game-controller-outline',
  'frais personnels': 'person-outline',
  'transports en commun': 'bus-outline',
  'vehicule, carburant': 'car-outline',
  'autre, divers': 'ellipsis-horizontal',
  'projets': 'flag-outline',
  // Santé
  'mutuelle, sante': 'medkit-outline',
  'assurance': 'shield-checkmark-outline',
  // Logement
  'loyer/copropriete': 'home-outline',
  "taxe d'habitation/fonciere": 'document-text-outline',
  'assurance habitation': 'shield-outline',
  'electricite/eau': 'flash-outline',
  // Abonnements
  'autres abonnements': 'repeat-outline',
  'internet mobile': 'phone-portrait-outline',
  'plateformes': 'tv-outline',
  'box internet': 'wifi-outline',
  'sport': 'barbell-outline',
  // Frais bancaires
  'assurance credit': 'shield-outline',
  'frais bancaires': 'card-outline',
  'autres frais': 'cash-outline',
  'credits': 'card-outline',
  // Impôts
  'impot sur le revenu': 'document-text-outline',
  'autres impots': 'document-outline',
  // Autres
  'divers': 'ellipsis-horizontal',
  'autres charges': 'pricetag-outline',
};

/** Icône par défaut déduite du nom (mots-clés) si aucune correspondance exacte. */
function inferByKeyword(n: string): string | null {
  const has = (...keys: string[]) => keys.some((k) => n.includes(k));
  if (has('cours', 'aliment', 'supermarch')) return 'cart-outline';
  if (has('resto', 'restaurant')) return 'restaurant-outline';
  if (has('loisir', 'jeu', 'sortie')) return 'game-controller-outline';
  if (has('transport', 'bus', 'metro', 'train')) return 'bus-outline';
  if (has('voiture', 'vehicule', 'carburant', 'essence', 'auto')) return 'car-outline';
  if (has('sante', 'medic', 'mutuelle', 'pharma')) return 'medkit-outline';
  if (has('loyer', 'logement', 'maison', 'appart')) return 'home-outline';
  if (has('electric', 'eau', 'energie', 'gaz')) return 'flash-outline';
  if (has('abonn', 'forfait')) return 'repeat-outline';
  if (has('internet', 'box', 'wifi')) return 'wifi-outline';
  if (has('mobile', 'tel', 'phone')) return 'phone-portrait-outline';
  if (has('sport', 'gym', 'fitness')) return 'barbell-outline';
  if (has('banc', 'frais', 'credit')) return 'card-outline';
  if (has('impot', 'taxe')) return 'document-text-outline';
  if (has('salaire', 'revenu', 'paie')) return 'cash-outline';
  if (has('epargne')) return 'shield-outline';
  if (has('invest')) return 'trending-up-outline';
  if (has('cadeau', 'gift')) return 'gift-outline';
  if (has('voyage', 'vacances', 'avion')) return 'airplane-outline';
  if (has('anim', 'chat', 'chien')) return 'paw-outline';
  if (has('vetement', 'habille', 'shirt')) return 'shirt-outline';
  return null;
}

/** Icône d'une (sous-)catégorie : choix utilisateur > défaut par nom > mot-clé > fallback. */
export function iconForCategory(cat?: { name?: string | null; icon?: string | null } | null): string {
  if (cat?.icon) return cat.icon;
  const n = norm(cat?.name ?? '');
  if (!n) return FALLBACK_ICON;
  return DEFAULT_BY_NAME[n] ?? inferByKeyword(n) ?? FALLBACK_ICON;
}

/** Icône à afficher devant une transaction (virement = icône dédiée). */
export function iconForTransaction(tx: {
  linked_account_id?: string | null;
  category?: { name?: string | null; icon?: string | null } | null;
}): string {
  if (tx.linked_account_id) return VIREMENT_ICON;
  return iconForCategory(tx.category ?? null);
}

export type { Category };
