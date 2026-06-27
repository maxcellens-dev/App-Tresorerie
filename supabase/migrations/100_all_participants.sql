-- ============================================================================
-- 100 — Participants de TOUS mes comptes partagés/joints (pour la page Transactions).
--
-- La page Transactions liste des écritures de plusieurs comptes : pour afficher « par {auteur} » sur
-- les lignes des comptes partagés, on a besoin d'une seule map {user_id → nom} couvrant tous mes
-- comptes accessibles (propriétaires + membres). acct_participants ne couvre qu'un compte ; ici on
-- agrège sur tous les comptes auxquels j'ai accès.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.acct_all_participants()
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  -- Propriétaires des comptes auxquels j'ai accès (nom via profiles, RLS contournée par SECURITY DEFINER).
  SELECT DISTINCT a.profile_id, COALESCE(NULLIF(p.full_name, ''), 'Propriétaire')
  FROM public.accounts a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  WHERE public.acct_can_access(a.id)
  UNION
  -- Membres inscrits de ces comptes.
  SELECT DISTINCT m.user_id, m.display_name
  FROM public.account_members m
  WHERE m.user_id IS NOT NULL AND public.acct_can_access(m.account_id);
$$;

GRANT EXECUTE ON FUNCTION public.acct_all_participants() TO authenticated;
