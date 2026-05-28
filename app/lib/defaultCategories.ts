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

export const DEFAULT_CATEGORIES: DefaultCategoryItem[] = [
  // RECETTES — ordre : Revenu, Autres recettes, Aides & Subventions, Prêts & Finance
  { name: 'Revenu', type: 'income', sort_order: 0, children: ['Gérant Société', 'Salaire'] },
  { name: 'Autres recettes', type: 'income', sort_order: 10, children: ['Autres produits', 'Remboursements', 'Régularisation Solde'] },
  { name: 'Aides & Subventions', type: 'income', sort_order: 20, children: ['CAF', 'CPF'] },
  { name: 'Prêts & Finance', type: 'income', sort_order: 30, children: ['Apport personnels', 'Intérêts bancaires'] },

  // DÉPENSES — ordre imposé par l'utilisateur
  // Mouvements : virements internes + régularisations (sort_order -10 = en premier)
  { name: 'Mouvements', type: 'expense', is_variable: false, sort_order: -10, children: ['Épargne', 'Investissements', 'Régularisation solde'] },
  { name: 'Frais variables', type: 'expense', is_variable: true, sort_order: 0, children: ['Courses', 'Loisirs', 'Frais personnels', 'Transports en commun', 'Véhicule, Carburant', 'Autre, divers', 'Projets'] },
  { name: 'Santé, assurance', type: 'expense', is_variable: false, sort_order: 10, children: ['Mutuelle, santé', 'Assurance'] },
  { name: 'Logement', type: 'expense', is_variable: false, sort_order: 20, children: ['Loyer/Copropriété', "Taxe d'habitation/Foncière", 'Assurance habitation', 'Electricité/Eau'] },
  { name: 'Abonnements, Forfaits', type: 'expense', is_variable: false, sort_order: 30, children: ['Autres abonnements', 'Internet mobile', 'Plateformes', 'Box internet', 'Sport'] },
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
