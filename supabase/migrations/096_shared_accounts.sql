-- ============================================================================
-- 096 — Comptes partagés / joints (Lot 1 : socle).
--
-- Un compte appartient à un owner (accounts.profile_id) et peut être PARTAGÉ avec d'autres
-- utilisateurs via account_members (rôle owner/write/read). Deux usages sur la même mécanique :
--   • compte JOINT dédié (accounts.is_joint = true) — toujours actif ;
--   • partage d'un compte PERSO existant en consultation (read) ou écriture (write) — gated en admin
--     côté application (flag perso_account_sharing_enabled), pas ici.
--
-- Règles clés :
--   • SELECT élargi aux membres ; un membre `read` ne voit que le PASSÉ (date<=today, hors brouillons).
--   • Mutations de transactions : chacun ne gère QUE ses propres lignes (profile_id = auth.uid()),
--     et seulement sur un compte dont il est owner/write.
--   • Le solde se recalcule par compte (Σ par account_id) → fiable pour tous les membres.
--   • Aucune exclusion d'agrégat ici : le pilotage perso filtre côté client
--     (compte compté seulement si profile_id = moi ET is_joint = false).
-- ============================================================================

-- 1) FLAG sur les comptes -----------------------------------------------------
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS is_joint boolean NOT NULL DEFAULT false;

