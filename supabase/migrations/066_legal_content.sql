-- 066 — Contenu légal éditable (§P9).
-- Permet à l'admin de remplacer le texte des pages « Confidentialité » et « Mentions légales »
-- depuis l'app. Si vide/absent, l'app affiche le contenu par défaut codé en dur.
-- Stocké dans app_config.legal (jsonb) : { "privacy": "...", "legal": "..." }.

ALTER TABLE app_config ADD COLUMN IF NOT EXISTS legal jsonb NOT NULL DEFAULT '{}'::jsonb;
