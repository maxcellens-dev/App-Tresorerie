-- ============================================================================
-- 190 — ROUVRIR UN MOIS : la suppression atteint enfin tout ce que la clôture a écrit.
--
-- La version de la 179 ne supprimait que `profile_id = auth.uid()`. Deux angles morts :
--
--   • COMPTES JOINTS. La clôture d'un compte joint est faite par UN participant (migration 179 :
--     une clôture par compte, quel que soit son auteur) et la régularisation porte SON profil.
--     Quand l'autre rouvrait le mois, la trace `account_closures` partait — elle, elle est bien
--     supprimée par rôle — mais la régularisation restait. Le compte gardait une ancre de solde
--     appartenant à un mois qui n'était plus clôturé.
--
--   • CONNECTÉ EN TANT QUE. `auth.uid()` reste celui de l'administrateur : la fonction cherchait
--     les régularisations de l'ADMIN, n'en trouvait aucune, et rendait la main sans rien dire.
--     Rouvrir un mois pour dépanner quelqu'un ne faisait donc rien du tout.
--
-- Le périmètre devient celui du COMPTE (propriétaire ou membre en écriture) — exactement celui qui
-- autorise déjà à clôturer et à effacer la trace de clôture — plus le profil traité. Et la fonction
-- retourne le nombre de lignes supprimées, que l'appelant contrôle : une réouverture qui n'a rien
-- défait n'est pas une réouverture.
-- ============================================================================

DROP FUNCTION IF EXISTS public.reopen_month_regularisations(text);

CREATE OR REPLACE FUNCTION public.reopen_month_regularisations(p_month text, p_profile uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_from    date;
  v_to      date;
  n         integer := 0;
  d         integer;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  IF p_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mois invalide'; END IF;

  /* Sur quel profil travaille-t-on ? Le sien, sauf pour un administrateur en dépannage — qui doit
     le désigner explicitement. Personne d'autre ne peut viser un autre profil que le sien. */
  v_profile := COALESCE(p_profile, v_uid);
  IF v_profile <> v_uid AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Réservé au propriétaire du compte';
  END IF;

  v_from := (p_month || '-01')::date;
  v_to   := (v_from + interval '1 month - 1 day')::date;

  -- Marque posée par la clôture (migration 179) : c'est le critère principal, sans ambiguïté
  -- possible avec une régularisation saisie à la main (qui n'en porte jamais).
  DELETE FROM public.transactions t
  WHERE t.closure_month = p_month
    AND (t.profile_id = v_profile OR public.acct_role(t.account_id) IN ('owner', 'write'));
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Repli historique (lignes écrites avant la marque), au libellé et à la date. On ne touche
  -- « Régularisation solde » que datée EXACTEMENT du dernier jour du mois : c'est la seule date que
  -- la clôture lui donne, une saisie manuelle tombant ce jour-là reste donc théoriquement possible
  -- — d'où l'exigence supplémentaire d'un `regul_target`, que seule une clôture renseigne ici.
  DELETE FROM public.transactions t
  WHERE t.closure_month IS NULL
    AND (t.profile_id = v_profile OR public.acct_role(t.account_id) IN ('owner', 'write'))
    AND (
      (t.note IN ('Régularisation (à jour)', 'Régularisation clôture (mois)') AND t.date BETWEEN v_from AND v_to)
      OR (t.note = 'Régularisation clôture (mois courant)' AND t.date > v_to)
      OR (t.note = 'Régularisation solde' AND t.date = v_to AND t.regul_target IS NOT NULL)
    );
  GET DIAGNOSTICS d = ROW_COUNT;
  n := n + d;

  -- Trace de clôture par compte (comptes joints compris).
  DELETE FROM public.account_closures c
  WHERE c.month_key = p_month
    AND (public.acct_role(c.account_id) IN ('owner', 'write')
         OR EXISTS (SELECT 1 FROM public.accounts a
                     WHERE a.id = c.account_id AND a.profile_id = v_profile));

  RETURN n;
END; $$;
GRANT EXECUTE ON FUNCTION public.reopen_month_regularisations(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
