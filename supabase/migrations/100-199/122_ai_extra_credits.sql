-- ============================================================================
-- 122 — Conseils IA : CLICK-TO-PAY (crédits de requêtes à l'unité).
--
-- Modèle : le quota mensuel (gratuit/Premium) s'appuie sur les clés Gemini GRATUITES (cap global
-- quotidien). Les requêtes PAYÉES (rechargées) sont adossées à une clé Gemini PAYANTE dédiée
-- (GEMINI_API_KEY_PAID côté Edge Function), donc PAS de cap commun. À l'achat, on crédite l'utilisateur
-- de N requêtes dans un LEDGER append-only ; quand le quota mensuel est épuisé, l'Edge Function
-- consomme 1 crédit payant et route l'appel sur la clé payante.
--
-- Le CRÉDIT (achat) est ajouté par un backend de confiance (webhook RevenueCat / RPC admin), JAMAIS
-- par le client directement. La CONSOMMATION est faite par l'Edge Function (service role).
-- ============================================================================

-- 1) Ledger des crédits payants (append-only : +N achat, -1 consommation) -----
CREATE TABLE IF NOT EXISTS public.ai_extra_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta integer NOT NULL,                 -- +N (achat/offre) ou -1 (consommation d'une requête payée)
  reason text NOT NULL DEFAULT 'purchase',-- 'purchase' | 'consumption' | 'admin_grant' | 'refund'
  ref text,                               -- product_id / transaction RevenueCat / id du message consommé
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_extra_credits_profile ON public.ai_extra_credits(profile_id, created_at);
ALTER TABLE public.ai_extra_credits ENABLE ROW LEVEL SECURITY;
-- Lecture seule (soi / admin). Aucune policy INSERT/DELETE → écriture réservée au service role / RPC.
DROP POLICY IF EXISTS ai_extra_credits_select ON public.ai_extra_credits;
CREATE POLICY ai_extra_credits_select ON public.ai_extra_credits
  FOR SELECT USING (profile_id = auth.uid() OR is_app_admin());

-- 2) Solde de crédits payants (somme des deltas) -----------------------------
CREATE OR REPLACE FUNCTION public.ai_extra_credits_balance(p_user uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; bal int;
BEGIN
  eff := CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
  SELECT COALESCE(SUM(delta), 0) INTO bal FROM public.ai_extra_credits WHERE profile_id = eff;
  RETURN GREATEST(0, bal);
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_extra_credits_balance(uuid) TO authenticated;

-- 3) Octroi de crédits par un ADMIN (test / support / geste commercial) -------
--    L'achat réel passera par le webhook RevenueCat (service role) qui insère directement.
CREATE OR REPLACE FUNCTION public.ai_grant_extra_credits(p_user uuid, p_qty integer, p_reason text DEFAULT 'admin_grant')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
  INSERT INTO public.ai_extra_credits (profile_id, delta, reason, ref)
  VALUES (p_user, p_qty, COALESCE(NULLIF(p_reason, ''), 'admin_grant'), 'admin:' || auth.uid());
  RETURN public.ai_extra_credits_balance(p_user);
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_grant_extra_credits(uuid, integer, text) TO authenticated;

-- 4) Offres de recharge (packs), éditables par l'admin. product_id = identifiant RevenueCat/Store.
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS extra_credit_packs jsonb NOT NULL DEFAULT '[
    {"id":"pack_5","credits":5,"price_cents":199,"product_id":"ai_credits_5"},
    {"id":"pack_25","credits":25,"price_cents":399,"product_id":"ai_credits_25"},
    {"id":"pack_100","credits":100,"price_cents":1199,"product_id":"ai_credits_100"}
  ]'::jsonb;

-- 5) Le quota renvoie aussi le solde de crédits payants (pour l'UI + la décision d'envoi).
CREATE OR REPLACE FUNCTION public.ai_my_quota(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; used int; lim int; prem boolean; extra int; cfg public.ai_config;
BEGIN
  eff := CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
  SELECT * INTO cfg FROM public.ai_config WHERE id = 'default';
  SELECT COALESCE(is_premium, false) INTO prem FROM public.profiles WHERE id = eff;
  SELECT count(*) INTO used FROM public.ai_usage
    WHERE profile_id = eff AND created_at >= date_trunc('month', now());
  SELECT COALESCE(SUM(delta), 0) INTO extra FROM public.ai_extra_credits WHERE profile_id = eff;
  lim := CASE WHEN prem THEN cfg.premium_monthly_limit ELSE cfg.free_monthly_limit END;
  RETURN jsonb_build_object(
    'used', used, 'limit', lim, 'remaining', GREATEST(0, lim - used),
    'is_premium', prem, 'extra_credits', GREATEST(0, extra)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_my_quota(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
