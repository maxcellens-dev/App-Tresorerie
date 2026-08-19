-- ============================================================================
-- 189 — Le cycle de vie d'une invitation, remis d'aplomb (remplace la 188).
--
-- Trois défauts se combinaient pour produire ce que montre l'écran « Participants » :
-- deux fois la même personne, dont une restée « en attente » alors qu'elle a accepté.
--
--   1) ACCEPTER DEPUIS L'ADMINISTRATION NE LEVAIT PAS « EN ATTENTE ».
--      `rw_respond_invitation_for` (185) rattachait bien le compte au participant, mais sans
--      remettre `pending` à false — que seule la version utilisateur (`rw_accept_invitation`,
--      migration 076) faisait. D'où « Julie (moi) · en attente » : elle EST dans le projet, et
--      l'écran continue d'annoncer qu'on l'attend.
--      Au refus, la même fonction SUPPRIMAIT le participant, alors que la migration 089 avait
--      justement décidé le contraire : un refus doit le conserver en « non inscrit », sinon ses
--      dépenses et ses quotes-parts partent avec lui.
--
--   2) CHAQUE INVITATION CRÉAIT UN NOUVEAU PARTICIPANT.
--      Réinviter la même personne fabriquait un second placeholder et abandonnait le premier —
--      la 184 supprimait l'invitation périmée, mais pas la ligne qu'elle avait créée. D'où le
--      doublon, définitif et invisible à corriger : ni modifiable (il est « en attente »), ni
--      annulable (son invitation n'existe plus).
--
--   3) ANNULER UNE INVITATION LAISSAIT LE PARTICIPANT « EN ATTENTE » POUR TOUJOURS.
--      `rw_cancel_invitation` effaçait l'invitation seule. La ligne restait, en attente d'une
--      réponse qui ne pouvait plus venir, et le bouton « annuler » n'avait alors plus rien à faire.
--
-- La règle tenue ici, partout : UNE personne invitée = UNE ligne de participant, réutilisée
-- d'une invitation à l'autre. Et une ligne ne disparaît jamais tant qu'elle porte de l'argent
-- (dépense avancée ou quote-part) — dans ce cas elle redevient « non inscrit », donc reprenable.
-- ============================================================================

-- ── Ce qu'une ligne de participant porte comme données ──────────────────────────────────────
-- Sert de garde partout ci-dessous : > 0 ⇒ la supprimer perdrait des montants.
CREATE OR REPLACE FUNCTION public.rw_participant_refs(p_participant uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM public.rw_expenses       WHERE paid_by         = p_participant)
       + (SELECT count(*) FROM public.rw_expense_shares WHERE participant_id  = p_participant)
       + (SELECT count(*) FROM public.rw_expense_payers WHERE participant_id  = p_participant);
$$;
GRANT EXECUTE ON FUNCTION public.rw_participant_refs(uuid) TO authenticated;

