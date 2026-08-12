-- ============================================================================
-- 141 — POULS : 5 signaux par profil (le maximum) pour P1 et P5.
--
-- La migration 140 posait des défauts à 4 signaux pour P1 et P5. Décision produit : chaque profil
-- affiche 5 signaux par défaut (pas de plafond — l'admin en met autant qu'il veut) — on ajoute
-- « Jamais dans le rouge » (no_overdraft) aux deux profils concernés.
--
-- On ne touche la config STOCKÉE que si elle est encore EXACTEMENT celle de la migration 140
-- (l'admin n'y a pas touché) : une sélection personnalisée dans l'écran admin est respectée.
-- ============================================================================

UPDATE public.app_config
SET pulse = jsonb_set(
  pulse,
  '{signalsByProfile,P1}',
  '["end_of_month", "spending", "cushion", "no_overdraft", "projects"]'::jsonb
)
WHERE id = 'default'
  AND pulse -> 'signalsByProfile' -> 'P1' = '["end_of_month", "spending", "cushion", "projects"]'::jsonb;

UPDATE public.app_config
SET pulse = jsonb_set(
  pulse,
  '{signalsByProfile,P5}',
  '["investing", "wealth", "cushion", "no_overdraft", "projects"]'::jsonb
)
WHERE id = 'default'
  AND pulse -> 'signalsByProfile' -> 'P5' = '["investing", "wealth", "cushion", "projects"]'::jsonb;
