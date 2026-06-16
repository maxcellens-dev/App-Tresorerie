-- ============================================================================
-- Relyka World — comptes partagés type « Tricount » intégrés à Relyka.
-- Projets partagés entre utilisateurs, dépenses, répartition, équilibres,
-- invitations par ID public. RLS : accès réservé aux membres d'un projet.
-- ============================================================================

-- 1) ID PUBLIC PARTAGEABLE sur les profils ------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_code text UNIQUE;

-- Génère un code court unique (8 caractères hex majuscules).
CREATE OR REPLACE FUNCTION public.rw_gen_public_code() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE code text; ok boolean;
BEGIN
  LOOP
    code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    SELECT NOT EXISTS(SELECT 1 FROM public.profiles WHERE public_code = code) INTO ok;
    EXIT WHEN ok;
  END LOOP;
  RETURN code;
END; $$;

-- Backfill des profils existants.
UPDATE public.profiles SET public_code = public.rw_gen_public_code() WHERE public_code IS NULL;

-- Auto-attribution à la création d'un profil.
CREATE OR REPLACE FUNCTION public.rw_set_public_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_code IS NULL THEN NEW.public_code := public.rw_gen_public_code(); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_profiles_public_code ON public.profiles;
CREATE TRIGGER trg_profiles_public_code BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.rw_set_public_code();

