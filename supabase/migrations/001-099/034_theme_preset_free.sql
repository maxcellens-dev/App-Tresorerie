-- ─────────────────────────────────────────────────────────────
-- 034 — Lève la contrainte sur theme_preset
-- Les presets sont désormais extensibles via le Style Editor
-- (noir, blanc, et presets personnalisés). On retire le CHECK.
-- ─────────────────────────────────────────────────────────────

-- Le nom de la contrainte CHECK générée par Postgres dépend de la colonne.
-- On la retire de façon robuste quelle que soit son appellation.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%theme_preset%'
  LOOP
    EXECUTE format('ALTER TABLE profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
