-- Distingue un participant « invité en attente » (issu d'une invitation pas encore acceptée)
-- d'une « personne non inscrite » ajoutée à la main (qui n'est PAS en attente).
ALTER TABLE public.rw_participants ADD COLUMN IF NOT EXISTS pending boolean NOT NULL DEFAULT false;

-- Invitation par code : le participant placeholder est marqué « en attente ».
CREATE OR REPLACE FUNCTION public.rw_invite_by_code(p_project uuid, p_code text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid; part uuid;
BEGIN
  IF NOT public.rw_can_access(p_project) THEN RAISE EXCEPTION 'Accès refusé à ce projet'; END IF;
  SELECT id INTO target FROM public.profiles WHERE upper(public_code) = upper(trim(p_code));
  IF target IS NULL THEN RAISE EXCEPTION 'Code utilisateur introuvable'; END IF;
  IF target = auth.uid() THEN RAISE EXCEPTION 'Vous ne pouvez pas vous inviter vous-même'; END IF;
  IF EXISTS(SELECT 1 FROM public.rw_participants WHERE project_id = p_project AND user_id = target)
     THEN RAISE EXCEPTION 'Cet utilisateur participe déjà'; END IF;
  INSERT INTO public.rw_participants(project_id, user_id, display_name, pending)
    VALUES (p_project, NULL, COALESCE(NULLIF(trim(p_name), ''),
            (SELECT full_name FROM public.profiles WHERE id = target), 'Invité'), true)
    RETURNING id INTO part;
  INSERT INTO public.rw_invitations(project_id, from_user_id, to_user_id, to_participant_id, status)
    VALUES (p_project, auth.uid(), target, part, 'pending');
  RETURN part;
END; $$;

-- Acceptation : le participant n'est plus en attente.
CREATE OR REPLACE FUNCTION public.rw_accept_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.rw_invitations; myname text;
BEGIN
  SELECT * INTO inv FROM public.rw_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  SELECT COALESCE(full_name, 'Invité') INTO myname FROM public.profiles WHERE id = auth.uid();
  IF inv.to_participant_id IS NOT NULL THEN
    UPDATE public.rw_participants SET user_id = inv.to_user_id, display_name = myname, pending = false
      WHERE id = inv.to_participant_id;
  ELSE
    INSERT INTO public.rw_participants(project_id, user_id, display_name, pending)
      VALUES (inv.project_id, inv.to_user_id, myname, false);
  END IF;
  UPDATE public.rw_invitations SET status = 'accepted' WHERE id = p_invite;
END; $$;

-- Les participants déjà liés à un compte ne sont jamais « en attente ».
UPDATE public.rw_participants SET pending = false WHERE user_id IS NOT NULL;
