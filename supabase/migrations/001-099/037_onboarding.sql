-- Onboarding : tour de présentation (obligatoire) + état du guide "Pour bien démarrer"
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS app_tour_done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- onboarding_state : { dismissed, checklist_intro_shown, reserved_consulted, projection_edited }
-- Les autres étapes (compte épargne, récurrence, projet, objectif, reco) sont déduites des données.