-- 2) TABLES -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = invité non-inscrit (simple nom)
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'write' CHECK (role IN ('owner','write','read')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_members_unique_user
  ON public.account_members(account_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_members_account ON public.account_members(account_id);
CREATE INDEX IF NOT EXISTS account_members_user ON public.account_members(user_id);

CREATE TABLE IF NOT EXISTS public.account_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_member_id uuid REFERENCES public.account_members(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'write' CHECK (role IN ('write','read')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_invitations_unique_pending
  ON public.account_invitations(account_id, to_user_id) WHERE status = 'pending';

-- 3) CONTRÔLE D'ACCÈS (SECURITY DEFINER → pas de récursion RLS) ---------------
-- Accès = owner du compte OU membre.
CREATE OR REPLACE FUNCTION public.acct_can_access(p_account uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.accounts WHERE id = p_account AND profile_id = auth.uid())
      OR EXISTS(SELECT 1 FROM public.account_members WHERE account_id = p_account AND user_id = auth.uid());
$$;

-- Rôle de l'appelant sur un compte : 'owner' | 'write' | 'read' | NULL (aucun accès).
CREATE OR REPLACE FUNCTION public.acct_role(p_account uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS(SELECT 1 FROM public.accounts WHERE id = p_account AND profile_id = auth.uid()) THEN 'owner'
    ELSE (SELECT role FROM public.account_members WHERE account_id = p_account AND user_id = auth.uid() LIMIT 1)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.acct_can_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acct_role(uuid) TO authenticated;

-- 4) RLS NOUVELLES TABLES -----------------------------------------------------
ALTER TABLE public.account_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acct_mem_select ON public.account_members;
DROP POLICY IF EXISTS acct_mem_cud ON public.account_members;
-- Lecture : tout membre du compte voit la liste des membres.
CREATE POLICY acct_mem_select ON public.account_members FOR SELECT USING (acct_can_access(account_id));
-- Écriture directe : owner du compte uniquement (les invités sont ajoutés via RPC SECURITY DEFINER).
CREATE POLICY acct_mem_cud ON public.account_members FOR ALL
  USING (EXISTS(SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.profile_id = auth.uid()));

DROP POLICY IF EXISTS acct_inv_select ON public.account_invitations;
DROP POLICY IF EXISTS acct_inv_insert ON public.account_invitations;
DROP POLICY IF EXISTS acct_inv_update ON public.account_invitations;
DROP POLICY IF EXISTS acct_inv_delete ON public.account_invitations;
CREATE POLICY acct_inv_select ON public.account_invitations FOR SELECT USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY acct_inv_insert ON public.account_invitations FOR INSERT WITH CHECK (from_user_id = auth.uid() AND acct_role(account_id) = 'owner');
CREATE POLICY acct_inv_update ON public.account_invitations FOR UPDATE USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY acct_inv_delete ON public.account_invitations FOR DELETE USING (from_user_id = auth.uid());

-- 5) RLS ACCOUNTS — élargie aux membres en lecture ---------------------------
DROP POLICY IF EXISTS "Users can CRUD own accounts" ON public.accounts;
DROP POLICY IF EXISTS accounts_select ON public.accounts;
DROP POLICY IF EXISTS accounts_insert ON public.accounts;
DROP POLICY IF EXISTS accounts_update ON public.accounts;
DROP POLICY IF EXISTS accounts_delete ON public.accounts;
-- SELECT : owner (branche DIRECTE en premier, indispensable pour la relecture d'un INSERT...RETURNING
-- — sinon acct_can_access() STABLE ne voit pas la ligne juste insérée → « violates RLS ») OU membre.
CREATE POLICY accounts_select ON public.accounts FOR SELECT USING (profile_id = auth.uid() OR acct_can_access(id));
-- INSERT/UPDATE/DELETE : owner uniquement. (Le recalcul du solde par un membre passe par une fonction
-- SECURITY DEFINER, donc les membres n'ont PAS besoin d'UPDATE direct ici.)
CREATE POLICY accounts_insert ON public.accounts FOR INSERT WITH CHECK (profile_id = auth.uid());
CREATE POLICY accounts_update ON public.accounts FOR UPDATE USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY accounts_delete ON public.accounts FOR DELETE USING (profile_id = auth.uid());

-- 6) RLS TRANSACTIONS — lecture commune, écriture = ses propres lignes --------
DROP POLICY IF EXISTS "Users can CRUD own transactions" ON public.transactions;
DROP POLICY IF EXISTS transactions_select ON public.transactions;
DROP POLICY IF EXISTS transactions_insert ON public.transactions;
DROP POLICY IF EXISTS transactions_update ON public.transactions;
DROP POLICY IF EXISTS transactions_delete ON public.transactions;
-- SELECT : mes lignes, OU les lignes d'un compte auquel j'ai accès ; si rôle `read` → passé seulement.
CREATE POLICY transactions_select ON public.transactions FOR SELECT USING (
  profile_id = auth.uid()
  OR (
    acct_can_access(account_id)
    AND (
      acct_role(account_id) <> 'read'
      OR (date <= current_date AND COALESCE(is_draft, false) = false)
    )
  )
);
-- INSERT : ma ligne, sur un compte dont je suis owner/write.
CREATE POLICY transactions_insert ON public.transactions FOR INSERT WITH CHECK (
  profile_id = auth.uid() AND acct_role(account_id) IN ('owner','write')
);
-- UPDATE/DELETE : uniquement MES propres lignes (décision « chacun gère les siennes »).
CREATE POLICY transactions_update ON public.transactions FOR UPDATE USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY transactions_delete ON public.transactions FOR DELETE USING (profile_id = auth.uid());

-- 7) recompute_account_balance → SECURITY DEFINER ----------------------------
-- ATTENTION : on NE redéfinit PAS le corps (la dernière version = migration 093, ancre regul_target).
-- On flippe seulement l'attribut de sécurité : un membre `write` non-owner doit pouvoir déclencher le
-- recalcul du solde d'un compte partagé (sinon la RLS accounts bloque l'UPDATE balance). Le corps reste
-- celui de 093 → la régularisation continue de tomber pile sur sa cible.
ALTER FUNCTION public.recompute_account_balance(uuid, date) SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.recompute_account_balance(uuid, date) TO authenticated;

-- 8) REALTIME — tables légères publiées (le client déclenche le refetch des transactions sur
--    changement de solde du compte). Sans échec si déjà présent / publication absente.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.accounts;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.account_members;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.account_invitations;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
