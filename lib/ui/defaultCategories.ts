/**
 * Catégories et sous-catégories par défaut pour un plan de trésorerie.
 * Recettes = encaissements, Dépenses = décaissements.
 * is_variable = true → dépense variable (fluctue chaque mois)
 * is_variable = false → dépense fixe (montant prévisible)
 * sort_order → ordre d'affichage (multiples de 10 pour permettre des insertions futures)
 */

export type CategoryType = 'income' | 'expense';

export interface DefaultCategoryItem {
  name: string;
  type: CategoryType;
  is_variable?: boolean;
  sort_order: number;
  children?: string[];
}

/**
 * « MOUVEMENTS » — la catégorie des écritures NEUTRES : l'argent change de poche sans quitter le
 * patrimoine (virement vers l'épargne, vers l'investissement).
 *
 * Elle n'a rien à faire dans un choix de catégorie de DÉPENSE : on ne « dépense » pas un virement
 * interne, et on ne se fixe pas un budget dessus. Le test se faisait par nom, recopié à
 * l'identique dans le sélecteur de catégorie et dans le formulaire de projet — voici la troisième
 * occurrence, donc le bon moment pour n'en garder qu'une.
 *
 * Le nom est ÉDITABLE par l'utilisateur (et par l'admin, cf. migration 106) : le test est donc
 * insensible à la casse et aux accents, mais il reste un test par nom. C'est le prix d'une
 * catégorie qui n'a pas de marqueur en base — si elle en gagne un un jour, c'est ici que ça change.
 */
export function isMovementsCategory(name: string | null | undefined): boolean {
  return String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() === 'mouvements';
}

export const DEFAULT_CATEGORIES: DefaultCategoryItem[] = [
  // RECETTES — ordre : Revenu, Autres recettes, Aides & Subventions, Prêts & Finance
  { name: 'Revenu', type: 'income', sort_order: 0, children: ['Gérant Société', 'Salaire, Traitement', 'Dividendes'] },
  { name: 'Autres recettes', type: 'income', sort_order: 10, children: ['Autres produits', 'Remboursements', 'Régularisation Solde'] },
  { name: 'Aides & Subventions', type: 'income', sort_order: 20, children: ['CAF', 'CPF', 'Dons'] },
  { name: 'Prêts & Finance', type: 'income', sort_order: 30, children: ['Apport personnels', 'Intérêts bancaires'] },

  // DÉPENSES — ordre imposé par l'utilisateur
  // Mouvements : virements internes + régularisations (sort_order -10 = en premier)
  // « Mouvements » = les écritures NEUTRES (l'argent change de poche sans quitter le patrimoine).
  // La régularisation n'en fait plus partie : corriger un solde à la baisse, c'est constater de
  // l'argent réellement parti — sa place est dans les frais variables (cf. migration 175).
  { name: 'Mouvements', type: 'expense', is_variable: false, sort_order: -10, children: ['Épargne', 'Investissements'] },
  { name: 'Frais variables', type: 'expense', is_variable: true, sort_order: 0, children: ['Courses', 'Restaurants', 'Loisirs', 'Autres frais personnels', 'Transports en commun', 'Véhicule, Carburant', 'Projets', 'Animaux', 'Vêtements', 'Vacances', 'Régularisation Solde'] },
  { name: 'Santé, assurance', type: 'expense', is_variable: false, sort_order: 10, children: ['Mutuelle', 'Assurance Santé'] },
  { name: 'Logement', type: 'expense', is_variable: false, sort_order: 20, children: ['Loyer', 'Copropriété', "Taxe d'habitation", 'Taxe foncière', 'Assurance habitation', 'Electricité, Eau, Gaz'] },
  { name: 'Abonnements, Forfaits', type: 'expense', is_variable: false, sort_order: 30, children: ['Autres abonnements', 'Internet mobile', 'Plateformes Streaming', 'Box internet', 'Sport'] },
  { name: 'Frais bancaires et financiers', type: 'expense', is_variable: false, sort_order: 40, children: ['Assurance Crédit', 'Frais bancaires', 'Autres frais', 'Crédits'] },
  { name: 'Impôts et taxes', type: 'expense', is_variable: false, sort_order: 50, children: ['Impôt sur le revenu', 'Autres Impôts'] },
  { name: 'Autres dépenses', type: 'expense', is_variable: true, sort_order: 60, children: ['Divers', 'Autres charges'] },
];

/** Pour seed: liste plate (parent puis enfants) pour insertion en respectant parent_id. */
export function getDefaultCategoriesFlat(): { name: string; type: CategoryType; parentName?: string; is_variable?: boolean; sort_order: number }[] {
  const flat: { name: string; type: CategoryType; parentName?: string; is_variable?: boolean; sort_order: number }[] = [];
  for (const cat of DEFAULT_CATEGORIES) {
    flat.push({ name: cat.name, type: cat.type, is_variable: cat.is_variable, sort_order: cat.sort_order });
    for (const child of cat.children ?? []) {
      flat.push({ name: child, type: cat.type, parentName: cat.name, is_variable: cat.is_variable, sort_order: cat.sort_order });
    }
  }
  return flat;
}
