-- ============================================================================
-- 191 — FUSIONNER DEUX LIGNES QUI SONT LA MÊME PERSONNE, et un garde-fou qui bloquait trop.
--
-- ── LE CAS RÉEL ─────────────────────────────────────────────────────────────────────────────
-- Les défauts d'invitation (cf. 189) ont laissé DEUX lignes pour Julie sur le même projet : le
-- placeholder créé par les invitations successives, qui porte 12 dépenses, et la vraie Julie,
-- rattachée à son compte depuis qu'elle a accepté. Le projet compte donc deux participants pour une
-- seule personne : les équilibres sont faux, et la part de Julie est répartie entre deux inconnus.
--
-- Retirer le placeholder en réattribuant ses lignes était refusé par le garde-fou de la 185. Ce
-- refus était doublement à côté : d'une part il ne s'agit pas de transférer l'argent de quelqu'un à
-- quelqu'un d'autre, mais de reconnaître que les deux lignes n'ont jamais désigné qu'une personne ;
-- d'autre part le garde-fou bloquait même sur des transactions créées par CELUI QUI DEMANDE.
--
-- ── 1) LE GARDE-FOU NE PROTÈGE QUE L'ARGENT DES AUTRES ──────────────────────────────────────
-- Il comptait toute dépense ayant touché un vrai compte, sans regarder À QUI appartient la
-- transaction. Or une transaction que j'ai saisie moi-même est sur MON compte : j'ai tout droit d'en
-- disposer. La règle voulue par la 185 — « on ne déplace pas l'argent réel de quelqu'un d'autre » —
-- se lit donc sur `created_by`, et pas sur la simple existence d'une transaction.
--
-- ── 2) LA FUSION ────────────────────────────────────────────────────────────────────────────
-- `rw_merge_participants` déclare que deux lignes désignent la même personne. Elle NE TOUCHE À
-- AUCUNE TRANSACTION : chaque dépense garde la sienne, sur le compte de son propriétaire, au même
-- montant et à la même date. Rien n'est débité, rien n'est recrédité, aucun solde ne bouge. Seule
-- l'attribution dans le projet est consolidée sur une seule ligne — ce qui est précisément
-- l'inverse d'un transfert d'argent, et pourquoi le garde-fou ci-dessus n'a pas à s'y appliquer.
--
-- Ce qu'on ne peut PAS faire, et qui reste refusé : absorber une ligne rattachée à un compte
-- Relyka. Fusionner deux personnes réellement distinctes reviendrait à donner les dépenses de l'une
-- à l'autre. Seule une ligne NON INSCRITE peut être absorbée.
-- ============================================================================

-- ── 1) Retirer un participant : ne bloquer que sur l'argent d'AUTRUI ─────────────────────────
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

  /* GARDE-FOU : de l'argent réel appartenant à QUELQU'UN D'AUTRE. Une transaction que j'ai saisie
     moi-même est sur mon compte et me regarde — la bloquer m'empêchait de réparer mes propres
     saisies. C'est `created_by` qui tranche, pas l'existence d'une transaction. */
  SELECT count(DISTINCT e.id) INTO v_real
  FROM public.rw_expenses e
  LEFT JOIN public.rw_expense_payers   p ON p.expense_id = e.id
  LEFT JOIN public.rw_expense_accounts a ON a.expense_id = e.id
  WHERE (p.participant_id = p_participant OR (p.id IS NULL AND e.paid_by = p_participant))
    AND (
      (a.transaction_id IS NOT NULL AND a.created_by IS DISTINCT FROM auth.uid())
      OR (a.id IS NULL AND e.transaction_id IS NOT NULL AND e.created_by IS DISTINCT FROM auth.uid())
    );

  IF v_real > 0 THEN
    RAISE EXCEPTION
      '% dépense(s) de cette personne ont été réglées depuis le compte bancaire de quelqu''un d''autre. Elles doivent d''abord être supprimées ou repassées en « cash » par leur propriétaire — on ne peut pas réattribuer l''argent d''un autre.', v_real;
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

    PERFORM public.rw_absorb_participant_lines(p_participant, p_reassign);
  END IF;

  DELETE FROM public.rw_invitations WHERE to_participant_id = p_participant AND status = 'pending';
  DELETE FROM public.rw_participants WHERE id = p_participant;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_remove_participant(uuid, uuid) TO authenticated;

