-- ============================================================================
-- 103 — Trois chantiers :
--   #2  override_date : déplacer la date d'UNE échéance d'une récurrente (sans toucher la série).
--   #5  impact_pct    : % d'impact d'un compte partagé/joint dans l'app de CHAQUE participant.
--   #4b on_behalf     : virement saisi « au nom de » un membre non-user (simuler sa participation).
-- ============================================================================

-- ── #2 : date d'override par occurrence (en plus du montant) ─────────────────
ALTER TABLE public.transaction_month_overrides
  ADD COLUMN IF NOT EXISTS override_date date;
-- override_amount devient optionnel (on peut overrider seulement la date).
ALTER TABLE public.transaction_month_overrides
  ALTER COLUMN override_amount DROP NOT NULL;

-- ── #5 : % d'impact par participant ─────────────────────────────────────────
-- NULL = « auto » : part égale = 100 / nombre de participants (owner + membres). Une valeur explicite
-- (0..100) prime. N'importe quel membre RÉEL peut éditer le % de tout le monde (RPC ci-dessous).
ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS impact_pct integer CHECK (impact_pct IS NULL OR (impact_pct >= 0 AND impact_pct <= 100));
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS owner_impact_pct integer CHECK (owner_impact_pct IS NULL OR (owner_impact_pct >= 0 AND owner_impact_pct <= 100));

-- Régler le % de l'owner OU d'un membre. Autorisé à tout participant RÉEL (user_id) du compte,
-- ou à l'admin. p_member_id NULL → on règle la part de l'OWNER ; sinon celle du membre visé.
CREATE OR REPLACE FUNCTION public.acct_set_impact(p_account uuid, p_member_id uuid, p_pct integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  IF p_pct IS NOT NULL AND (p_pct < 0 OR p_pct > 100) THEN RAISE EXCEPTION 'pct hors bornes'; END IF;
  v_ok := public.is_app_admin()
       OR EXISTS(SELECT 1 FROM public.accounts a WHERE a.id = p_account AND a.profile_id = auth.uid())
       OR EXISTS(SELECT 1 FROM public.account_members m WHERE m.account_id = p_account AND m.user_id = auth.uid());
  IF NOT v_ok THEN RAISE EXCEPTION 'accès refusé'; END IF;
  IF p_member_id IS NULL THEN
    UPDATE public.accounts SET owner_impact_pct = p_pct WHERE id = p_account;
  ELSE
    UPDATE public.account_members SET impact_pct = p_pct WHERE id = p_member_id AND account_id = p_account;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.acct_set_impact(uuid, uuid, integer) TO authenticated;

-- ── #4b : virement « au nom de » un membre (non-user) ───────────────────────
-- La transaction est créée par profile_id (le saisisseur) mais ATTRIBUÉE à ce membre pour l'affichage
-- (« par {nom} ») et pour simuler sa participation sur le compte joint.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS on_behalf_member_id uuid REFERENCES public.account_members(id) ON DELETE SET NULL;
