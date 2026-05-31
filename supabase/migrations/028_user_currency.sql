-- ─────────────────────────────────────────────────────────────
-- 028 — Devise d'affichage par utilisateur
-- ─────────────────────────────────────────────────────────────
-- Change uniquement le symbole affiché (pas de conversion des montants).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'EUR';

NOTIFY pgrst, 'reload schema';
