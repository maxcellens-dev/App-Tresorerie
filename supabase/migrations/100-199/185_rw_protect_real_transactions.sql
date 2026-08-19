-- ============================================================================
-- 185 — Relyka World : on ne déplace pas l'argent RÉEL de quelqu'un d'autre.
--
-- LE RISQUE
-- ─────────
-- Retirer un participant transfère ses dépenses avancées et ses quotes-parts à un repreneur
-- (migration 178/184). C'est sans danger tant que ces dépenses ne sont que des lignes de projet.
-- Mais dès qu'une dépense a été réglée depuis un VRAI compte, il existe une transaction bancaire
-- en face, dans le Relyka de son auteur : elle porte son solde, son budget du mois, ses
-- recommandations. Réattribuer la dépense à quelqu'un d'autre ferait diverger les deux — le projet
-- dirait « c'est Paul qui a payé », le compte de Marie continuerait d'être débité.
--
-- La règle est donc simple, et elle protège l'argent réel : un participant dont des dépenses ont
-- impacté un compte bancaire n'est pas retirable tant que ces dépenses existent. Il faut d'abord
-- les traiter (les supprimer, ou les repasser en « cash » depuis l'onglet Par compte) — et c'est
-- son propriétaire qui doit le faire, personne d'autre n'a le droit de toucher à ses transactions.
--
-- On refuse donc explicitement, avec le nombre de dépenses concernées, plutôt que de laisser
-- l'opération réussir à moitié.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rw_remove_participant(p_participant uuid, p_reassign uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_part    public.rw_participants;
  v_owner   uuid;
  v_target  public.rw_participants;
  v_refs    integer;
  v_real    integer;
BEGIN
  SELECT * INTO v_part FROM public.rw_participants WHERE id = p_participant;
  IF v_part.id IS NULL THEN RAISE EXCEPTION 'Participant introuvable'; END IF;

  SELECT owner_id INTO v_owner FROM public.rw_projects WHERE id = v_part.project_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Projet introuvable'; END IF;
  IF v_owner <> auth.uid() AND v_part.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Seul le créateur du projet peut retirer un participant';
  END IF;
  IF v_part.user_id = v_owner THEN
    RAISE EXCEPTION 'Le créateur du projet ne peut pas être retiré. Supprime ou archive le projet.';
  END IF;

  /* ── GARDE-FOU : de l'argent RÉEL est en jeu ────────────────────────────────────────────────
     Une dépense dont ce participant est payeur ET qui a touché un vrai compte (colonne historique
     `transaction_id`, ou une ligne de répartition multi-comptes). Ces transactions appartiennent à
     leur auteur : ni le créateur du projet ni l'administrateur ne peuvent en disposer. */
  SELECT count(DISTINCT e.id) INTO v_real
  FROM public.rw_expenses e
  LEFT JOIN public.rw_expense_payers  p ON p.expense_id = e.id
  LEFT JOIN public.rw_expense_accounts a ON a.expense_id = e.id
  WHERE (p.participant_id = p_participant OR (p.id IS NULL AND e.paid_by = p_participant))
    AND (e.transaction_id IS NOT NULL OR a.transaction_id IS NOT NULL);

  IF v_real > 0 THEN
    RAISE EXCEPTION
      '% dépense(s) de cette personne ont été réglées depuis un vrai compte bancaire. Elles doivent d''abord être supprimées ou repassées en « cash » par leur propriétaire — on ne peut pas réattribuer l''argent de quelqu''un d''autre.', v_real;
  END IF;

  SELECT (SELECT count(*) FROM public.rw_expenses       WHERE paid_by = p_participant)
       + (SELECT count(*) FROM public.rw_expense_shares WHERE participant_id = p_participant)
       + (SELECT count(*) FROM public.rw_expense_payers WHERE participant_id = p_participant)
    INTO v_refs;

  IF v_refs > 0 THEN
    IF p_reassign IS NULL THEN
      RAISE EXCEPTION 'Ce participant apparaît dans % ligne(s) du projet : choisis qui les reprend.', v_refs;
    END IF;
    SELECT * INTO v_target FROM public.rw_participants WHERE id = p_reassign;
    IF v_target.id IS NULL OR v_target.project_id <> v_part.project_id THEN
      RAISE EXCEPTION 'Le repreneur doit être un participant du même projet';
    END IF;
    IF v_target.id = v_part.id THEN RAISE EXCEPTION 'Le repreneur doit être quelqu''un d''autre'; END IF;

    UPDATE public.rw_expenses SET paid_by = p_reassign WHERE paid_by = p_participant;

    UPDATE public.rw_expense_shares t SET amount = t.amount + s.amount
    FROM public.rw_expense_shares s
    WHERE s.participant_id = p_participant AND t.participant_id = p_reassign AND t.expense_id = s.expense_id;
    DELETE FROM public.rw_expense_shares s
    WHERE s.participant_id = p_participant
      AND EXISTS (SELECT 1 FROM public.rw_expense_shares t WHERE t.participant_id = p_reassign AND t.expense_id = s.expense_id);
    UPDATE public.rw_expense_shares SET participant_id = p_reassign WHERE participant_id = p_participant;

    UPDATE public.rw_expense_payers t SET amount = t.amount + s.amount
    FROM public.rw_expense_payers s
    WHERE s.participant_id = p_participant AND t.participant_id = p_reassign AND t.expense_id = s.expense_id;
    DELETE FROM public.rw_expense_payers s
    WHERE s.participant_id = p_participant
      AND EXISTS (SELECT 1 FROM public.rw_expense_payers t WHERE t.participant_id = p_reassign AND t.expense_id = s.expense_id);
    UPDATE public.rw_expense_payers SET participant_id = p_reassign WHERE participant_id = p_participant;
  END IF;

  DELETE FROM public.rw_invitations WHERE to_participant_id = p_participant AND status = 'pending';
  DELETE FROM public.rw_participants WHERE id = p_participant;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_remove_participant(uuid, uuid) TO authenticated;

-- ── Invitations d'un utilisateur, vues par l'ADMINISTRATEUR ─────────────────────────────────
-- `rw_my_invitations` s'appuie sur auth.uid() : en « connecté en tant que », le jeton reste celui de
-- l'admin, donc il voyait SES invitations et pas celles du compte visité. Ces deux fonctions lui
-- donnent la vue et la main sur le compte qu'il dépanne, sans jamais élargir les droits d'un
-- utilisateur normal (le contrôle `is_app_admin()` est fait en premier).
CREATE OR REPLACE FUNCTION public.rw_invitations_for(p_user uuid)
RETURNS TABLE (id uuid, project_id uuid, project_name text, project_emoji text, from_name text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Réservé aux administrateurs'; END IF;
  RETURN QUERY
    SELECT i.id, i.project_id, p.name, p.emoji,
           COALESCE(f.full_name, 'Un utilisateur'), i.created_at
    FROM public.rw_invitations i
    JOIN public.rw_projects p ON p.id = i.project_id
    LEFT JOIN public.profiles f ON f.id = i.from_user_id
    WHERE i.to_user_id = p_user AND i.status = 'pending'
    ORDER BY i.created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_invitations_for(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rw_respond_invitation_for(p_invite uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.rw_invitations; myname text;
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Réservé aux administrateurs'; END IF;
  SELECT * INTO inv FROM public.rw_invitations WHERE id = p_invite;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invitation introuvable'; END IF;

  IF p_accept THEN
    SELECT COALESCE(full_name, 'Invité') INTO myname FROM public.profiles WHERE id = inv.to_user_id;
    IF inv.to_participant_id IS NOT NULL THEN
      UPDATE public.rw_participants SET user_id = inv.to_user_id, display_name = myname
        WHERE id = inv.to_participant_id;
    ELSE
      INSERT INTO public.rw_participants(project_id, user_id, display_name)
        VALUES (inv.project_id, inv.to_user_id, myname);
    END IF;
    UPDATE public.rw_invitations SET status = 'accepted' WHERE id = p_invite;
  ELSE
    IF inv.to_participant_id IS NOT NULL THEN
      DELETE FROM public.rw_participants WHERE id = inv.to_participant_id AND user_id IS NULL;
    END IF;
    UPDATE public.rw_invitations SET status = 'declined' WHERE id = p_invite;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_respond_invitation_for(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
