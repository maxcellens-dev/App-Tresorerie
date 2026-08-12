-- ============================================================================
-- 097 — Comptes partagés (Lot 2 : RPC d'invitation / gestion des membres).
-- Calqué sur le flux Relyka World (rw_*), adapté aux comptes + rôles + flag admin.
-- ============================================================================

-- Inviter un utilisateur par son CODE PUBLIC, avec un rôle (write/read).
-- Crée un membre « en attente » (user_id NULL) + l'invitation. Owner du compte uniquement.
-- Gate : pour un compte PERSO (non joint), refuse si le flag perso_account_sharing_enabled est OFF.
-- Les comptes JOINTS dédiés sont toujours autorisés.
CREATE OR REPLACE FUNCTION public.acct_invite_by_code(p_account uuid, p_code text, p_name text, p_role text DEFAULT 'write')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid; mem uuid; is_joint_acc boolean; sharing_on boolean;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id = p_account AND profile_id = auth.uid()) THEN
    RAISE EXCEPTION 'Seul le propriétaire du compte peut inviter';
  END IF;
  IF COALESCE(p_role, 'write') NOT IN ('write','read') THEN RAISE EXCEPTION 'Rôle invalide'; END IF;

  SELECT is_joint INTO is_joint_acc FROM public.accounts WHERE id = p_account;
  IF NOT COALESCE(is_joint_acc, false) THEN
    SELECT COALESCE((features->>'perso_account_sharing_enabled')::boolean, false) INTO sharing_on
      FROM public.app_config WHERE id = 'default';
    IF NOT COALESCE(sharing_on, false) THEN
      RAISE EXCEPTION 'Le partage de comptes perso est désactivé';
    END IF;
  END IF;

  SELECT id INTO target FROM public.profiles WHERE upper(public_code) = upper(trim(p_code));
  IF target IS NULL THEN RAISE EXCEPTION 'Code utilisateur introuvable'; END IF;
  IF target = auth.uid() THEN RAISE EXCEPTION 'Vous ne pouvez pas vous inviter vous-même'; END IF;
  IF EXISTS(SELECT 1 FROM public.account_members WHERE account_id = p_account AND user_id = target) THEN
    RAISE EXCEPTION 'Cet utilisateur a déjà accès à ce compte';
  END IF;

  INSERT INTO public.account_members(account_id, user_id, display_name, role)
    VALUES (p_account, NULL, COALESCE(NULLIF(trim(p_name), ''),
            (SELECT full_name FROM public.profiles WHERE id = target), 'Invité'), p_role)
    RETURNING id INTO mem;
  INSERT INTO public.account_invitations(account_id, from_user_id, to_user_id, to_member_id, role, status)
    VALUES (p_account, auth.uid(), target, mem, p_role, 'pending');
  RETURN mem;
END; $$;

-- Ajouter un membre « simple nom » (utilisateur externe non inscrit). Pas d'invitation, juste un
-- participant nominatif (ne pourra agir que s'il rejoint l'app et est relié plus tard). Owner only.
CREATE OR REPLACE FUNCTION public.acct_add_named_member(p_account uuid, p_name text, p_role text DEFAULT 'write')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mem uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id = p_account AND profile_id = auth.uid()) THEN
    RAISE EXCEPTION 'Seul le propriétaire du compte peut ajouter un membre';
  END IF;
  IF COALESCE(p_role, 'write') NOT IN ('write','read') THEN RAISE EXCEPTION 'Rôle invalide'; END IF;
  INSERT INTO public.account_members(account_id, user_id, display_name, role)
    VALUES (p_account, NULL, COALESCE(NULLIF(trim(p_name), ''), 'Invité'), p_role)
    RETURNING id INTO mem;
  RETURN mem;
END; $$;

-- Accepter une invitation : relie le membre « en attente » à l'utilisateur (avec son vrai nom).
CREATE OR REPLACE FUNCTION public.acct_accept_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.account_invitations; myname text;
BEGIN
  SELECT * INTO inv FROM public.account_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  SELECT COALESCE(full_name, 'Invité') INTO myname FROM public.profiles WHERE id = auth.uid();
  IF inv.to_member_id IS NOT NULL THEN
    UPDATE public.account_members SET user_id = inv.to_user_id, display_name = myname
      WHERE id = inv.to_member_id;
  ELSE
    INSERT INTO public.account_members(account_id, user_id, display_name, role)
      VALUES (inv.account_id, inv.to_user_id, myname, inv.role);
  END IF;
  UPDATE public.account_invitations SET status = 'accepted' WHERE id = p_invite;
END; $$;

-- Refuser une invitation : retire le membre « en attente » et marque refusé.
CREATE OR REPLACE FUNCTION public.acct_decline_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.account_invitations;
BEGIN
  SELECT * INTO inv FROM public.account_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  IF inv.to_member_id IS NOT NULL THEN
    DELETE FROM public.account_members WHERE id = inv.to_member_id AND user_id IS NULL;
  END IF;
  UPDATE public.account_invitations SET status = 'declined' WHERE id = p_invite;
END; $$;

-- Changer le rôle d'un membre (owner only). read <-> write sans ré-inviter.
CREATE OR REPLACE FUNCTION public.acct_set_member_role(p_member uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_role NOT IN ('write','read') THEN RAISE EXCEPTION 'Rôle invalide'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.account_members m JOIN public.accounts a ON a.id = m.account_id
    WHERE m.id = p_member AND a.profile_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
  UPDATE public.account_members SET role = p_role WHERE id = p_member;
  UPDATE public.account_invitations SET role = p_role
    WHERE to_member_id = p_member AND status = 'pending';
END; $$;

-- Retirer un membre / révoquer un accès (owner only).
CREATE OR REPLACE FUNCTION public.acct_remove_member(p_member uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.account_members m JOIN public.accounts a ON a.id = m.account_id
    WHERE m.id = p_member AND a.profile_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
  UPDATE public.account_invitations SET status = 'declined'
    WHERE to_member_id = p_member AND status = 'pending';
  DELETE FROM public.account_members WHERE id = p_member;
END; $$;

-- Mes invitations de compte en attente (pour l'écran d'acceptation, unifié avec les projets).
CREATE OR REPLACE FUNCTION public.acct_my_invitations()
RETURNS TABLE (
  invite_id uuid, account_id uuid, account_name text, account_type text, is_joint boolean,
  role text, from_name text, created_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.account_id, a.name, a.type, a.is_joint, i.role,
         COALESCE(p.full_name, 'Un utilisateur'), i.created_at
  FROM public.account_invitations i
  JOIN public.accounts a ON a.id = i.account_id
  LEFT JOIN public.profiles p ON p.id = i.from_user_id
  WHERE i.to_user_id = auth.uid() AND i.status = 'pending'
  ORDER BY i.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.acct_invite_by_code(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acct_add_named_member(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acct_accept_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acct_decline_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acct_set_member_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acct_remove_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acct_my_invitations() TO authenticated;
