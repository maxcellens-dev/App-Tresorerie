-- ============================================================================
-- 099 — Participants d'un compte partagé/joint (pour identifier l'AUTEUR d'une transaction).
--
-- Confidentialité : sur un compte joint, les virements d'un membre concernent souvent SES comptes
-- personnels, que les autres membres ne doivent pas voir. On ne peut pas lire le profil/les comptes
-- d'un autre user (RLS). Cette fonction renvoie, pour un compte auquel j'ai accès, la liste
-- {user_id, display_name} de ses participants (propriétaire + membres inscrits) — assez pour afficher
-- « par Untel » sur chaque transaction, sans rien dévoiler des comptes perso des autres.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.acct_participants(p_account uuid)
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  -- Propriétaire (nom depuis profiles ; SECURITY DEFINER → contourne la RLS profiles).
  SELECT a.profile_id, COALESCE(NULLIF(p.full_name, ''), 'Propriétaire')
  FROM public.accounts a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = p_account AND public.acct_can_access(p_account)
  UNION
  -- Membres inscrits (nom = display_name du membre).
  SELECT m.user_id, m.display_name
  FROM public.account_members m
  WHERE m.account_id = p_account AND m.user_id IS NOT NULL AND public.acct_can_access(p_account);
$$;

GRANT EXECUTE ON FUNCTION public.acct_participants(uuid) TO authenticated;
