-- ============================================================================
-- 101 — Réparation des policies accounts/transactions + bypass ADMIN (impersonation).
--
-- Symptôme : « new row violates row-level security policy for table accounts » à la création d'un
-- compte (joint ou non) — y compris pour un VRAI utilisateur. Cause probable : 096 a droppé l'ancienne
-- policy mais la nouvelle policy INSERT n'a pas été (re)créée → plus aucune policy permissive → tout
-- INSERT est refusé. On réassoit donc proprement les policies (idempotent).
--
-- + Bypass ADMIN : le mode admin « connecté en tant que » (impersonation) substitue l'id de données
-- mais garde l'auth réelle de l'admin → un INSERT avec profile_id = user impersoné échouait
-- (profile_id ≠ auth.uid()). On autorise donc l'admin à écrire pour le compte d'un autre.
-- ============================================================================

-- Fonction admin (SECURITY DEFINER → lit profiles sans RLS).
CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false);
$$;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- ── ACCOUNTS ────────────────────────────────────────────────────────────────
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own accounts" ON public.accounts;
DROP POLICY IF EXISTS accounts_select ON public.accounts;
DROP POLICY IF EXISTS accounts_insert ON public.accounts;
DROP POLICY IF EXISTS accounts_update ON public.accounts;
DROP POLICY IF EXISTS accounts_delete ON public.accounts;
-- IMPORTANT : la branche DIRECTE `profile_id = auth.uid()` doit venir EN PREMIER. Sinon, lors d'un
-- INSERT ... RETURNING (PostgREST .select()), la relecture de la ligne passe uniquement par
-- acct_can_access() (STABLE/SECURITY DEFINER) qui ne « voit » pas encore la ligne insérée → la
-- relecture est refusée et PostgREST renvoie « new row violates row-level security policy ».
CREATE POLICY accounts_select ON public.accounts FOR SELECT USING (profile_id = auth.uid() OR acct_can_access(id) OR is_app_admin());
CREATE POLICY accounts_insert ON public.accounts FOR INSERT WITH CHECK (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY accounts_update ON public.accounts FOR UPDATE USING (profile_id = auth.uid() OR is_app_admin()) WITH CHECK (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY accounts_delete ON public.accounts FOR DELETE USING (profile_id = auth.uid() OR is_app_admin());

-- ── TRANSACTIONS ─────────────────────────────────────────────────────────────
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own transactions" ON public.transactions;
DROP POLICY IF EXISTS transactions_select ON public.transactions;
DROP POLICY IF EXISTS transactions_insert ON public.transactions;
DROP POLICY IF EXISTS transactions_update ON public.transactions;
DROP POLICY IF EXISTS transactions_delete ON public.transactions;
-- SELECT : mes lignes, OU compte accessible (read = passé seulement), OU admin.
CREATE POLICY transactions_select ON public.transactions FOR SELECT USING (
  is_app_admin()
  OR profile_id = auth.uid()
  OR (
    acct_can_access(account_id)
    AND (acct_role(account_id) <> 'read' OR (date <= current_date AND COALESCE(is_draft, false) = false))
  )
);
-- INSERT : ma ligne sur un compte owner/write, OU admin.
CREATE POLICY transactions_insert ON public.transactions FOR INSERT WITH CHECK (
  is_app_admin() OR (profile_id = auth.uid() AND acct_role(account_id) IN ('owner','write'))
);
-- UPDATE/DELETE : ma ligne, OU owner/write du compte, OU admin.
CREATE POLICY transactions_update ON public.transactions FOR UPDATE
  USING (is_app_admin() OR profile_id = auth.uid() OR acct_role(account_id) IN ('owner','write'))
  WITH CHECK (is_app_admin() OR profile_id = auth.uid() OR acct_role(account_id) IN ('owner','write'));
CREATE POLICY transactions_delete ON public.transactions FOR DELETE
  USING (is_app_admin() OR profile_id = auth.uid() OR acct_role(account_id) IN ('owner','write'));
