-- 065 — Mise à jour des sous-catégories par défaut (§N11) pour les comptes EXISTANTS.
-- Les changements dans app/lib/defaultCategories.ts ne s'appliquent qu'aux nouveaux comptes
-- (seed). Cette migration applique renommages / splits / ajouts / suppression aux catégories
-- déjà créées (is_default = true). Idempotente : ré-exécutable sans effet de bord.
-- Les icônes ne sont pas écrites ici : l'app dérive l'icône par défaut depuis le nom.

BEGIN;

-- ── Renommages (sous-catégories par défaut) ────────────────────────────────
UPDATE categories SET name = 'Salaire, Traitement'
  WHERE is_default = true AND type = 'income' AND name = 'Salaire' AND parent_id IS NOT NULL;

UPDATE categories SET name = 'Mutuelle'
  WHERE is_default = true AND type = 'expense' AND name = 'Mutuelle, santé' AND parent_id IS NOT NULL;

UPDATE categories SET name = 'Assurance Santé'
  WHERE is_default = true AND type = 'expense' AND name = 'Assurance' AND parent_id IS NOT NULL;

UPDATE categories SET name = 'Electricité, Eau, Gaz'
  WHERE is_default = true AND type = 'expense' AND name = 'Electricité/Eau' AND parent_id IS NOT NULL;

UPDATE categories SET name = 'Plateformes Streaming'
  WHERE is_default = true AND type = 'expense' AND name = 'Plateformes' AND parent_id IS NOT NULL;

UPDATE categories SET name = 'Autres frais personnels'
  WHERE is_default = true AND type = 'expense' AND name = 'Frais personnels' AND parent_id IS NOT NULL;

-- ── Splits : on renomme l'existant, puis on insère le nouveau frère ─────────
-- Loyer/Copropriété → Loyer (+ Copropriété)
UPDATE categories SET name = 'Loyer'
  WHERE is_default = true AND type = 'expense' AND name = 'Loyer/Copropriété' AND parent_id IS NOT NULL;

INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT c.profile_id, 'Copropriété', c.type, c.parent_id, true, c.is_variable, c.sort_order
FROM categories c
WHERE c.is_default = true AND c.type = 'expense' AND c.name = 'Loyer' AND c.parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.profile_id = c.profile_id AND x.type = 'expense' AND x.name = 'Copropriété');

-- Taxe d'habitation/Foncière → Taxe d'habitation (+ Taxe foncière)
UPDATE categories SET name = 'Taxe d''habitation'
  WHERE is_default = true AND type = 'expense' AND name = 'Taxe d''habitation/Foncière' AND parent_id IS NOT NULL;

INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT c.profile_id, 'Taxe foncière', c.type, c.parent_id, true, c.is_variable, c.sort_order
FROM categories c
WHERE c.is_default = true AND c.type = 'expense' AND c.name = 'Taxe d''habitation' AND c.parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.profile_id = c.profile_id AND x.type = 'expense' AND x.name = 'Taxe foncière');

-- ── Ajouts de sous-catégories ──────────────────────────────────────────────
-- Revenu → Dividendes
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT p.profile_id, 'Dividendes', 'income', p.id, true, false, p.sort_order
FROM categories p
WHERE p.is_default = true AND p.type = 'income' AND p.name = 'Revenu' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.profile_id = p.profile_id AND x.type = 'income' AND x.name = 'Dividendes');

-- Aides & Subventions → Dons
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT p.profile_id, 'Dons', 'income', p.id, true, false, p.sort_order
FROM categories p
WHERE p.is_default = true AND p.type = 'income' AND p.name = 'Aides & Subventions' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.profile_id = p.profile_id AND x.type = 'income' AND x.name = 'Dons');

-- Frais variables → Animaux, Vêtements, Vacances
INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT p.profile_id, v.name, 'expense', p.id, true, true, p.sort_order
FROM categories p
CROSS JOIN (VALUES ('Animaux'), ('Vêtements'), ('Vacances')) AS v(name)
WHERE p.is_default = true AND p.type = 'expense' AND p.name = 'Frais variables' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.profile_id = p.profile_id AND x.type = 'expense' AND x.name = v.name);

-- ── Suppression : « Autre, divers » (Frais variables) ──────────────────────
-- On détache d'abord les transactions concernées (catégorie → NULL) pour éviter les contraintes.
UPDATE transactions SET category_id = NULL
  WHERE category_id IN (
    SELECT id FROM categories WHERE is_default = true AND type = 'expense' AND name = 'Autre, divers' AND parent_id IS NOT NULL
  );
DELETE FROM categories
  WHERE is_default = true AND type = 'expense' AND name = 'Autre, divers' AND parent_id IS NOT NULL;

COMMIT;
