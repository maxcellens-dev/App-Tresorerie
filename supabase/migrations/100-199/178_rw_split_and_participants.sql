-- ============================================================================
-- 178 — Relyka World : répartition fine des dépenses + retrait de participants.
--
-- Trois manques, tous constatés à l'usage :
--
--  1. RÉPARTITION ÉGALE OBLIGATOIRE. Une dépense partagée se coupait toujours en parts égales
--     entre les personnes cochées. Or trois personnes au restaurant ne mangent pas le même menu :
--     il faut pouvoir dire « 42 € pour toi, 18 € pour moi ». Le modèle le permettait déjà
--     (rw_expense_shares.amount est un montant, pas un pourcentage) — c'est l'écran de saisie qui
--     imposait le partage égal. Rien à changer en base de ce côté.
--
--  2. UN SEUL COMPTE PAR DÉPENSE. `rw_expenses.account_id` / `transaction_id` ne peuvent porter
--     qu'un compte. Payer 200 € dont 150 € sur le compte courant et 50 € sur un autre était
--     impossible. D'où `rw_expense_accounts` : la répartition du PAIEMENT (à ne pas confondre avec
--     rw_expense_shares, qui est la répartition de la DETTE entre participants).
--     Les colonnes historiques restent renseignées avec la PREMIÈRE ligne de la répartition : tout
--     le code existant (pastille « projet », suppression de projet, garde-fou « a impacté un vrai
--     compte ») continue de fonctionner sans être réécrit.
--
--  3. AUCUN RETRAIT DE PARTICIPANT. On ne pouvait qu'ajouter. Supprimer la ligne directement était
--     hors de question : `rw_expenses.paid_by` est en ON DELETE CASCADE → retirer quelqu'un aurait
--     effacé TOUTES les dépenses qu'il a payées, pour tout le monde. D'où une RPC qui exige un
--     repreneur dès qu'il reste la moindre trace du participant.
-- ============================================================================

-- ── 1) Répartition du PAIEMENT sur plusieurs comptes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rw_expense_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id     uuid NOT NULL REFERENCES public.rw_expenses(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.rw_projects(id) ON DELETE CASCADE, -- dénormalisé (RLS)
  account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  amount         numeric NOT NULL DEFAULT 0,   -- montant POSITIF payé depuis ce compte
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rw_expense_accounts_expense ON public.rw_expense_accounts(expense_id);
CREATE INDEX IF NOT EXISTS rw_expense_accounts_creator ON public.rw_expense_accounts(created_by);

ALTER TABLE public.rw_expense_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rw_expense_accounts_all ON public.rw_expense_accounts;
-- Même périmètre que les parts : membre du projet. Le garde-fou sur le COMPTE reste celui de
-- `transactions` (on ne peut écrire une transaction que sur un compte auquel on a droit).
CREATE POLICY rw_expense_accounts_all ON public.rw_expense_accounts FOR ALL
  USING (public.rw_can_access(project_id))
  WITH CHECK (public.rw_can_access(project_id));

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rw_expense_accounts;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- Reprise de l'existant : chaque dépense déjà payée depuis un compte devient une répartition à une
-- seule ligne. Sans ça, l'écran « dépenses par compte » ignorerait tout l'historique.
INSERT INTO public.rw_expense_accounts (expense_id, project_id, account_id, transaction_id, amount, created_by, created_at)
SELECT e.id, e.project_id, e.account_id, e.transaction_id, e.amount, e.created_by, e.created_at
FROM public.rw_expenses e
WHERE e.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.rw_expense_accounts a WHERE a.expense_id = e.id);

-- ── 2) Liste des projets de l'utilisateur EN UN SEUL ALLER-RETOUR ───────────────────────────
-- Le client faisait 2 requêtes (mes projets, mes participations) puis une 3ᵉ pour charger les
-- lignes : trois allers-retours en série avant le moindre pixel, là où les projets PERSO sortaient
-- du cache instantanément. D'où la moitié de page qui arrivait en retard.
CREATE OR REPLACE FUNCTION public.rw_my_projects()
RETURNS SETOF public.rw_projects
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT p.*
  FROM public.rw_projects p
  WHERE p.owner_id = auth.uid()
     OR EXISTS (SELECT 1 FROM public.rw_participants rp
                WHERE rp.project_id = p.id AND rp.user_id = auth.uid())
  ORDER BY p.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.rw_my_projects() TO authenticated;

