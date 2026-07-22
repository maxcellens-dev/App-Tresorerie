-- ============================================================================
-- 150 — Conseils IA : `ai_extra_credits_balance` doit répondre au SERVICE ROLE (Edge Function).
--
-- BUG : l'Edge Function `ai-advice` lit le solde de crédits payants via
--   admin.rpc('ai_extra_credits_balance', { p_user: user.id })   (client SERVICE ROLE)
-- Or la fonction résolvait l'utilisateur effectif ainsi :
--   eff := CASE WHEN is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
-- Sous service role, `auth.uid()` est NULL et `is_app_admin()` = false (il lit profiles WHERE id =
-- auth.uid()). Donc eff = NULL → SUM(delta) WHERE profile_id = NULL → **0** : le serveur ne voyait
-- JAMAIS les crédits offerts/achetés. Conséquence : quota inclus épuisé → balance 0 → `quota_exceeded`
-- (429) renvoyé, AUCUN ticket créé, l'app affiche le paywall alors que l'utilisateur a des crédits.
--
-- FIX : quand `auth.uid()` est NULL (service role uniquement — un utilisateur authentifié a toujours
-- un uid, et l'exécution est réservée à `authenticated`/service role), on FAIT CONFIANCE à `p_user`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ai_extra_credits_balance(p_user uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; bal int;
BEGIN
  eff := CASE
    WHEN auth.uid() IS NULL THEN p_user                          -- service role (Edge Function) : confiance à p_user
    WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) -- admin : peut consulter un autre utilisateur
    ELSE auth.uid()                                              -- utilisateur normal : soi uniquement
  END;
  IF eff IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(SUM(delta), 0) INTO bal FROM public.ai_extra_credits WHERE profile_id = eff;
  RETURN GREATEST(0, bal);
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_extra_credits_balance(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
