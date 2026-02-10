/**
 * Catégories et sous-catégories par défaut pour un plan de trésorerie.
 * Recettes = encaissements, Dépenses = décaissements.
 * is_variable = true → dépense variable (fluctue chaque mois)
 * is_variable = false → dépense fixe (montant prévisible)
 */

export type CategoryType = 'income' | 'expense';

export interface DefaultCategoryItem {
  name: string;
  type: CategoryType;
  is_variable?: boolean;
  children?: string[]; // sous-catégories (postes)
}

export const DEFAULT_CATEGORIES: DefaultCategoryItem[] = [
  // RECETTES
  { name: 'Aides & Subventions', type: 'income', children: ['CAF', 'CPF'] },
  { name: 'Prêts & Finance', type: 'income', children: ['Apport personnels', 'Intérêts bancaires'] },
  { name: 'Revenu', type: 'income', children: ['Gérant Société', 'Salaire'] },
  { name: 'Autres recettes', type: 'income', children: ['Autres produits', 'Remboursements'] },

  // DÉPENSES FIXES
  { name: 'Abonnements, Forfaits', type: 'expense', is_variable: false, children: ['Autres abonnements', 'Internet mobile', 'Streaming'] },
  { name: 'Logement', type: 'expense', is_variable: false, children: ['Loyer', 'Taxe d\'habitation/Foncière'] },
  { name: 'Assurances', type: 'expense', is_variable: false, children: ['Assurance multirisque', 'Assurance pro', 'Autres assurances'] },
  { name: 'Frais bancaires et financiers', type: 'expense', is_variable: false, children: ['Agios', 'Commissions', 'Frais de dossier'] },
  { name: 'Impôts et taxes', type: 'expense', is_variable: false, children: ['TVA', 'Impôt sur les sociétés', 'Taxes', 'Cotisations'] },

  // DÉPENSES VARIABLES
  { name: 'Loisirs & Vacances', type: 'expense', is_variable: true, children: ['Vacances', 'Sorties', 'Loisirs'] },
  { name: 'Fournitures et consommables', type: 'expense', is_variable: true, children: ['Fournitures bureau', 'Consommables', 'Petit équipement'] },
  { name: 'Déplacements et missions', type: 'expense', is_variable: true, children: ['Transport', 'Hébergement', 'Frais de mission'] },
  { name: 'Autres dépenses', type: 'expense', is_variable: true, children: ['Divers', 'Autres charges'] },
];

/** Pour seed: liste plate (parent puis enfants) pour insertion en respectant parent_id. */
export function getDefaultCategoriesFlat(): { name: string; type: CategoryType; parentName?: string; is_variable?: boolean }[] {
  const flat: { name: string; type: CategoryType; parentName?: string; is_variable?: boolean }[] = [];
  for (const cat of DEFAULT_CATEGORIES) {
    flat.push({ name: cat.name, type: cat.type, is_variable: cat.is_variable });
    for (const child of cat.children ?? []) {
      flat.push({ name: child, type: cat.type, parentName: cat.name, is_variable: cat.is_variable });
    }
  }
  return flat;
}
