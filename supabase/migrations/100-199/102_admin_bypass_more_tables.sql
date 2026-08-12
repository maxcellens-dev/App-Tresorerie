-- ============================================================================
-- 102 — Bypass ADMIN (impersonation « connecté en tant que ») sur les tables encore manquantes.
--
-- Symptôme : en mode admin impersonation, modifier le montant d'une échéance (override) renvoie 403
-- car l'INSERT pose profile_id = user impersoné ≠ auth.uid() (admin). Idem pour voir/gérer les comptes
-- partagés/joints d'un user visité. On ajoute is_app_admin() aux policies de ces tables.
-- ============================================================================

-- ── transaction_month_overrides ─────────────────────────────────────────────
ALTER TABLE public.transaction_month_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own overrides" ON public.transaction_month_overrides;
DROP POLICY IF EXISTS tmo_all ON public.transaction_month_overrides;
DROP POLICY IF EXISTS tmo_select ON public.transaction_month_overrides;
DROP POLICY IF EXISTS tmo_cud ON public.transaction_month_overrides;
CREATE POLICY tmo_all ON public.transaction_month_overrides FOR ALL
  USING (profile_id = auth.uid() OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR is_app_admin());

-- ── account_members : l'admin voit/gère les membres des comptes d'un user visité ────────────────
DROP POLICY IF EXISTS acct_mem_select ON public.account_members;
DROP POLICY IF EXISTS acct_mem_cud ON public.account_members;
CREATE POLICY acct_mem_select ON public.account_members FOR SELECT USING (acct_can_access(account_id) OR is_app_admin());
CREATE POLICY acct_mem_cud ON public.account_members FOR ALL
  USING (is_app_admin() OR EXISTS(SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.profile_id = auth.uid()))
  WITH CHECK (is_app_admin() OR EXISTS(SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.profile_id = auth.uid()));

-- ── account_invitations : idem ──────────────────────────────────────────────
DROP POLICY IF EXISTS acct_inv_select ON public.account_invitations;
DROP POLICY IF EXISTS acct_inv_insert ON public.account_invitations;
DROP POLICY IF EXISTS acct_inv_update ON public.account_invitations;
DROP POLICY IF EXISTS acct_inv_delete ON public.account_invitations;
CREATE POLICY acct_inv_select ON public.account_invitations FOR SELECT USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR is_app_admin());
CREATE POLICY acct_inv_insert ON public.account_invitations FOR INSERT WITH CHECK ((from_user_id = auth.uid() AND acct_role(account_id) = 'owner') OR is_app_admin());
CREATE POLICY acct_inv_update ON public.account_invitations FOR UPDATE USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR is_app_admin());
CREATE POLICY acct_inv_delete ON public.account_invitations FOR DELETE USING (from_user_id = auth.uid() OR is_app_admin());

-- ── acct_can_access / acct_role : reconnaissent l'admin (pour que la lecture des comptes partagés
--    d'un user visité marche en impersonation, et que les transactions s'affichent). ──────────────
CREATE OR REPLACE FUNCTION public.acct_can_access(p_account uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.is_app_admin()
      OR EXISTS(SELECT 1 FROM public.accounts WHERE id = p_account AND profile_id = auth.uid())
      OR EXISTS(SELECT 1 FROM public.account_members WHERE account_id = p_account AND user_id = auth.uid());
$$;
