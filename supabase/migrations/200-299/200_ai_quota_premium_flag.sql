-- ============================================================================
-- 200 — Conseils IA : le compteur affiché doit utiliser la MÊME définition de « Premium »
--       que le serveur qui applique le quota.
--
-- Problème constaté : `ai_my_quota` lisait `profiles.is_premium` NU, alors que l'Edge Function
-- `ai-advice` (et tout le client, via `usePlan`) définit Premium comme
--     app_config.features.premium_enabled  ET  profiles.is_premium
-- Quand l'offre Premium est coupée globalement (drapeau à false — c'est le DÉFAUT), un porteur du
-- droit voyait donc « 10 / 10 requêtes » (quota Premium) mais se faisait refuser dès la 2ᵉ
-- (quota gratuit appliqué côté serveur) : compteur faux et mur incompréhensible.
--
-- Correctif : même règle des deux côtés. Aucune autre modification (extra_credits, exclusion des
-- bascules payantes éditeur, etc. restent tels quels).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ai_my_quota(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; used int; lim int; prem boolean; prem_on boolean; extra int; cfg public.ai_config;
BEGIN
  eff := CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
  SELECT * INTO cfg FROM public.ai_config WHERE id = 'default';
  -- Offre Premium activée globalement (même lecture que l'Edge Function et que usePlan côté client).
  SELECT COALESCE((features->>'premium_enabled')::boolean, false) INTO prem_on
    FROM public.app_config WHERE id = 'default';
  SELECT COALESCE(prem_on, false) AND COALESCE(is_premium, false) INTO prem FROM public.profiles WHERE id = eff;
  SELECT count(*) INTO used FROM public.ai_usage
    WHERE profile_id = eff AND paid_fallback = false AND created_at >= date_trunc('month', now());
  SELECT COALESCE(SUM(delta), 0) INTO extra FROM public.ai_extra_credits WHERE profile_id = eff;
  lim := CASE WHEN prem THEN cfg.premium_monthly_limit ELSE cfg.free_monthly_limit END;
  RETURN jsonb_build_object(
    'used', used, 'limit', lim, 'remaining', GREATEST(0, lim - used),
    'is_premium', COALESCE(prem, false), 'extra_credits', GREATEST(0, extra)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_my_quota(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
