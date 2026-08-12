-- Migration 010 : Ajout de sort_order sur categories
-- + Mise à jour des catégories par défaut (nouvelles catégories, suppressions, réordonnancement)

-- 1. Ajouter la colonne sort_order (si elle n'existe pas)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 999;

-- 2. Appliquer le sort_order sur les catégories par défaut existantes (RECETTES)
--    On cible par name pour tous les profils (chaque user a ses propres copies)
UPDATE categories SET sort_order = 0  WHERE is_default = true AND type = 'income' AND (name = 'Revenu') AND parent_id IS NULL;
UPDATE categories SET sort_order = 10 WHERE is_default = true AND type = 'income' AND (name = 'Autres recettes') AND parent_id IS NULL;
UPDATE categories SET sort_order = 20 WHERE is_default = true AND type = 'income' AND (name = 'Aides & Subventions') AND parent_id IS NULL;
UPDATE categories SET sort_order = 30 WHERE is_default = true AND type = 'income' AND (name = 'Prêts & Finance') AND parent_id IS NULL;

-- 3. Appliquer le sort_order sur les catégories dépenses existantes à conserver
UPDATE categories SET sort_order = 20 WHERE is_default = true AND type = 'expense' AND name = 'Logement'                      AND parent_id IS NULL;
UPDATE categories SET sort_order = 30 WHERE is_default = true AND type = 'expense' AND name = 'Abonnements, Forfaits'         AND parent_id IS NULL;
UPDATE categories SET sort_order = 40 WHERE is_default = true AND type = 'expense' AND name = 'Frais bancaires et financiers' AND parent_id IS NULL;
UPDATE categories SET sort_order = 50 WHERE is_default = true AND type = 'expense' AND name = 'Impôts et taxes'               AND parent_id IS NULL;
UPDATE categories SET sort_order = 60 WHERE is_default = true AND type = 'expense' AND name = 'Autres dépenses'               AND parent_id IS NULL;

-- 4. Supprimer les catégories obsolètes et leurs sous-catégories
--    (Déplacements et missions, Fournitures et consommables, Loisirs & Vacances, Assurances)

-- Sous-catégories d'abord (contrainte parent_id)
DELETE FROM categories
WHERE is_default = true
  AND parent_id IN (
    SELECT id FROM categories
    WHERE is_default = true
      AND name IN ('Déplacements et missions', 'Fournitures et consommables', 'Loisirs & Vacances', 'Assurances')
  );

-- Puis les parents
DELETE FROM categories
WHERE is_default = true
  AND name IN ('Déplacements et missions', 'Fournitures et consommables', 'Loisirs & Vacances', 'Assurances')
  AND parent_id IS NULL;

-- 5. Ajouter les nouvelles catégories parents pour chaque profil existant
--    (uniquement si elles n'existent pas déjà)

-- "Frais variables" (sort_order 0)
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT p.id, 'Frais variables', 'expense', NULL, true, true, 0
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.profile_id = p.id AND c.name = 'Frais variables' AND c.type = 'expense'
);

-- "Santé, assurance" (sort_order 10)
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT p.id, 'Santé, assurance', 'expense', NULL, true, false, 10
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.profile_id = p.id AND c.name = 'Santé, assurance' AND c.type = 'expense'
);

-- 6. Ajouter les sous-catégories de "Frais variables" pour chaque profil
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT parent.profile_id, sub.name, 'expense', parent.id, true, true, 0
FROM categories parent
CROSS JOIN (
  VALUES
    ('Courses'),
    ('Loisirs'),
    ('Frais personnels'),
    ('Transports en commun'),
    ('Véhicule, Carburant'),
    ('Autre, divers')
) AS sub(name)
WHERE parent.name = 'Frais variables'
  AND parent.type = 'expense'
  AND parent.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.profile_id = parent.profile_id
      AND c.name = sub.name
      AND c.parent_id = parent.id
  );

-- 7. Ajouter les sous-catégories de "Santé, assurance" pour chaque profil
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT parent.profile_id, sub.name, 'expense', parent.id, true, false, 0
FROM categories parent
CROSS JOIN (
  VALUES
    ('Mutuelle, santé'),
    ('Assurance')
) AS sub(name)
WHERE parent.name = 'Santé, assurance'
  AND parent.type = 'expense'
  AND parent.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.profile_id = parent.profile_id
      AND c.name = sub.name
      AND c.parent_id = parent.id
  );
