-- Migration 032 : Montant « Réservé » sur les brouillons de projet
--
-- Un brouillon de projet peut être « Conservé » : il n'est pas validé (pas de
-- dépense réelle) mais son montant est mis de côté ("Réservé") et compté dans la
-- ligne Réservé du Pilotage, jusqu'à ce qu'il soit utilisé (virement) ou libéré.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_reserved BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_transactions_reserved
  ON transactions(profile_id, is_reserved) WHERE is_reserved = TRUE;
