-- ============================================================================
-- 211 — LE DÉCOMPTE DES PROFILS SE FAIT EN BASE, PAS DANS LE TÉLÉPHONE.
--
-- POURQUOI
-- ────────
-- L'écran d'administration affiche la répartition de la population par palier — c'est l'instrument
-- de calibrage de toute l'échelle : une échelle qui range 70 % des gens dans le même palier ne
-- segmente rien, elle donne le même conseil à tout le monde en ayant l'air de personnaliser.
--
-- Ce décompte se faisait CÔTÉ CLIENT : on téléchargeait jusqu'à 5 000 lignes de
-- `user_financial_profile` pour les compter en JavaScript. Deux problèmes, l'un aujourd'hui, l'autre
-- demain :
--   • la limite de 5 000 n'est pas signalée à l'écran — passé ce cap, l'administrateur lit une
--     répartition TRONQUÉE en la croyant complète, et calibre des seuils dessus ;
--   • on fait transiter une ligne par utilisateur pour n'en garder qu'un total.
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
-- Une fonction d'agrégation qui rend dix lignes, quel que soit le nombre d'inscrits : le palier, le
-- nombre d'utilisateurs, et combien d'entre eux sont encore classés par une version PRÉCÉDENTE de
-- l'échelle (ils seront reclassés en silence à leur prochaine ouverture).
--
-- La version de l'échelle est passée EN PARAMÈTRE, jamais écrite ici : elle vit dans le code
-- (`PROFILE_LADDER_VERSION`), et deux définitions d'un même numéro finissent toujours par diverger.
--
-- SÉCURITÉ
-- ────────
-- `SECURITY DEFINER` contourne la RLS — c'est précisément ce qu'il faut pour compter TOUTE la
-- population, et c'est aussi ce qui la rend dangereuse si elle est ouverte à tous. Trois garde-fous :
--   1. le premier geste de la fonction est de vérifier `is_app_admin()` — un inscrit ordinaire est
--      refusé net, avant toute lecture ;
--   2. `search_path` est figé, pour qu'on ne puisse pas lui faire lire une table homonyme ;
--   3. elle ne rend QUE des agrégats : aucun identifiant, aucune donnée personnelle, jamais.
--
-- Le client garde son décompte local en repli : une OTA arrive avant une migration, et l'écran doit
-- continuer de fonctionner entre les deux.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_profile_distribution(p_ladder_version integer DEFAULT 0)
RETURNS TABLE (profile_id text, users bigint, pending bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refus AVANT toute lecture : la fonction voit toute la base, elle ne doit s'ouvrir qu'aux
  -- administrateurs réels (cf. migration 101 — `is_app_admin` lit `profiles.is_admin` hors RLS,
  -- colonne elle-même verrouillée depuis la 203 : on ne peut pas s'auto-promouvoir).
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;

  RETURN QUERY
    SELECT fp.profile_id::text,
           count(*)::bigint,
           count(*) FILTER (WHERE COALESCE(fp.ladder_version, 0) < p_ladder_version)::bigint
      FROM public.user_financial_profile fp
     GROUP BY fp.profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_profile_distribution(integer) FROM public;
REVOKE ALL ON FUNCTION public.admin_profile_distribution(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_profile_distribution(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT * FROM admin_profile_distribution(2);      -- en admin : une ligne par palier peuplé
--   -- connecté en tant qu'utilisateur ordinaire : doit lever « Réservé aux administrateurs ».
