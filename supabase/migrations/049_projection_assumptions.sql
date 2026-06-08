-- Migration 049 : Persistance des hypothèses de Projection (apports, rendement, durée…)
--
-- Avant : stockées en localStorage (web), perdues/non synchronisées → les valeurs revenaient
-- aux valeurs par défaut. Désormais stockées en base sur le profil.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS projection_assumptions JSONB;
