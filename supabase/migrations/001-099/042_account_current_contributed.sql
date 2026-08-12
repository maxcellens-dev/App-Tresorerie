-- Apport « actuel » d'un compte d'investissement (capital injecté net des retraits).
-- Initialisé au montant apporté à la création, augmenté à chaque apport/virement entrant,
-- réduit proportionnellement (règle du prorata) à chaque retrait. Modifiable manuellement.
-- C'est la valeur reprise dans « Apport » de la page Projection.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS current_contributed NUMERIC;

-- Pour les comptes d'invest existants, on initialise l'apport actuel au montant déjà apporté.
UPDATE accounts SET current_contributed = initial_contributed
WHERE type = 'investment' AND current_contributed IS NULL AND initial_contributed IS NOT NULL;
