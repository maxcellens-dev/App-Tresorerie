-- ============================================================================
-- 110 — CRÉDITS PARTAGÉS : inviter des users en consultation/écriture sur un crédit.
-- But : un crédit créé par l'un APPARAÎT chez les invités (lecture/écriture) sans avoir à le recréer.
-- Pas de lien avec les comptes des invités (le compte de prélèvement reste celui du propriétaire ;
-- l'invité ne le voit que s'il y a lui-même accès). Calqué sur les comptes partagés (096/097).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.credit_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = invitation en attente
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'write' CHECK (role IN ('write','read')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_members_unique_user ON public.credit_members(credit_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_members_credit ON public.credit_members(credit_id);
CREATE INDEX IF NOT EXISTS credit_members_user ON public.credit_members(user_id);

CREATE TABLE IF NOT EXISTS public.credit_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_member_id uuid REFERENCES public.credit_members(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'write' CHECK (role IN ('write','read')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_invitations_unique_pending ON public.credit_invitations(credit_id, to_user_id) WHERE status = 'pending';

-- Contrôle d'accès (SECURITY DEFINER → pas de récursion RLS).
CREATE OR REPLACE FUNCTION public.credit_can_access(p_credit uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.is_app_admin()
      OR EXISTS(SELECT 1 FROM public.credits WHERE id = p_credit AND profile_id = auth.uid())
      OR EXISTS(SELECT 1 FROM public.credit_members WHERE credit_id = p_credit AND user_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.credit_role(p_credit uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS(SELECT 1 FROM public.credits WHERE id = p_credit AND profile_id = auth.uid()) THEN 'owner'
    ELSE (SELECT role FROM public.credit_members WHERE credit_id = p_credit AND user_id = auth.uid() LIMIT 1)
  END;
$$;
GRANT EXECUTE ON FUNCTION public.credit_can_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_role(uuid) TO authenticated;

-- RLS credits : lecture élargie aux membres (branche DIRECTE profile_id en premier pour la relecture
-- post-insert), écriture = owner ou membre 'write' (ou admin).
DROP POLICY IF EXISTS credits_all ON public.credits;
DROP POLICY IF EXISTS credits_select ON public.credits;
DROP POLICY IF EXISTS credits_cud ON public.credits;
CREATE POLICY credits_select ON public.credits FOR SELECT USING (profile_id = auth.uid() OR credit_can_access(id) OR is_app_admin());
CREATE POLICY credits_insert ON public.credits FOR INSERT WITH CHECK (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY credits_update ON public.credits FOR UPDATE
  USING (profile_id = auth.uid() OR credit_role(id) = 'write' OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR credit_role(id) = 'write' OR is_app_admin());
CREATE POLICY credits_delete ON public.credits FOR DELETE USING (profile_id = auth.uid() OR is_app_admin());

-- credit_events : lecture/écriture pour les participants du crédit.
DROP POLICY IF EXISTS credit_events_all ON public.credit_events;
CREATE POLICY credit_events_all ON public.credit_events FOR ALL
  USING (profile_id = auth.uid() OR credit_can_access(credit_id) OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR credit_can_access(credit_id) OR is_app_admin());

-- RLS membres / invitations.
ALTER TABLE public.credit_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_mem_select ON public.credit_members;
DROP POLICY IF EXISTS credit_mem_cud ON public.credit_members;
CREATE POLICY credit_mem_select ON public.credit_members FOR SELECT USING (credit_can_access(credit_id) OR is_app_admin());
CREATE POLICY credit_mem_cud ON public.credit_members FOR ALL
  USING (is_app_admin() OR EXISTS(SELECT 1 FROM public.credits c WHERE c.id = credit_id AND c.profile_id = auth.uid()))
  WITH CHECK (is_app_admin() OR EXISTS(SELECT 1 FROM public.credits c WHERE c.id = credit_id AND c.profile_id = auth.uid()));
DROP POLICY IF EXISTS credit_inv_select ON public.credit_invitations;
DROP POLICY IF EXISTS credit_inv_cud ON public.credit_invitations;
CREATE POLICY credit_inv_select ON public.credit_invitations FOR SELECT USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR is_app_admin());
CREATE POLICY credit_inv_cud ON public.credit_invitations FOR ALL
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR is_app_admin())
  WITH CHECK (from_user_id = auth.uid() OR is_app_admin());

-- RPC (calqués sur acct_*).
CREATE OR REPLACE FUNCTION public.credit_invite_by_code(p_credit uuid, p_code text, p_role text DEFAULT 'write')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid; mem uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.credits WHERE id = p_credit AND profile_id = auth.uid()) THEN
    RAISE EXCEPTION 'Seul le propriétaire du crédit peut inviter';
  END IF;
  IF COALESCE(p_role,'write') NOT IN ('write','read') THEN RAISE EXCEPTION 'Rôle invalide'; END IF;
  SELECT id INTO target FROM public.profiles WHERE upper(public_code) = upper(trim(p_code));
  IF target IS NULL THEN RAISE EXCEPTION 'Code utilisateur introuvable'; END IF;
  IF target = auth.uid() THEN RAISE EXCEPTION 'Vous ne pouvez pas vous inviter vous-même'; END IF;
  IF EXISTS(SELECT 1 FROM public.credit_members WHERE credit_id = p_credit AND user_id = target) THEN
    RAISE EXCEPTION 'Cet utilisateur a déjà accès à ce crédit';
  END IF;
  INSERT INTO public.credit_members(credit_id, user_id, display_name, role)
    VALUES (p_credit, NULL, COALESCE((SELECT full_name FROM public.profiles WHERE id = target), 'Invité'), p_role)
    RETURNING id INTO mem;
  INSERT INTO public.credit_invitations(credit_id, from_user_id, to_user_id, to_member_id, role, status)
    VALUES (p_credit, auth.uid(), target, mem, p_role, 'pending');
  RETURN mem;
END; $$;

CREATE OR REPLACE FUNCTION public.credit_accept_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.credit_invitations; myname text;
BEGIN
  SELECT * INTO inv FROM public.credit_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  SELECT COALESCE(full_name,'Invité') INTO myname FROM public.profiles WHERE id = auth.uid();
  IF inv.to_member_id IS NOT NULL THEN
    UPDATE public.credit_members SET user_id = inv.to_user_id, display_name = myname WHERE id = inv.to_member_id;
  ELSE
    INSERT INTO public.credit_members(credit_id, user_id, display_name, role) VALUES (inv.credit_id, inv.to_user_id, myname, inv.role);
  END IF;
  UPDATE public.credit_invitations SET status = 'accepted' WHERE id = p_invite;
END; $$;

CREATE OR REPLACE FUNCTION public.credit_decline_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.credit_invitations;
BEGIN
  SELECT * INTO inv FROM public.credit_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  IF inv.to_member_id IS NOT NULL THEN DELETE FROM public.credit_members WHERE id = inv.to_member_id AND user_id IS NULL; END IF;
  UPDATE public.credit_invitations SET status = 'declined' WHERE id = p_invite;
END; $$;

CREATE OR REPLACE FUNCTION public.credit_set_member_role(p_member uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_role NOT IN ('write','read') THEN RAISE EXCEPTION 'Rôle invalide'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.credit_members m JOIN public.credits c ON c.id = m.credit_id WHERE m.id = p_member AND c.profile_id = auth.uid()) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  UPDATE public.credit_members SET role = p_role WHERE id = p_member;
  UPDATE public.credit_invitations SET role = p_role WHERE to_member_id = p_member AND status = 'pending';
END; $$;

CREATE OR REPLACE FUNCTION public.credit_remove_member(p_member uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.credit_members m JOIN public.credits c ON c.id = m.credit_id WHERE m.id = p_member AND c.profile_id = auth.uid()) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  UPDATE public.credit_invitations SET status = 'declined' WHERE to_member_id = p_member AND status = 'pending';
  DELETE FROM public.credit_members WHERE id = p_member;
END; $$;

CREATE OR REPLACE FUNCTION public.credit_my_invitations()
RETURNS TABLE (invite_id uuid, credit_id uuid, credit_label text, role text, from_name text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.credit_id, c.label, i.role, COALESCE(p.full_name,'Un utilisateur'), i.created_at
  FROM public.credit_invitations i
  JOIN public.credits c ON c.id = i.credit_id
  LEFT JOIN public.profiles p ON p.id = i.from_user_id
  WHERE i.to_user_id = auth.uid() AND i.status = 'pending'
  ORDER BY i.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.credit_invite_by_code(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_accept_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_decline_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_set_member_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_remove_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_my_invitations() TO authenticated;

-- Realtime.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_members; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_invitations; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
