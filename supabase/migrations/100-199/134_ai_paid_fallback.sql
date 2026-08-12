-- ============================================================================
-- 134 — Conseils IA : bascule automatique sur la clé PAYANTE (pay-per-use dev) quand le quota
-- gratuit d'un user est épuisé, SANS passer par un achat in-app.
--
-- Contexte : le chemin payant existait déjà mais ne se déclenchait QUE si l'utilisateur avait un
-- solde de crédits ACHETÉS > 0 (achat in-app non branché → impasse paywall). Ce flag permet, en
-- phase de lancement, de continuer à servir sur la clé facturée (GEMINI_API_KEY_PAID) : le coût
-- Gemini est absorbé par l'éditeur, l'utilisateur n'a pas de mur.
--
-- ⚠ Requiert le secret GEMINI_API_KEY_PAID (clé avec facturation Google activée) sinon la bascule
-- retombe sur les clés gratuites (rate-limitées) — sans intérêt.
-- ============================================================================

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS paid_fallback_enabled boolean NOT NULL DEFAULT false;

-- Marque les usages servis par la bascule payante éditeur (suivi du volume/coût, distinct du quota).
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS paid_fallback boolean NOT NULL DEFAULT false;

-- Marque les usages passés par la clé PAYANTE (premium inclus + fallback + crédits) : ils ne
-- tapent PAS dans le pool gratuit partagé → exclus du plafond global quotidien (daily_global_cap).
-- But : les PREMIUM utilisent directement la clé facturée, laissant le gratuit aux non-premium.
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS paid_key boolean NOT NULL DEFAULT false;

-- Le quota mensuel ne compte QUE les requêtes incluses (les bascules payantes éditeur sont hors quota).
CREATE OR REPLACE FUNCTION public.ai_my_quota(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; used int; lim int; prem boolean; cfg public.ai_config;
BEGIN
  eff := CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
  SELECT * INTO cfg FROM public.ai_config WHERE id = 'default';
  SELECT COALESCE(is_premium, false) INTO prem FROM public.profiles WHERE id = eff;
  SELECT count(*) INTO used FROM public.ai_usage
    WHERE profile_id = eff AND paid_fallback = false AND created_at >= date_trunc('month', now());
  lim := CASE WHEN prem THEN cfg.premium_monthly_limit ELSE cfg.free_monthly_limit END;
  RETURN jsonb_build_object('used', used, 'limit', lim, 'remaining', GREATEST(0, lim - used), 'is_premium', prem);
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_my_quota(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
