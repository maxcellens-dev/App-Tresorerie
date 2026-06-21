-- 089 — Projet partagé (Relyka World) : un REFUS d'invitation ne doit plus SUPPRIMER le
-- participant placeholder. Sinon, s'il était déjà affecté à des dépenses (paid_by) ou à des
-- parts (rw_expense_shares), ces affectations seraient perdues / l'opération échouerait.
-- → On le convertit simplement en « participant non inscrit » (user_id NULL, pending = false).
-- On ajoute aussi la possibilité de RÉ-INVITER un participant non inscrit EXISTANT par son ID :
-- s'il accepte, il reprend EXACTEMENT sa place (mêmes parts/dépenses, car liées au participant_id).

-- 1) Refus : convertir le placeholder en participant non inscrit (garder les affectations).
CREATE OR REPLACE FUNCTION public.rw_decline_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.rw_invitations;
BEGIN
  SELECT * INTO inv FROM public.rw_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  -- Le placeholder reste dans le projet en tant que « non inscrit » : on lève juste « en attente ».
  IF inv.to_participant_id IS NOT NULL THEN
    UPDATE public.rw_participants SET pending = false
      WHERE id = inv.to_participant_id AND user_id IS NULL;
  END IF;
  UPDATE public.rw_invitations SET status = 'declined' WHERE id = p_invite;
END; $$;

-- 2) Ré-inviter un participant non inscrit EXISTANT par son ID public.
--    L'acceptation (rw_accept_invitation) met à jour CE participant (to_participant_id) → l'invité
--    reprend sa place partout (les parts/dépenses pointent sur le participant_id, inchangé).
CREATE OR REPLACE FUNCTION public.rw_reinvite_participant(p_project uuid, p_participant uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid;
BEGIN
  IF NOT public.rw_can_access(p_project) THEN RAISE EXCEPTION 'Accès refusé à ce projet'; END IF;
  -- Le participant doit exister, appartenir au projet et être NON inscrit.
  IF NOT EXISTS (SELECT 1 FROM public.rw_participants
                 WHERE id = p_participant AND project_id = p_project AND user_id IS NULL) THEN
    RAISE EXCEPTION 'Participant introuvable ou déjà inscrit';
  END IF;
  SELECT id INTO target FROM public.profiles WHERE upper(public_code) = upper(trim(p_code));
  IF target IS NULL THEN RAISE EXCEPTION 'Code utilisateur introuvable'; END IF;
  IF target = auth.uid() THEN RAISE EXCEPTION 'Vous ne pouvez pas vous inviter vous-même'; END IF;
  IF EXISTS (SELECT 1 FROM public.rw_participants WHERE project_id = p_project AND user_id = target)
     THEN RAISE EXCEPTION 'Cet utilisateur participe déjà'; END IF;
  -- Marque ce participant « en attente » et crée l'invitation pointant dessus.
  UPDATE public.rw_participants SET pending = true WHERE id = p_participant;
  INSERT INTO public.rw_invitations(project_id, from_user_id, to_user_id, to_participant_id, status)
    VALUES (p_project, auth.uid(), target, p_participant, 'pending');
END; $$;

GRANT EXECUTE ON FUNCTION public.rw_decline_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rw_reinvite_participant(uuid, uuid, text) TO authenticated;
