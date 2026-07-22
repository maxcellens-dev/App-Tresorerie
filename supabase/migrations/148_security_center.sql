-- ============================================================================
-- 148 — CENTRE DE SÉCURITÉ (admin).
--
--  1) Journal des erreurs/crashs CLIENT (`client_errors`) : l'app remonte ses exceptions non
--     rattrapées, rejets de promesse et erreurs fatales via l'RPC `log_client_error` (ouverte à
--     anon + authenticated, mais bornée et sans lecture). L'admin lit/résout depuis le Centre.
--
--  2) COUPURE GLOBALE (kill switch) : un drapeau dans `app_config.features.app_lockdown_enabled`
--     verrouille l'app pour TOUS les utilisateurs (sauf admins) en cas d'attaque/piratage. La
--     propagation est INSTANTANÉE grâce au realtime sur `app_config` (cf. hook useAppLockdown).
--     `is_app_locked()` expose l'état côté SQL (base d'un futur durcissement RLS des écritures).
--
--  ⚠ Le verrou CLIENT bloque l'usage normal de l'app. Contre une attaque frappant l'API en direct,
--  le rempart ultime reste la mise en pause du projet Supabase / rotation des clés — cf. docs/SECURITY.md.
-- ============================================================================

-- 1) Journal d'erreurs client -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- null si non connecté (écran d'auth)
  platform text,                       -- 'android' | 'ios' | 'web'
  app_version text,
  runtime_version text,
  kind text NOT NULL DEFAULT 'error',  -- 'error' | 'fatal' | 'unhandled_rejection'
  message text NOT NULL,
  stack text,
  route text,                          -- écran où l'erreur s'est produite
  context jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_errors_created ON public.client_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_unresolved ON public.client_errors(resolved, created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
-- Pas d'INSERT/SELECT direct pour le client : l'écriture passe par l'RPC bornée, la lecture est admin.
DROP POLICY IF EXISTS client_errors_admin_read ON public.client_errors;
CREATE POLICY client_errors_admin_read ON public.client_errors
  FOR SELECT USING (public.is_app_admin());
DROP POLICY IF EXISTS client_errors_admin_update ON public.client_errors;
CREATE POLICY client_errors_admin_update ON public.client_errors
  FOR UPDATE USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
DROP POLICY IF EXISTS client_errors_admin_delete ON public.client_errors;
CREATE POLICY client_errors_admin_delete ON public.client_errors
  FOR DELETE USING (public.is_app_admin());

-- RPC de remontée : SECURITY DEFINER, bornée (anti-spam par taille), accessible même déconnecté.
CREATE OR REPLACE FUNCTION public.log_client_error(
  p_kind text, p_message text, p_stack text DEFAULT NULL, p_route text DEFAULT NULL,
  p_platform text DEFAULT NULL, p_app_version text DEFAULT NULL, p_runtime_version text DEFAULT NULL,
  p_context jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN RETURN; END IF;
  INSERT INTO public.client_errors (profile_id, platform, app_version, runtime_version, kind, message, stack, route, context)
  VALUES (
    auth.uid(),
    left(COALESCE(p_platform, ''), 16),
    left(COALESCE(p_app_version, ''), 32),
    left(COALESCE(p_runtime_version, ''), 32),
    CASE WHEN p_kind IN ('error','fatal','unhandled_rejection') THEN p_kind ELSE 'error' END,
    left(p_message, 2000),
    left(COALESCE(p_stack, ''), 8000),
    left(COALESCE(p_route, ''), 200),
    p_context
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, text, text, text, text, jsonb) TO anon, authenticated;

-- Compteur d'erreurs non résolues (badge admin), + purge des vieilles entrées (admin).
CREATE OR REPLACE FUNCTION public.client_errors_purge(p_before timestamptz DEFAULT (now() - interval '30 days'))
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.client_errors WHERE created_at < p_before;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
GRANT EXECUTE ON FUNCTION public.client_errors_purge(timestamptz) TO authenticated;

-- 2) État de coupure globale (lecture SQL) -----------------------------------
CREATE OR REPLACE FUNCTION public.is_app_locked()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((features->>'app_lockdown_enabled')::boolean, false)
  FROM public.app_config WHERE id = 'default';
$$;
GRANT EXECUTE ON FUNCTION public.is_app_locked() TO anon, authenticated;

-- Propagation temps réel du verrou : app_config publié (le hook client relit `features` à l'instant).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Publie aussi client_errors pour un badge admin en temps réel (facultatif, sans surcoût client).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'client_errors'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.client_errors;
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
