-- Migration 015 : Ajout du statut brouillon sur les transactions

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;

-- Index pour filtrer rapidement les brouillons
CREATE INDEX IF NOT EXISTS idx_transactions_is_draft ON transactions(profile_id, is_draft) WHERE is_draft = TRUE;
