-- Migration 045 : Seuil d'affichage « Conserver »
--
-- Ajoute un seuil minimum (en €) pour recommander une conservation, au même titre que
-- les seuils Épargne / Investissement / Se faire plaisir. La reco « Conserver » n'est
-- affichée que si le montant net à conserver atteint ce seuil.

ALTER TABLE recommendation_settings
  ADD COLUMN IF NOT EXISTS seuil_reco_conserver NUMERIC(12,2) NOT NULL DEFAULT 50;
