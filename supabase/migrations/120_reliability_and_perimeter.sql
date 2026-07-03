-- ============================================================================
-- 120 — Package « Fiabilité / Confiance / Clôture » + « Périmètre quotidien ».
--
-- Additif et rétro-compatible. Ne réécrit aucune donnée existante.
--   • month_closures.status : 'confirmed' (clôture explicite) | 'estimated' (mois passé non
--     confirmé). Les mois 'estimated' sont EXCLUS des baselines (dérive, moyennes variables, σ).
--     Les clôtures déjà présentes = 'confirmed' (elles étaient explicites).
--   • accounts.shared_mode : 'contribution' | 'tracked' — mode d'un compte partagé/joint.
--     NULL = non répondu → interprété comme 'tracked' (comportement historique inchangé).
--   • profiles.reliability_calib : calibration de la dérive PAR USER (médianes écarts/jours),
--     recalculée à chaque vérification. NULL = cold start (dérive prudente par défaut).
--   • app_config.reliability / system_notifications : réglages ADMIN (seuils de doute,
--     catalogue de notifications système avec activation).
-- ============================================================================

-- 1) Clôture : statut souple (remplace le verrou dur, qui n'est plus posé côté app) -----------
ALTER TABLE public.month_closures
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed'
  CHECK (status IN ('confirmed', 'estimated'));

-- 2) Comptes partagés : mode d'usage (périmètre quotidien), PAR PARTICIPANT (comme le %).
--    accounts.shared_mode = mode du PROPRIÉTAIRE ; account_members.shared_mode = mode de chaque membre.
--    NULL = non répondu → interprété 'tracked' (comportement historique).
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS shared_mode text
  CHECK (shared_mode IN ('contribution', 'tracked'));
ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS shared_mode text
  CHECK (shared_mode IN ('contribution', 'tracked'));

-- 3) Calibration de fiabilité par user (dérive auto-apprise) -----------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reliability_calib jsonb;

-- 3bis) RPC : chaque participant règle SON PROPRE mode (owner → accounts, membre → account_members).
CREATE OR REPLACE FUNCTION public.acct_set_shared_mode(p_account uuid, p_mode text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_mode IS NOT NULL AND p_mode NOT IN ('contribution', 'tracked') THEN
    RAISE EXCEPTION 'mode invalide';
  END IF;
  -- Doit être un participant réel du compte.
  IF NOT public.acct_can_access(p_account) THEN
    RAISE EXCEPTION 'accès refusé';
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account AND profile_id = auth.uid()) THEN
    UPDATE public.accounts SET shared_mode = p_mode WHERE id = p_account;
  ELSE
    UPDATE public.account_members SET shared_mode = p_mode
      WHERE account_id = p_account AND user_id = auth.uid();
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.acct_set_shared_mode(uuid, text) TO authenticated;

-- 4) Réglages ADMIN (tunables + catalogue de notifications système) ----------------------------
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS reliability jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS system_notifications jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
