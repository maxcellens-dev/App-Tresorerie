/**
 * Catégories et sous-catégories par défaut pour un plan de trésorerie.
 * Recettes = encaissements, Dépenses = décaissements.
 */

export type CategoryType = 'income' | 'expense';

export interface DefaultCategoryItem {
  name: string;
  type: CategoryType;
  children?: string[]; // sous-catégories (postes)
}

export const DEFAULT_CATEGORIES: DefaultCategoryItem[] = [
  // RECETTES
  { name: 'Aides & Subventions', type: 'income', children: ['CAF', 'CPF'] },
  { name: 'Prêts & Finance', type: 'income', children: ['Apport personnels', 'Intérêts bancaires'] },
  { name: 'Revenu', type: 'income', children: ['Gérant Société', 'Salaire'] },
  { name: 'Autres recettes', type: 'income', children: ['Autres produits', 'Remboursements'] },

  // DÉPENSES
  { name: 'Abonnements, Forfaits', type: 'expense', children: ['Autres abonnements', 'Internet mobile', 'Streaming'] },
  { name: 'Logement', type: 'expense', children: ['Loyer', 'Taxe d\'habitation/Foncière'] },
  { name: 'Loisirs & Vacances', type: 'expense', children: ['Vacances', 'Sorties', 'Loisirs'] },
  { name: 'Assurances', type: 'expense', children: ['Assurance multirisque', 'Assurance pro', 'Autres assurances'] },
  { name: 'Fournitures et consommables', type: 'expense', children: ['Fournitures bureau', 'Consommables', 'Petit équipement'] },
  { name: 'Déplacements et missions', type: 'expense', children: ['Transport', 'Hébergement', 'Frais de mission'] },
  { name: 'Frais bancaires et financiers', type: 'expense', children: ['Agios', 'Commissions', 'Frais de dossier'] },
  { name: 'Impôts et taxes', type: 'expense', children: ['TVA', 'Impôt sur les sociétés', 'Taxes', 'Cotisations'] },
  { name: 'Autres dépenses', type: 'expense', children: ['Divers', 'Autres charges'] },
];

/** Pour seed: liste plate (parent puis enfants) pour insertion en respectant parent_id. */
export function getDefaultCategoriesFlat(): { name: string; type: CategoryType; parentName?: string }[] {
  const flat: { name: string; type: CategoryType; parentName?: string }[] = [];
  for (const cat of DEFAULT_CATEGORIES) {
    flat.push({ name: cat.name, type: cat.type });
    for (const child of cat.children ?? []) {
      flat.push({ name: child, type: cat.type, parentName: cat.name });
    }
  }
  return flat;
}
