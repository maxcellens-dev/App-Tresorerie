-- Migration 011 : linked_account_id sur transactions + catégorie Mouvements

-- 1. Ajouter linked_account_id sur transactions
--    Permet d'identifier les 2 côtés d'un virement interne
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

-- 2. Créer la catégorie "Mouvements" pour tous les profils existants
--    sort_order = -10 → apparaît avant "Frais variables" (sort_order 0)
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT p.id, 'Mouvements', 'expense', NULL, true, false, -10
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.profile_id = p.id AND c.name = 'Mouvements' AND c.type = 'expense'
);

-- 3. Sous-catégories de "Mouvements" pour chaque profil
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT parent.profile_id, sub.name, 'expense', parent.id, true, false, sub.ord
FROM categories parent
CROSS JOIN (VALUES ('Épargne', 0), ('Investissements', 10), ('Régularisation solde', 20)) AS sub(name, ord)
WHERE parent.name = 'Mouvements' AND parent.type = 'expense' AND parent.parent_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.profile_id = parent.profile_id AND c.name = sub.name AND c.parent_id = parent.id
);
