-- ─────────────────────────────────────────────────────────────
-- 091 — Ordre de consommation des recommandations (cascade de dépassement)
--
-- Quand l'enveloppe des dépenses variables est épuisée, tout dépassement grignote
-- les recos une par une dans un ordre défini (« Confort » d'abord), au lieu de
-- réduire toutes les recos au prorata. L'ordre dépend de la « prudence du budget » :
--   • prudent   : enjoy → invest → save → keep
--   • equilibre : enjoy → invest → keep → save
--   • dynamique : enjoy → save → keep → invest
-- En mode « Auto » (prudence_level NULL), le mode est dérivé du profil financier P1–P5.
--
-- Configurable depuis l'admin → onglet « Ordre de déduction ».
-- ─────────────────────────────────────────────────────────────

ALTER TABLE recommendation_settings
  ADD COLUMN IF NOT EXISTS consumption_orders JSONB NOT NULL DEFAULT
    '{
      "prudent":   ["enjoy", "invest", "save", "keep"],
      "equilibre": ["enjoy", "invest", "keep", "save"],
      "dynamique": ["enjoy", "save", "keep", "invest"]
    }'::jsonb;

ALTER TABLE recommendation_settings
  ADD COLUMN IF NOT EXISTS auto_profile_map JSONB NOT NULL DEFAULT
    '{ "P1": "prudent", "P2": "prudent", "P3": "equilibre", "P4": "equilibre", "P5": "dynamique" }'::jsonb;

NOTIFY pgrst, 'reload schema';
