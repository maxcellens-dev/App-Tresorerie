-- ─────────────────────────────────────────────────────────────
-- 035 — Budget variable hebdomadaire (onboarding)
-- Sert de valeur de repli pour l'« Enveloppe des dépenses variables »
-- quand l'historique (M-1..M-6) est insuffisant (< 2 mois de données).
-- Question q9 : "Combien dépensez-vous environ pour vos
-- courses, loisirs et dépenses variables ?" (× 4.33 → mensuel)
-- ─────────────────────────────────────────────────────────────

-- Montant hebdomadaire estimé (€/semaine). NULL = non renseigné.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS weekly_variable_budget NUMERIC(14, 2);

-- Réponse brute q9 du questionnaire (chaîne, comme les autres réponses).
ALTER TABLE user_questionnaire_answers
  ADD COLUMN IF NOT EXISTS q9 TEXT DEFAULT '';

NOTIFY pgrst, 'reload schema';