-- ── 1) Inviter par code : réutiliser la ligne existante ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rw_invite_by_code(p_project uuid, p_code text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid; part uuid; v_existing uuid;
BEGIN
  IF NOT public.rw_can_access(p_project) THEN RAISE EXCEPTION 'Accès refusé à ce projet'; END IF;
  SELECT id INTO target FROM public.profiles WHERE upper(public_code) = upper(trim(p_code));
  IF target IS NULL THEN RAISE EXCEPTION 'Code utilisateur introuvable'; END IF;
  IF target = auth.uid() AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Tu ne peux pas t''inviter toi-même';
  END IF;
  -- On ne bloque que sur une participation RÉELLE (compte déjà rattaché) : quelqu'un qui a été
  -- retiré, ou dont l'invitation a été refusée, doit pouvoir être réinvité.
  IF EXISTS(SELECT 1 FROM public.rw_participants WHERE project_id = p_project AND user_id = target) THEN
    RAISE EXCEPTION 'Cette personne participe déjà à ce projet';
  END IF;

  /* Invitation en attente déjà envoyée à cette personne sur ce projet : on renvoie SA ligne au
     lieu d'en créer une deuxième. C'est ce qui empêche le doublon — et ça préserve les dépenses
     qu'on lui aurait déjà attribuées en attendant sa réponse. */
  SELECT i.to_participant_id INTO v_existing
  FROM public.rw_invitations i
  JOIN public.rw_participants p ON p.id = i.to_participant_id AND p.user_id IS NULL
  WHERE i.project_id = p_project AND i.to_user_id = target AND i.status = 'pending'
  ORDER BY i.created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.rw_participants
       SET pending = true,
           display_name = COALESCE(NULLIF(trim(p_name), ''), display_name)
     WHERE id = v_existing;
    -- Une seule invitation vivante par personne et par projet.
    DELETE FROM public.rw_invitations
     WHERE project_id = p_project AND to_user_id = target AND status = 'pending'
       AND to_participant_id IS DISTINCT FROM v_existing;
    RETURN v_existing;
  END IF;

  /* Invitations en attente devenues sans objet (leur participant a été supprimé, ou a déjà
     rejoint) : on les efface, et avec elles la ligne vide qu'elles avaient laissée. */
  DELETE FROM public.rw_participants p
   WHERE p.user_id IS NULL
     AND public.rw_participant_refs(p.id) = 0
     AND EXISTS (SELECT 1 FROM public.rw_invitations i
                  WHERE i.to_participant_id = p.id AND i.status = 'pending'
                    AND i.project_id = p_project AND i.to_user_id = target);
  DELETE FROM public.rw_invitations
   WHERE project_id = p_project AND to_user_id = target AND status = 'pending';

  -- `pending = true` distingue « invité, en attente de réponse » d'une personne non inscrite
  -- ajoutée à la main (migration 076) : sans lui, l'écran confond les deux et la rend modifiable.
  INSERT INTO public.rw_participants(project_id, user_id, display_name, pending)
    VALUES (p_project, NULL, COALESCE(NULLIF(trim(p_name), ''),
            (SELECT full_name FROM public.profiles WHERE id = target), 'Invité'), true)
    RETURNING id INTO part;
  INSERT INTO public.rw_invitations(project_id, from_user_id, to_user_id, to_participant_id, status)
    VALUES (p_project, auth.uid(), target, part, 'pending');
  RETURN part;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_invite_by_code(uuid, text, text) TO authenticated;

-- ── 2) Annuler une invitation : la ligne ne reste pas en attente ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rw_cancel_invitation(p_participant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_part public.rw_participants; v_owner uuid;
BEGIN
  SELECT * INTO v_part FROM public.rw_participants WHERE id = p_participant;
  IF v_part.id IS NULL THEN RETURN; END IF;
  SELECT owner_id INTO v_owner FROM public.rw_projects WHERE id = v_part.project_id;
  IF v_owner <> auth.uid() AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Seul le créateur du projet peut annuler une invitation';
  END IF;
  IF v_part.user_id IS NOT NULL THEN RAISE EXCEPTION 'Cette personne a déjà rejoint le projet'; END IF;

  DELETE FROM public.rw_invitations WHERE to_participant_id = p_participant AND status = 'pending';

  /* La ligne ne peut pas rester « en attente » d'une réponse devenue impossible. Vide, elle
     disparaît (c'est ce qu'on attend d'une annulation) ; porteuse de dépenses ou de parts, elle
     redevient un participant non inscrit — modifiable, réinvitable, reprenable. */
  IF public.rw_participant_refs(p_participant) = 0 THEN
    DELETE FROM public.rw_participants WHERE id = p_participant;
  ELSE
    UPDATE public.rw_participants SET pending = false WHERE id = p_participant;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_cancel_invitation(uuid) TO authenticated;

-- ── 3) Répondre à une invitation à la place d'un utilisateur (administration) ────────────────
CREATE OR REPLACE FUNCTION public.rw_respond_invitation_for(p_invite uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.rw_invitations; myname text;
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Réservé aux administrateurs'; END IF;
  SELECT * INTO inv FROM public.rw_invitations WHERE id = p_invite;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invitation introuvable'; END IF;
  IF inv.status <> 'pending' THEN RAISE EXCEPTION 'Cette invitation a déjà reçu une réponse'; END IF;

  IF p_accept THEN
    SELECT COALESCE(full_name, 'Invité') INTO myname FROM public.profiles WHERE id = inv.to_user_id;
    IF inv.to_participant_id IS NOT NULL THEN
      -- `pending = false` : accepter, c'est cesser d'attendre. Son absence est ce qui affichait
      -- « (moi) · en attente » sur quelqu'un pourtant entré dans le projet.
      UPDATE public.rw_participants
         SET user_id = inv.to_user_id, display_name = myname, pending = false
       WHERE id = inv.to_participant_id;
    ELSE
      INSERT INTO public.rw_participants(project_id, user_id, display_name, pending)
        VALUES (inv.project_id, inv.to_user_id, myname, false);
    END IF;
    UPDATE public.rw_invitations SET status = 'accepted' WHERE id = p_invite;
  ELSE
    -- Refus : on conserve la ligne en « non inscrit » (migration 089), on ne la supprime pas —
    -- elle porte peut-être déjà des dépenses. Vide, elle n'a en revanche plus de raison d'être.
    IF inv.to_participant_id IS NOT NULL THEN
      IF public.rw_participant_refs(inv.to_participant_id) = 0 THEN
        DELETE FROM public.rw_participants WHERE id = inv.to_participant_id AND user_id IS NULL;
      ELSE
        UPDATE public.rw_participants SET pending = false
         WHERE id = inv.to_participant_id AND user_id IS NULL;
      END IF;
    END IF;
    UPDATE public.rw_invitations SET status = 'declined' WHERE id = p_invite;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_respond_invitation_for(uuid, boolean) TO authenticated;

-- ── 4) Invitations d'un utilisateur, vues par l'administration ──────────────────────────────
-- En SQL et non en PL/pgSQL : dans une fonction PL/pgSQL, les colonnes de `RETURNS TABLE(...)`
-- deviennent des variables, et une référence ambiguë à `id` ou `created_at` n'échoue qu'à
-- l'exécution. Le contrôle de droit passe en clause WHERE (une fonction SQL ne peut pas lever) ;
-- le client, lui, affiche désormais l'erreur au lieu d'une liste vide.
DROP FUNCTION IF EXISTS public.rw_invitations_for(uuid);
CREATE FUNCTION public.rw_invitations_for(p_user uuid)
RETURNS TABLE (id uuid, project_id uuid, project_name text, project_emoji text, from_name text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT i.id, i.project_id, pr.name, pr.emoji,
         COALESCE(f.full_name, 'Un utilisateur'), i.created_at
  FROM public.rw_invitations i
  JOIN public.rw_projects pr ON pr.id = i.project_id
  LEFT JOIN public.profiles f ON f.id = i.from_user_id
  WHERE public.is_app_admin()
    AND i.to_user_id = p_user
    AND i.status = 'pending'
  ORDER BY i.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.rw_invitations_for(uuid) TO authenticated;

-- ============================================================================
-- REPRISE DES DONNÉES EXISTANTES
-- Les états incohérents laissés par les trois défauts ci-dessus. Aucune ligne porteuse de
-- montants n'est supprimée : au pire elle redevient « non inscrit ».
-- ============================================================================

-- a) Une invitation dont le participant a déjà rejoint le projet a, de fait, été acceptée.
UPDATE public.rw_invitations i SET status = 'accepted'
WHERE i.status = 'pending'
  AND EXISTS (SELECT 1 FROM public.rw_participants p
               WHERE p.id = i.to_participant_id AND p.user_id IS NOT NULL);

