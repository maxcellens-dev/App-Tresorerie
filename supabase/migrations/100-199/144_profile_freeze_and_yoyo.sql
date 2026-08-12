-- ============================================================================
-- 144 — Profils financiers : anti-yoyo à 1 mois, gel initial à 2 mois.
--
--  • Anti-yoyo (montée) : 1 mois de conditions remplies suffit désormais (au lieu de 2) —
--    les descentes restent immédiates, et les chutes exceptionnelles prioritaires.
--  • Gel initial : 2 mois (au lieu de 6) avant qu'un changement AUTOMATIQUE de profil soit
--    possible après le questionnaire — SAUF cas exceptionnels (chute de revenus), qui passent
--    désormais MÊME pendant le gel (côté client, useAutoProfileEvaluation).
--    NB : le client posait auto_unlock_at à +6 mois EN DUR sans lire freeze_months (corrigé) ;
--    la config admin « Durée de gel » est maintenant réellement appliquée.
-- ============================================================================

-- 1) Config : toutes les transitions passent à anti-yoyo 1 mois / gel 2 mois.
UPDATE public.profile_matrix_config SET anti_yoyo_months = 1, freeze_months = 2;

ALTER TABLE public.profile_matrix_config ALTER COLUMN anti_yoyo_months SET DEFAULT 1;
ALTER TABLE public.profile_matrix_config ALTER COLUMN freeze_months SET DEFAULT 2;

-- 2) Utilisateurs déjà gelés (auto_unlock_at posé à +6 mois) : raccourci à assigned_at + 2 mois
--    (jamais rallongé : LEAST garde la date la plus proche).
UPDATE public.user_financial_profile
SET auto_unlock_at = LEAST(auto_unlock_at, assigned_at + interval '2 months'),
    updated_at = now()
WHERE auto_unlock_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
