-- Montant total déjà apporté sur un compte d'investissement (saisi à la création).
-- Sert à initialiser l'« Apport existant » de l'hypothèse de projection.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS initial_contributed NUMERIC;
