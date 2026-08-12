-- Migration 031 : Marge de sécurité en montant fixe (€) au lieu d'un pourcentage
--
-- La notion de "marge de sécurité" devient un montant minimum conservé sur les
-- comptes courants, saisi par l'utilisateur (Q8 du questionnaire).
-- L'ancienne colonne safety_margin_percent est conservée en base pour
-- compatibilité (non utilisée par l'app après cette migration).

-- 1. Nouveau champ sur profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS safety_margin_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- 2. Nouvelle colonne q8 sur les réponses au questionnaire
ALTER TABLE user_questionnaire_answers
  ADD COLUMN IF NOT EXISTS q8 TEXT NOT NULL DEFAULT '';
