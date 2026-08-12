-- ─────────────────────────────────────────────────────────────
-- 025 — Préférences de thème par utilisateur (mode + preset)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_mode   TEXT DEFAULT 'dark'
  CHECK (theme_mode IN ('dark', 'light'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_preset TEXT DEFAULT 'emerald'
  CHECK (theme_preset IN ('emerald', 'ocean', 'violet', 'coral', 'amber'));

NOTIFY pgrst, 'reload schema';
