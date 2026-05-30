-- ─────────────────────────────────────────────────────────────
-- 022 — Guide "première visite" pour l'écran Paramètres
-- ─────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS guide_parametres_seen BOOLEAN DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
