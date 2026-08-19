-- ============================================================================
-- 184 — Relyka World : PLUSIEURS PAYEURS sur une dépense + accès administrateur.
--
-- ── 1) QUI A PAYÉ QUOI ──────────────────────────────────────────────────────────────────────
-- `rw_expenses.paid_by` ne désigne qu'UNE personne. Au restaurant à quatre, il arrive que deux
-- personnes règlent (60 € par carte, 40 € en espèces) : il fallait alors inventer une dépense par
-- payeur, ce qui décorrèle les parts de la dépense réelle et fausse les équilibres.
--
-- Une dépense a donc désormais DEUX répartitions, symétriques et indépendantes :
--     rw_expense_payers  — qui a AVANCÉ l'argent, et combien   (nouveau)
--     rw_expense_shares  — qui DOIT quoi au final              (existant)
-- L'équilibre de chacun reste ce qu'il a toujours été : ce qu'il a avancé moins ce qu'il doit.
--
-- `paid_by` est CONSERVÉ (colonne NOT NULL, référencée partout) et pointe sur le payeur principal —
-- celui qui a mis le plus. Tout le code qui ne connaît pas encore les payeurs multiples continue
-- donc de fonctionner, et l'affichage « Payé par X » reste juste au singulier.
--
-- ── 2) L'ADMINISTRATEUR N'A PAS ACCÈS AUX PROJETS PARTAGÉS ──────────────────────────────────
-- `rw_can_access` ne connaît que le propriétaire et les participants. Un administrateur — y compris
-- en « connecté en tant que », où le jeton reste le sien — se voyait donc refuser toute action :
-- « Accès refusé à ce projet » à la moindre invitation, alors qu'il doit pouvoir dépanner.
-- On ajoute la branche `is_app_admin()`, comme sur les autres tables (migration 102).
--
-- ⚠️ Ce faisant, la RLS cesse d'être un filtre de liste pour un admin : `select('*')` lui rendrait
-- les projets de TOUT LE MONDE. Le client cible déjà son périmètre explicitement (useRwProjects),
-- c'est la règle établie du projet — elle devient ici indispensable, pas seulement prudente.
-- ============================================================================

-- ── 1) Répartition des PAIEMENTS entre participants ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rw_expense_payers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id     uuid NOT NULL REFERENCES public.rw_expenses(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.rw_projects(id) ON DELETE CASCADE, -- dénormalisé (RLS)
  participant_id uuid NOT NULL REFERENCES public.rw_participants(id) ON DELETE CASCADE,
  amount         numeric NOT NULL DEFAULT 0,   -- montant POSITIF avancé par ce participant
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rw_expense_payers_expense ON public.rw_expense_payers(expense_id);
CREATE UNIQUE INDEX IF NOT EXISTS rw_expense_payers_unique
  ON public.rw_expense_payers(expense_id, participant_id);

ALTER TABLE public.rw_expense_payers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rw_expense_payers_all ON public.rw_expense_payers;
CREATE POLICY rw_expense_payers_all ON public.rw_expense_payers FOR ALL
  USING (public.rw_can_access(project_id))
  WITH CHECK (public.rw_can_access(project_id));

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rw_expense_payers;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- Reprise de l'existant : une dépense à un seul payeur devient une répartition à une ligne. Sans
-- ce backfill, les équilibres se calculeraient sur une table vide pour tout l'historique.
INSERT INTO public.rw_expense_payers (expense_id, project_id, participant_id, amount, created_at)
SELECT e.id, e.project_id, e.paid_by, e.amount, e.created_at
FROM public.rw_expenses e
WHERE NOT EXISTS (SELECT 1 FROM public.rw_expense_payers p WHERE p.expense_id = e.id)
ON CONFLICT (expense_id, participant_id) DO NOTHING;

-- ── 2) L'administrateur accède à tout ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rw_can_access(p_project uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.is_app_admin()
      OR EXISTS(SELECT 1 FROM public.rw_projects WHERE id = p_project AND owner_id = auth.uid())
      OR EXISTS(SELECT 1 FROM public.rw_participants WHERE project_id = p_project AND user_id = auth.uid());
$$;

-- Les RPC vérifiaient leur propre appartenance en plus de `rw_can_access` : elles héritent donc
-- automatiquement de la branche admin. Deux exceptions à traiter explicitement, parce qu'elles
-- comparent au PROPRIÉTAIRE et pas au périmètre.
CREATE OR REPLACE FUNCTION public.rw_remove_participant(p_participant uuid, p_reassign uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_part    public.rw_participants;
  v_owner   uuid;
  v_target  public.rw_participants;
  v_refs    integer;
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

    -- Quotes-parts et paiements : on FUSIONNE quand le repreneur figure déjà sur la même dépense
    -- (deux lignes pour la même personne fausseraient les équilibres), sinon on transfère.
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
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_cancel_invitation(uuid) TO authenticated;

/* RÉINVITER QUELQU'UN QU'ON A RETIRÉ. `rw_invite_by_code` refuse un utilisateur qui « participe
   déjà » — mais elle testait aussi les participants EN ATTENTE, y compris ceux d'une invitation
   refusée ou périmée : la personne retirée puis réinvitée se voyait opposer un refus sans pouvoir
   rien y faire. On ne bloque désormais que sur une participation RÉELLE (compte déjà rattaché),
   et on nettoie l'invitation morte au passage. */
CREATE OR REPLACE FUNCTION public.rw_invite_by_code(p_project uuid, p_code text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid; part uuid;
BEGIN
  IF NOT public.rw_can_access(p_project) THEN RAISE EXCEPTION 'Accès refusé à ce projet'; END IF;
  SELECT id INTO target FROM public.profiles WHERE upper(public_code) = upper(trim(p_code));
  IF target IS NULL THEN RAISE EXCEPTION 'Code utilisateur introuvable'; END IF;
  IF target = auth.uid() AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Tu ne peux pas t''inviter toi-même';
  END IF;
  IF EXISTS(SELECT 1 FROM public.rw_participants WHERE project_id = p_project AND user_id = target) THEN
    RAISE EXCEPTION 'Cette personne participe déjà à ce projet';
  END IF;
  -- Invitation en attente déjà envoyée à cette personne : on la remplace plutôt que de refuser.
  DELETE FROM public.rw_invitations
  WHERE project_id = p_project AND to_user_id = target AND status = 'pending';

  INSERT INTO public.rw_participants(project_id, user_id, display_name)
    VALUES (p_project, NULL, COALESCE(NULLIF(trim(p_name), ''),
            (SELECT full_name FROM public.profiles WHERE id = target), 'Invité'))
    RETURNING id INTO part;
  INSERT INTO public.rw_invitations(project_id, from_user_id, to_user_id, to_participant_id, status)
    VALUES (p_project, auth.uid(), target, part, 'pending');
  RETURN part;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_invite_by_code(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
