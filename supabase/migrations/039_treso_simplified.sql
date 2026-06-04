-- Plan de trésorerie : préférence d'affichage simplifié (masque les sous-catégories)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS treso_simplified BOOLEAN NOT NULL DEFAULT false;
