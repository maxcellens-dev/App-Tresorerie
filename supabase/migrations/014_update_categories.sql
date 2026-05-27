-- Migration 014 : Mise à jour des sous-catégories par défaut

-- ─── LOGEMENT ────────────────────────────────────────────────────────────────
UPDATE categories SET name = 'Loyer/Copropriété'
WHERE name = 'Loyer' AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Logement' AND type = 'expense' AND parent_id IS NULL);

INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT parent.profile_id, sub.name, 'expense', parent.id, true, false, parent.sort_order
FROM categories parent
CROSS JOIN (VALUES ('Assurance habitation'), ('Electricité/Eau')) AS sub(name)
WHERE parent.name = 'Logement' AND parent.type = 'expense' AND parent.parent_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.profile_id = parent.profile_id AND c.name = sub.name AND c.parent_id = parent.id
);

-- ─── ABONNEMENTS, FORFAITS ───────────────────────────────────────────────────
UPDATE categories SET name = 'Plateformes'
WHERE name = 'Streaming' AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Abonnements, Forfaits' AND type = 'expense' AND parent_id IS NULL);

INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT parent.profile_id, sub.name, 'expense', parent.id, true, false, parent.sort_order
FROM categories parent
CROSS JOIN (VALUES ('Box internet'), ('Sport')) AS sub(name)
WHERE parent.name = 'Abonnements, Forfaits' AND parent.type = 'expense' AND parent.parent_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.profile_id = parent.profile_id AND c.name = sub.name AND c.parent_id = parent.id
);

-- ─── FRAIS BANCAIRES ET FINANCIERS ──────────────────────────────────────────
UPDATE categories SET name = 'Assurance Crédit'
WHERE name = 'Agios' AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Frais bancaires et financiers' AND type = 'expense' AND parent_id IS NULL);

UPDATE categories SET name = 'Frais bancaires'
WHERE name = 'Commissions' AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Frais bancaires et financiers' AND type = 'expense' AND parent_id IS NULL);

UPDATE categories SET name = 'Autres frais'
WHERE name = 'Frais de dossier' AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Frais bancaires et financiers' AND type = 'expense' AND parent_id IS NULL);

INSERT INTO categories (profile_id, name, type, parent_id, is_default, is_variable, sort_order)
SELECT parent.profile_id, 'Crédits', 'expense', parent.id, true, false, parent.sort_order
FROM categories parent
WHERE parent.name = 'Frais bancaires et financiers' AND parent.type = 'expense' AND parent.parent_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.profile_id = parent.profile_id AND c.name = 'Crédits' AND c.parent_id = parent.id
);

-- ─── IMPÔTS ET TAXES ────────────────────────────────────────────────────────
UPDATE categories SET name = 'Impôt sur le revenu'
WHERE name = 'Impôt sur les sociétés' AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Impôts et taxes' AND type = 'expense' AND parent_id IS NULL);

UPDATE categories SET name = 'Autres Impôts'
WHERE name = 'TVA' AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Impôts et taxes' AND type = 'expense' AND parent_id IS NULL);

-- Réaffecter les transactions de "Cotisations" et "Taxes" vers la catégorie parente avant suppression
UPDATE transactions t
SET category_id = parent.id
FROM categories child
JOIN categories parent ON parent.id = child.parent_id
WHERE child.name IN ('Cotisations', 'Taxes')
  AND child.type = 'expense'
  AND parent.name = 'Impôts et taxes'
  AND t.category_id = child.id;

DELETE FROM categories
WHERE name IN ('Cotisations', 'Taxes') AND type = 'expense'
  AND parent_id IN (SELECT id FROM categories WHERE name = 'Impôts et taxes' AND type = 'expense' AND parent_id IS NULL);
