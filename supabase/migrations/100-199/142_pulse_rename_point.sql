-- ============================================================================
-- 142 — RENOMMAGE « Pouls » → « Le Point ».
--
-- Le terme visible « Pouls » (trop médical) devient « Le Point » (le point de la semaine / hebdo),
-- plus financier. Les identifiants INTERNES (colonne app_config.pulse, table pulse_snapshots,
-- id de notification pulse_weekly) restent inchangés : seul le TEXTE vu par l'utilisateur change.
--
-- Ici : le texte de la notification hebdo STOCKÉ (seedé par la migration 140). On ne le met à jour
-- que s'il est encore EXACTEMENT le défaut de la 140 (l'admin ne l'a pas personnalisé).
-- ============================================================================

UPDATE public.app_config
SET pulse = jsonb_set(
  jsonb_set(pulse, '{weeklyPush,title}', '"Ton point de la semaine 🧭"'::jsonb),
  '{weeklyPush,body}', '"Ouvre Relyka pour voir où tu en es cette semaine."'::jsonb
)
WHERE id = 'default'
  AND pulse -> 'weeklyPush' ->> 'title' = 'Ton pouls de la semaine 🫀';