-- ── 3) Retirer un participant ───────────────────────────────────────────────────────────────
-- Autorisé au PROPRIÉTAIRE du projet, et à chacun pour lui-même (quitter un projet).
--
-- `p_reassign` = participant qui REPREND ce que le partant laisse (dépenses avancées + quotes-parts).
-- Il est OBLIGATOIRE dès qu'il reste une trace : sans lui, la cascade de `paid_by` effacerait des
-- dépenses chez tout le monde. Avec lui, les équilibres du projet restent exacts — rien ne
-- disparaît, tout change simplement de nom.
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
  IF v_owner <> auth.uid() AND v_part.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Seul le créateur du projet peut retirer un participant';
  END IF;
  IF v_part.user_id = v_owner THEN
    RAISE EXCEPTION 'Le créateur du projet ne peut pas être retiré. Supprime ou archive le projet.';
  END IF;

  SELECT (SELECT count(*) FROM public.rw_expenses      WHERE paid_by = p_participant)
       + (SELECT count(*) FROM public.rw_expense_shares WHERE participant_id = p_participant)
    INTO v_refs;

  IF v_refs > 0 THEN
    IF p_reassign IS NULL THEN
      RAISE EXCEPTION 'Ce participant apparaît dans % dépense(s) ou part(s) : choisis qui les reprend.', v_refs;
    END IF;
    SELECT * INTO v_target FROM public.rw_participants WHERE id = p_reassign;
    IF v_target.id IS NULL OR v_target.project_id <> v_part.project_id THEN
      RAISE EXCEPTION 'Le repreneur doit être un participant du même projet';
    END IF;
    IF v_target.id = v_part.id THEN RAISE EXCEPTION 'Le repreneur doit être quelqu''un d''autre'; END IF;

    -- Dépenses avancées → le repreneur en devient le payeur.
    UPDATE public.rw_expenses SET paid_by = p_reassign WHERE paid_by = p_participant;

    -- Quotes-parts : on les FUSIONNE (le repreneur peut déjà en avoir une sur la même dépense —
    -- deux lignes pour la même personne fausseraient les équilibres).
    UPDATE public.rw_expense_shares t
    SET amount = t.amount + s.amount
    FROM public.rw_expense_shares s
    WHERE s.participant_id = p_participant
      AND t.participant_id = p_reassign
      AND t.expense_id = s.expense_id;

    DELETE FROM public.rw_expense_shares s
    WHERE s.participant_id = p_participant
      AND EXISTS (SELECT 1 FROM public.rw_expense_shares t
                  WHERE t.participant_id = p_reassign AND t.expense_id = s.expense_id);

    UPDATE public.rw_expense_shares SET participant_id = p_reassign WHERE participant_id = p_participant;
  END IF;

  -- Invitation en attente rattachée à ce participant : elle n'a plus d'objet.
  DELETE FROM public.rw_invitations
  WHERE to_participant_id = p_participant AND status = 'pending';

  DELETE FROM public.rw_participants WHERE id = p_participant;
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_remove_participant(uuid, uuid) TO authenticated;

-- Annuler une invitation ENVOYÉE et pas encore acceptée (le participant « en attente » repart avec).
CREATE OR REPLACE FUNCTION public.rw_cancel_invitation(p_participant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_part public.rw_participants; v_owner uuid;
BEGIN
  SELECT * INTO v_part FROM public.rw_participants WHERE id = p_participant;
  IF v_part.id IS NULL THEN RETURN; END IF;
  SELECT owner_id INTO v_owner FROM public.rw_projects WHERE id = v_part.project_id;
  IF v_owner <> auth.uid() THEN RAISE EXCEPTION 'Seul le créateur du projet peut annuler une invitation'; END IF;
  IF v_part.user_id IS NOT NULL THEN RAISE EXCEPTION 'Cette personne a déjà rejoint le projet'; END IF;
  DELETE FROM public.rw_invitations WHERE to_participant_id = p_participant AND status = 'pending';
END; $$;
GRANT EXECUTE ON FUNCTION public.rw_cancel_invitation(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
