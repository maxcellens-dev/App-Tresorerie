-- Migration 013 : Sous-catégorie "Régularisation Solde" sous "Autres recettes" (recettes)
-- Les régularisations positives (qui font monter le solde) sont des recettes.

-- 1. Créer la sous-catégorie pour chaque profil
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT parent.profile_id, 'Régularisation Solde', 'income', parent.id, true, false, 30
FROM categories parent
WHERE parent.name = 'Autres recettes'
  AND parent.type = 'income'
  AND parent.parent_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.profile_id = parent.profile_id
    AND c.name = 'Régularisation Solde'
    AND c.parent_id = parent.id
);

-- 2. Affecter les transactions de régularisation positives (recettes) à cette catégorie
UPDATE transactions t
SET category_id = c.id
FROM categories c
WHERE c.name = 'Régularisation Solde'
  AND c.profile_id = t.profile_id
  AND c.type = 'income'
  AND (
    t.note LIKE 'Régularisation%'
    OR t.note = 'Ajustement de solde'
  )
  AND t.amount > 0
  AND t.category_id IS NULL;
