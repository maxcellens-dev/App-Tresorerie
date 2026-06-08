-- Migration 044 : Solde « à date » + correction des soldes existants
--
-- Problème historique : useAddTransaction ajoutait au solde du compte TOUTE transaction
-- non-brouillon, quelle que soit sa date — y compris les dépenses futures non récurrentes
-- (ex. « Prochaines vacances -500 € » datée du 13 du mois). Résultat : le solde du jour
-- était amputé de montants pas encore sortis du compte, et les formules du Pilotage
-- (safe_to_spend, budget libre) — qui supposent un solde « à date » et redéduisent le futur
-- séparément — comptaient ces sorties deux fois.
--
-- Nouveau modèle : le solde ne reflète que ce qui est réellement passé (date <= aujourd'hui)
-- ou récurrent (géré par la matérialisation). Une dépense future non récurrente n'entre dans
-- le solde que le jour venu, via le drapeau `posted` + la fonction reconcile_posted().

-- 1. Drapeau « porté au solde »
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS posted BOOLEAN NOT NULL DEFAULT true;

-- 2. Les dépenses futures non récurrentes non-brouillon ne sont PAS portées au solde.
UPDATE transactions
SET posted = false
WHERE COALESCE(is_draft, false) = false
  AND COALESCE(is_recurring, false) = false
  AND date > current_date;

-- 3. Correction des soldes existants : retirer la contribution de ces dépenses futures
--    qui avaient été indûment ajoutées sous l'ancien modèle.
UPDATE accounts a
SET balance = a.balance - COALESCE(fut.total, 0)
FROM (
  SELECT account_id, SUM(amount) AS total
  FROM transactions
  WHERE COALESCE(is_draft, false) = false
    AND COALESCE(is_recurring, false) = false
    AND date > current_date
  GROUP BY account_id
) fut
WHERE a.id = fut.account_id
  AND COALESCE(fut.total, 0) <> 0;

-- 4. Réconciliation : porte au solde les transactions échues (date <= aujourd'hui) pas encore
--    portées (posted = false). À appeler au chargement de l'app (idempotent).
CREATE OR REPLACE FUNCTION reconcile_posted(p_profile UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT account_id, SUM(amount) AS total
    FROM transactions
    WHERE profile_id = p_profile
      AND COALESCE(is_draft, false) = false
      AND COALESCE(is_recurring, false) = false
      AND COALESCE(posted, true) = false
      AND date <= current_date
    GROUP BY account_id
  LOOP
    UPDATE accounts SET balance = balance + r.total WHERE id = r.account_id;
  END LOOP;

  UPDATE transactions
  SET posted = true
  WHERE profile_id = p_profile
    AND COALESCE(is_draft, false) = false
    AND COALESCE(is_recurring, false) = false
    AND COALESCE(posted, true) = false
    AND date <= current_date;
END;
$$;