-- ── 2) Déplacement des lignes d'un participant vers un autre (mécanique commune) ─────────────
-- Extraite pour que le retrait avec repreneur et la fusion partagent EXACTEMENT le même code : deux
-- copies auraient divergé, et c'est de l'argent. Les quotes-parts d'une même dépense se cumulent au
-- lieu d'entrer en collision (deux lignes pour une personne sur une dépense n'a pas de sens).
CREATE OR REPLACE FUNCTION public.rw_absorb_participant_lines(p_from uuid, p_into uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rw_expenses SET paid_by = p_into WHERE paid_by = p_from;

  UPDATE public.rw_expense_shares t SET amount = t.amount + s.amount
  FROM public.rw_expense_shares s
  WHERE s.participant_id = p_from AND t.participant_id = p_into AND t.expense_id = s.expense_id;
  DELETE FROM public.rw_expense_shares s
  WHERE s.participant_id = p_from
    AND EXISTS (SELECT 1 FROM public.rw_expense_shares t WHERE t.participant_id = p_into AND t.expense_id = s.expense_id);
  UPDATE public.rw_expense_shares SET participant_id = p_into WHERE participant_id = p_from;

  UPDATE public.rw_expense_payers t SET amount = t.amount + s.amount
  FROM public.rw_expense_payers s
  WHERE s.participant_id = p_from AND t.participant_id = p_into AND t.expense_id = s.expense_id;
  DELETE FROM public.rw_expense_payers s
  WHERE s.participant_id = p_from
    AND EXISTS (SELECT 1 FROM public.rw_expense_payers t WHERE t.participant_id = p_into AND t.expense_id = s.expense_id);
  UPDATE public.rw_expense_payers SET participant_id = p_into WHERE participant_id = p_from;
END; $$;

-- ── 3) La fusion proprement dite ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rw_merge_participants(p_from uuid, p_into uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from  public.rw_participants;
  v_into  public.rw_participants;
  v_owner uuid;
BEGIN
  SELECT * INTO v_from FROM public.rw_participants WHERE id = p_from;
  SELECT * INTO v_into FROM public.rw_participants WHERE id = p_into;
  IF v_from.id IS NULL OR v_into.id IS NULL THEN RAISE EXCEPTION 'Participant introuvable'; END IF;
  IF v_from.id = v_into.id THEN RAISE EXCEPTION 'Ce sont déjà les mêmes'; END IF;
  IF v_from.project_id <> v_into.project_id THEN
    RAISE EXCEPTION 'Les deux participants doivent appartenir au même projet';
  END IF;

  SELECT owner_id INTO v_owner FROM public.rw_projects WHERE id = v_from.project_id;
  IF v_owner <> auth.uid() AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Seul le créateur du projet peut fusionner deux participants';
  END IF;

  /* Seule une ligne NON INSCRITE peut être absorbée. Fusionner deux comptes Relyka reviendrait à
     donner les dépenses de l'un à l'autre — c'est exactement ce que le garde-fou du retrait
     interdit, et cette fonction ne doit pas offrir une porte dérobée pour le faire. */
  IF v_from.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cette personne a son propre compte Relyka : ses dépenses ne peuvent pas être données à quelqu''un d''autre. Retire-la plutôt du projet.';
  END IF;

  /* AUCUNE TRANSACTION N'EST TOUCHÉE : les dépenses gardent la leur, sur le compte de son
     propriétaire. On ne consolide que l'attribution dans le projet. */
  PERFORM public.rw_absorb_participant_lines(p_from, p_into);

  DELETE FROM public.rw_invitations WHERE to_participant_id = p_from;
  DELETE FROM public.rw_participants WHERE id = p_from;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_merge_participants(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
