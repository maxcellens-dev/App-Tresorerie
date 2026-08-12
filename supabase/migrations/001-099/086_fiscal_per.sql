-- Migration 086 : enveloppe fiscale PER + libellés cohérents.
--   • Autorise 'per' (Plan Épargne Retraite) sur les comptes et la table des taux.
--   • Libellés « CODE - Nom » cohérents pour PEA et CTO.
--   • Insère le PER (taux par défaut 31,4 %), inséré entre CTO et Autre.

-- 1. Autoriser 'per' dans les contraintes CHECK existantes.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_fiscal_envelope_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_fiscal_envelope_check
  CHECK (fiscal_envelope IN ('pea', 'av', 'cto', 'per', 'autre'));

ALTER TABLE fiscal_envelope_rates DROP CONSTRAINT IF EXISTS fiscal_envelope_rates_envelope_check;
ALTER TABLE fiscal_envelope_rates ADD CONSTRAINT fiscal_envelope_rates_envelope_check
  CHECK (envelope IN ('pea', 'av', 'cto', 'per', 'autre'));

-- 2. Libellés cohérents (« CODE - Nom »).
UPDATE fiscal_envelope_rates SET label = 'PEA - Plan Epargne Investissement' WHERE envelope = 'pea';
UPDATE fiscal_envelope_rates SET label = 'CTO - Compte-Titres'              WHERE envelope = 'cto';

-- 3. Insérer le PER (entre CTO et Autre) — Autre passe en dernier.
UPDATE fiscal_envelope_rates SET sort_order = 4 WHERE envelope = 'autre';
INSERT INTO fiscal_envelope_rates (envelope, label, tax_rate, sort_order, note) VALUES
  ('per', 'PER - Plan Epargne Retraite', 31.4, 3,
   'Taux indicatif sur la sortie en capital du PER. Ajustez-le selon votre situation.')
ON CONFLICT (envelope) DO NOTHING;

NOTIFY pgrst, 'reload schema';
