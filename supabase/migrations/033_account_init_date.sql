-- Ajoute la date d'initialisation du solde sur chaque compte.
-- init_date = date à laquelle le solde initial a été constaté.
-- Les transactions saisies avant cette date dans le même mois sont considérées
-- déjà comprises dans le solde initial et n'impactent pas ce solde.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS init_date DATE;
