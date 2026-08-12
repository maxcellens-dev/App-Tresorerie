-- Migration 016 : Ajout de la sous-catégorie "Projets" sous "Frais variables"
-- Insérée pour tous les profils existants qui ont déjà "Frais variables"
INSERT INTO categories (id, profile_id, name, type, parent_id, is_variable, is_default, sort_order, created_at)
SELECT
  gen_random_uuid(),
  fv.profile_id,
  'Projets',
  'expense',
  fv.id,
  true,
  true,
  80,
  now()
FROM categories fv
WHERE fv.name = 'Frais variables'
  AND fv.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.profile_id = fv.profile_id
      AND c.name = 'Projets'
      AND c.parent_id = fv.id
  );
