-- Migration 050 : Ajoute la sous-catégorie « Restaurants » sous « Frais variables »
-- pour les utilisateurs existants (les nouveaux l'ont via defaultCategories).

INSERT INTO categories (profile_id, name, type, parent_id, is_variable, sort_order)
SELECT fv.profile_id, 'Restaurants', 'expense', fv.id, true, fv.sort_order
FROM categories fv
WHERE fv.name = 'Frais variables' AND fv.type = 'expense' AND fv.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.profile_id = fv.profile_id AND c.parent_id = fv.id AND c.name = 'Restaurants'
  );
