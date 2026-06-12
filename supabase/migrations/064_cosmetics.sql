-- Cosmétiques équipés : quel article cosmétique (acheté en boutique) est actif par emplacement.
-- Forme : { "avatar_frame": "cosmetic_avatar_frame", "title": "cosmetic_title_legend", "streak_flame": "cosmetic_gold_flame" }
-- Un emplacement absent = aucun cosmétique équipé pour cet emplacement.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equipped_cosmetics JSONB NOT NULL DEFAULT '{}'::jsonb;
