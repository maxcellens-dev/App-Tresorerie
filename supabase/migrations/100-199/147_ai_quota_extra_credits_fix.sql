-- ============================================================================
-- 147 — Conseils IA : RÉTABLIT le solde de crédits payants dans `ai_my_quota`.
--
-- Régression : la migration 134 (bascule payante éditeur) a réécrit `ai_my_quota` pour ne compter
-- que les requêtes incluses (exclusion des bascules `paid_fallback`), mais a AU PASSAGE supprimé le
-- champ `extra_credits` du JSON renvoyé (présent depuis la 122). Conséquence : côté client
-- (`useAiQuota` → `quota.extra_credits`), le solde est toujours `undefined` → `0`. Les crédits
-- offerts par l'admin (`ai_grant_extra_credits`) ou achetés (webhook RevenueCat) sont bien inscrits
-- au ledger `ai_extra_credits`, mais N'APPARAISSENT JAMAIS dans le compteur de l'utilisateur
-- (`available = remaining + extraCredits`, `totalRequests = limit + extraCredits`).
--
-- Correctif : on réintroduit `extra_credits` (somme des deltas du ledger) tout en conservant la
-- logique 134 (le quota mensuel ne compte que les usages inclus, hors bascule payante éditeur).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ai_my_quota(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; used int; lim int; prem boolean; extra int; cfg public.ai_config;
BEGIN
  eff := CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
  SELECT * INTO cfg FROM public.ai_config WHERE id = 'default';
  SELECT COALESCE(is_premium, false) INTO prem FROM public.profiles WHERE id = eff;
  SELECT count(*) INTO used FROM public.ai_usage
    WHERE profile_id = eff AND paid_fallback = false AND created_at >= date_trunc('month', now());
  SELECT COALESCE(SUM(delta), 0) INTO extra FROM public.ai_extra_credits WHERE profile_id = eff;
  lim := CASE WHEN prem THEN cfg.premium_monthly_limit ELSE cfg.free_monthly_limit END;
  RETURN jsonb_build_object(
    'used', used, 'limit', lim, 'remaining', GREATEST(0, lim - used),
    'is_premium', prem, 'extra_credits', GREATEST(0, extra)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_my_quota(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
