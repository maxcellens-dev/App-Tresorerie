-- ============================================================================
-- RÉPARATION des policies Relyka World (au cas où 069 aurait été appliquée
-- partiellement → RLS activée mais policy d'INSERT manquante = erreur 42501).
-- Idempotent : on (re)crée la fonction d'accès, on réactive RLS et on recrée
-- toutes les policies. À exécuter dans Supabase SQL Editor.
-- ============================================================================

-- Fonction d'accès (SECURITY DEFINER → pas de récursion RLS).
CREATE OR REPLACE FUNCTION public.rw_can_access(p_project uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.rw_projects WHERE id = p_project AND owner_id = auth.uid())
      OR EXISTS(SELECT 1 FROM public.rw_participants WHERE project_id = p_project AND user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.rw_can_access(uuid) TO authenticated;

ALTER TABLE public.rw_projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_expenses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_expense_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_invitations    ENABLE ROW LEVEL SECURITY;

-- rw_projects
DROP POLICY IF EXISTS rw_proj_select ON public.rw_projects;
DROP POLICY IF EXISTS rw_proj_insert ON public.rw_projects;
DROP POLICY IF EXISTS rw_proj_update ON public.rw_projects;
DROP POLICY IF EXISTS rw_proj_delete ON public.rw_projects;
CREATE POLICY rw_proj_select ON public.rw_projects FOR SELECT TO authenticated USING (rw_can_access(id));
CREATE POLICY rw_proj_insert ON public.rw_projects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY rw_proj_update ON public.rw_projects FOR UPDATE TO authenticated USING (owner_id = auth.uid());
CREATE POLICY rw_proj_delete ON public.rw_projects FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- rw_participants
DROP POLICY IF EXISTS rw_part_select ON public.rw_participants;
DROP POLICY IF EXISTS rw_part_cud ON public.rw_participants;
CREATE POLICY rw_part_select ON public.rw_participants FOR SELECT TO authenticated USING (rw_can_access(project_id));
CREATE POLICY rw_part_cud ON public.rw_participants FOR ALL TO authenticated USING (rw_can_access(project_id)) WITH CHECK (rw_can_access(project_id));

-- rw_expenses
DROP POLICY IF EXISTS rw_exp_all ON public.rw_expenses;
CREATE POLICY rw_exp_all ON public.rw_expenses FOR ALL TO authenticated USING (rw_can_access(project_id)) WITH CHECK (rw_can_access(project_id));

-- rw_expense_shares
DROP POLICY IF EXISTS rw_share_all ON public.rw_expense_shares;
CREATE POLICY rw_share_all ON public.rw_expense_shares FOR ALL TO authenticated USING (rw_can_access(project_id)) WITH CHECK (rw_can_access(project_id));

-- rw_invitations
DROP POLICY IF EXISTS rw_inv_select ON public.rw_invitations;
DROP POLICY IF EXISTS rw_inv_insert ON public.rw_invitations;
DROP POLICY IF EXISTS rw_inv_update ON public.rw_invitations;
DROP POLICY IF EXISTS rw_inv_delete ON public.rw_invitations;
CREATE POLICY rw_inv_select ON public.rw_invitations FOR SELECT TO authenticated USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY rw_inv_insert ON public.rw_invitations FOR INSERT TO authenticated WITH CHECK (from_user_id = auth.uid() AND rw_can_access(project_id));
CREATE POLICY rw_inv_update ON public.rw_invitations FOR UPDATE TO authenticated USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY rw_inv_delete ON public.rw_invitations FOR DELETE TO authenticated USING (from_user_id = auth.uid());

-- Trigger : owner_id = auth.uid() (robuste).
CREATE OR REPLACE FUNCTION public.rw_set_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.owner_id := auth.uid();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_rw_projects_owner ON public.rw_projects;
CREATE TRIGGER trg_rw_projects_owner BEFORE INSERT ON public.rw_projects
  FOR EACH ROW EXECUTE FUNCTION public.rw_set_owner();