-- b) Quelqu'un dont le compte est rattaché n'est jamais « en attente ».
UPDATE public.rw_participants SET pending = false WHERE user_id IS NOT NULL AND pending;

-- c) « En attente » sans invitation vivante : ligne fantôme. Vide → supprimée ; porteuse de
--    montants → rendue au statut « non inscrit », donc de nouveau modifiable et reprenable.
DELETE FROM public.rw_participants p
WHERE p.user_id IS NULL AND p.pending
  AND public.rw_participant_refs(p.id) = 0
  AND NOT EXISTS (SELECT 1 FROM public.rw_invitations i
                   WHERE i.to_participant_id = p.id AND i.status = 'pending');

UPDATE public.rw_participants p SET pending = false
WHERE p.user_id IS NULL AND p.pending
  AND NOT EXISTS (SELECT 1 FROM public.rw_invitations i
                   WHERE i.to_participant_id = p.id AND i.status = 'pending');

-- d) L'inverse : une invitation en attente, mais un participant que la 184 avait laissé à false.
UPDATE public.rw_participants p SET pending = true
WHERE p.user_id IS NULL AND NOT p.pending
  AND EXISTS (SELECT 1 FROM public.rw_invitations i
               WHERE i.to_participant_id = p.id AND i.status = 'pending');

-- e) Deux invitations en attente pour la même personne sur le même projet : on ne garde que la
--    plus récente (les autres ne mènent plus nulle part).
DELETE FROM public.rw_invitations i
WHERE i.status = 'pending'
  AND EXISTS (SELECT 1 FROM public.rw_invitations j
               WHERE j.status = 'pending' AND j.project_id = i.project_id
                 AND j.to_user_id = i.to_user_id
                 AND (j.created_at, j.id) > (i.created_at, i.id));

NOTIFY pgrst, 'reload schema';
