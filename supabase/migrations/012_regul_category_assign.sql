-- Migration 012 : Affecter la sous-catégorie "Régularisation solde" aux transactions existantes
-- dont le libellé commence par "Régularisation" ou est "Ajustement de solde"
-- et qui n'ont pas encore de catégorie.

UPDATE transactions t
SET category_id = c.id
FROM categories c
WHERE c.name = 'Régularisation solde'
  AND c.profile_id = t.profile_id
  AND c.type = 'expense'
  AND (
    t.note LIKE 'Régularisation%'
    OR t.note = 'Ajustement de solde'
  )
  AND t.category_id IS NULL;
