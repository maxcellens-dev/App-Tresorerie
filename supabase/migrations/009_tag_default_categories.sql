-- 009: Tag existing default categories with is_default = true and correct is_variable values
-- For users who already seeded categories before the flag was added.

-- Mark ALL known default category names as is_default = true
UPDATE categories SET is_default = true
WHERE name IN (
  -- Income parents
  'Aides & Subventions', 'Prêts & Finance', 'Revenu', 'Autres recettes',
  -- Income children
  'CAF', 'CPF', 'Apport personnels', 'Intérêts bancaires',
  'Gérant Société', 'Salaire', 'Autres produits', 'Remboursements',
  -- Expense parents (fixed)
  'Abonnements, Forfaits', 'Logement', 'Assurances', 'Frais bancaires et financiers', 'Impôts et taxes',
  -- Expense children (fixed)
  'Autres abonnements', 'Internet mobile', 'Streaming',
  'Loyer', 'Taxe d''habitation/Foncière',
  'Assurance multirisque', 'Assurance pro', 'Autres assurances',
  'Agios', 'Commissions', 'Frais de dossier',
  'TVA', 'Impôt sur les sociétés', 'Taxes', 'Cotisations',
  -- Expense parents (variable)
  'Loisirs & Vacances', 'Fournitures et consommables', 'Déplacements et missions', 'Autres dépenses',
  -- Expense children (variable)
  'Vacances', 'Sorties', 'Loisirs',
  'Fournitures bureau', 'Consommables', 'Petit équipement',
  'Transport', 'Hébergement', 'Frais de mission',
  'Divers', 'Autres charges'
);

-- Set is_variable = true for variable expense categories
UPDATE categories SET is_variable = true
WHERE name IN (
  'Loisirs & Vacances', 'Fournitures et consommables', 'Déplacements et missions', 'Autres dépenses',
  'Vacances', 'Sorties', 'Loisirs',
  'Fournitures bureau', 'Consommables', 'Petit équipement',
  'Transport', 'Hébergement', 'Frais de mission',
  'Divers', 'Autres charges'
) AND type = 'expense';

-- Ensure fixed expense categories have is_variable = false
UPDATE categories SET is_variable = false
WHERE name IN (
  'Abonnements, Forfaits', 'Logement', 'Assurances', 'Frais bancaires et financiers', 'Impôts et taxes',
  'Autres abonnements', 'Internet mobile', 'Streaming',
  'Loyer', 'Taxe d''habitation/Foncière',
  'Assurance multirisque', 'Assurance pro', 'Autres assurances',
  'Agios', 'Commissions', 'Frais de dossier',
  'TVA', 'Impôt sur les sociétés', 'Taxes', 'Cotisations'
) AND type = 'expense';