-- 2) TABLES -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rw_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  emoji text DEFAULT '💸',
  description text DEFAULT '',
  currency text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rw_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.rw_projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = simple nom (non inscrit)
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rw_participants_unique_user
  ON public.rw_participants(project_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rw_participants_project ON public.rw_participants(project_id);

CREATE TABLE IF NOT EXISTS public.rw_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.rw_projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  emoji text,
  amount numeric NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  date date NOT NULL DEFAULT current_date,
  paid_by uuid NOT NULL REFERENCES public.rw_participants(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Lien éventuel vers une VRAIE transaction du compte du payeur (NULL si « cash »).
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rw_expenses_project ON public.rw_expenses(project_id);

CREATE TABLE IF NOT EXISTS public.rw_expense_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.rw_expenses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.rw_projects(id) ON DELETE CASCADE,  -- dénormalisé (RLS)
  participant_id uuid NOT NULL REFERENCES public.rw_participants(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rw_shares_expense ON public.rw_expense_shares(expense_id);

CREATE TABLE IF NOT EXISTS public.rw_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.rw_projects(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_participant_id uuid REFERENCES public.rw_participants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rw_invitations_unique_pending
  ON public.rw_invitations(project_id, to_user_id) WHERE status = 'pending';

-- 3) CONTRÔLE D'ACCÈS (SECURITY DEFINER → pas de récursion RLS) ---------------
CREATE OR REPLACE FUNCTION public.rw_can_access(p_project uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.rw_projects WHERE id = p_project AND owner_id = auth.uid())
      OR EXISTS(SELECT 1 FROM public.rw_participants WHERE project_id = p_project AND user_id = auth.uid());
$$;

-- 4) RLS ----------------------------------------------------------------------
ALTER TABLE public.rw_projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_expenses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_expense_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_invitations    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rw_proj_select ON public.rw_projects;
DROP POLICY IF EXISTS rw_proj_insert ON public.rw_projects;
DROP POLICY IF EXISTS rw_proj_update ON public.rw_projects;
DROP POLICY IF EXISTS rw_proj_delete ON public.rw_projects;
CREATE POLICY rw_proj_select ON public.rw_projects FOR SELECT USING (rw_can_access(id));
CREATE POLICY rw_proj_insert ON public.rw_projects FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY rw_proj_update ON public.rw_projects FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY rw_proj_delete ON public.rw_projects FOR DELETE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS rw_part_select ON public.rw_participants;
DROP POLICY IF EXISTS rw_part_cud ON public.rw_participants;
CREATE POLICY rw_part_select ON public.rw_participants FOR SELECT USING (rw_can_access(project_id));
CREATE POLICY rw_part_cud ON public.rw_participants FOR ALL USING (rw_can_access(project_id)) WITH CHECK (rw_can_access(project_id));

DROP POLICY IF EXISTS rw_exp_all ON public.rw_expenses;
CREATE POLICY rw_exp_all ON public.rw_expenses FOR ALL USING (rw_can_access(project_id)) WITH CHECK (rw_can_access(project_id));

DROP POLICY IF EXISTS rw_share_all ON public.rw_expense_shares;
CREATE POLICY rw_share_all ON public.rw_expense_shares FOR ALL USING (rw_can_access(project_id)) WITH CHECK (rw_can_access(project_id));

DROP POLICY IF EXISTS rw_inv_select ON public.rw_invitations;
DROP POLICY IF EXISTS rw_inv_insert ON public.rw_invitations;
DROP POLICY IF EXISTS rw_inv_update ON public.rw_invitations;
DROP POLICY IF EXISTS rw_inv_delete ON public.rw_invitations;
CREATE POLICY rw_inv_select ON public.rw_invitations FOR SELECT USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY rw_inv_insert ON public.rw_invitations FOR INSERT WITH CHECK (from_user_id = auth.uid() AND rw_can_access(project_id));
CREATE POLICY rw_inv_update ON public.rw_invitations FOR UPDATE USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY rw_inv_delete ON public.rw_invitations FOR DELETE USING (from_user_id = auth.uid());

-- 5) RPC ----------------------------------------------------------------------
-- Inviter un utilisateur par son code public : crée un participant « en attente » + l'invitation.
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
  INSERT INTO public.rw_participants(project_id, user_id, display_name)
    VALUES (p_project, NULL, COALESCE(NULLIF(trim(p_name), ''),
            (SELECT full_name FROM public.profiles WHERE id = target), 'Invité'))
    RETURNING id INTO part;
  INSERT INTO public.rw_invitations(project_id, from_user_id, to_user_id, to_participant_id, status)
    VALUES (p_project, auth.uid(), target, part, 'pending');
  RETURN part;
END; $$;

-- Accepter une invitation : lie le participant à l'utilisateur (avec son vrai nom).
CREATE OR REPLACE FUNCTION public.rw_accept_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.rw_invitations; myname text;
BEGIN
  SELECT * INTO inv FROM public.rw_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  SELECT COALESCE(full_name, 'Invité') INTO myname FROM public.profiles WHERE id = auth.uid();
  IF inv.to_participant_id IS NOT NULL THEN
    UPDATE public.rw_participants SET user_id = inv.to_user_id, display_name = myname
      WHERE id = inv.to_participant_id;
  ELSE
    INSERT INTO public.rw_participants(project_id, user_id, display_name)
      VALUES (inv.project_id, inv.to_user_id, myname);
  END IF;
  UPDATE public.rw_invitations SET status = 'accepted' WHERE id = p_invite;
END; $$;

-- Refuser une invitation : retire le participant « en attente » et marque refusé.
CREATE OR REPLACE FUNCTION public.rw_decline_invitation(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.rw_invitations;
BEGIN
  SELECT * INTO inv FROM public.rw_invitations WHERE id = p_invite;
  IF inv.id IS NULL OR inv.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Invitation invalide'; END IF;
  IF inv.to_participant_id IS NOT NULL THEN
    DELETE FROM public.rw_participants WHERE id = inv.to_participant_id AND user_id IS NULL;
  END IF;
  UPDATE public.rw_invitations SET status = 'declined' WHERE id = p_invite;
END; $$;

GRANT EXECUTE ON FUNCTION public.rw_invite_by_code(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rw_accept_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rw_decline_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rw_can_access(uuid) TO authenticated;

-- 6) REALTIME (sync live entre participants) — sans échec si déjà présent / publication absente.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rw_expenses;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rw_expense_shares;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rw_participants;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
