-- ============================================================================
-- 222 — LES STATISTIQUES NE COMPTENT PLUS LES ADMINISTRATEURS.
--
-- POURQUOI
-- ────────
-- Les comptes administrateurs vivent DANS la base de production. On y crée des comptes bidons pour
-- reproduire un bug, on ouvre l'app dix fois dans la journée pour vérifier qu'une OTA est bien
-- passée, on rejoue un état des lieux pour en relire la formulation. Tout cela est du TRAVAIL, pas
-- de l'usage — mais l'analytique ne fait pas la différence : elle enregistre des ouvertures, des
-- vues de page et des versions comme pour n'importe qui.
--
-- Sur une population de quelques centaines d'inscrits, deux ou trois administrateurs suffisent à
-- déplacer un DAU, un taux de conversion ou une répartition par palier de plusieurs points. On lit
-- alors ses propres allées et venues en croyant lire celles des utilisateurs — et on calibre des
-- seuils dessus.
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
-- Elle rejoue les deux agrégats administrateurs en écartant les lignes qui appartiennent à un
-- compte `profiles.is_admin` :
--   • `admin_app_version_stats` (215) — parc installé et versions ;
--   • `admin_profile_distribution` (211) — répartition de la population par palier.
-- Le reste des décomptes est assemblé côté client (Stats Hub) : il applique la même exclusion via
-- `lib/admin/statsScope`.
--
-- ⚠️ `NOT EXISTS (… AND p.is_admin)` et non `p.is_admin = false` : la colonne est NULLABLE, et un
-- `= false` écarterait les profils dont le drapeau n'a jamais été posé — c'est-à-dire l'immense
-- majorité des utilisateurs, exactement ceux qu'on veut compter.
--
-- ⚠️ À JOUER AVANT L'OTA. Une OTA arrive avant sa migration : entre les deux, l'écran filtrerait
-- ses propres décomptes mais lirait encore un parc installé et une répartition par palier qui
-- comptent les administrateurs. Rien ne casse — les deux moitiés de l'écran ne s'accordent
-- simplement pas tant que ce fichier n'est pas passé.
--
-- SÉCURITÉ — inchangée (cf. 211 / 215) : refus avant toute lecture si l'appelant n'est pas
-- administrateur, `search_path` figé, aucun identifiant en sortie.
-- ============================================================================

-- ── 1. Parc installé & versions (remplace la 215) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_app_version_stats(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_days  integer     := GREATEST(1, COALESCE(p_days, 90));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_out   jsonb;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;

  WITH recent AS (
    SELECT a.profile_id, a.platform, a.app_version, a.runtime_version, a.created_at
      FROM public.analytics_events a
     WHERE a.profile_id IS NOT NULL
       AND a.created_at >= v_since
       -- Les passages des administrateurs ne sont pas du parc installé : ce sont des vérifications.
       AND NOT EXISTS (
             SELECT 1 FROM public.profiles p WHERE p.id = a.profile_id AND p.is_admin
           )
  ),
  -- Ce que la personne fait tourner AUJOURD'HUI : son dernier évènement, pas sa moyenne.
  latest AS (
    SELECT DISTINCT ON (r.profile_id)
           r.profile_id, r.platform, r.app_version, r.runtime_version, r.created_at
      FROM recent r
     ORDER BY r.profile_id, r.created_at DESC
  ),
  -- L'usage, lui, se juge sur TOUTE la fenêtre : « web uniquement » = jamais vu sur un appareil.
  -- COALESCE(..., false) est indispensable : `bool_or` rend NULL si la plateforme n'est jamais
  -- renseignée, et un NULL ne tomberait alors dans AUCUN panier (ni la branche, ni sa négation).
  per_user AS (
    SELECT r.profile_id,
           COALESCE(bool_or(r.platform IN ('ios', 'android')), false) AS has_native,
           COALESCE(bool_or(r.platform = 'web'), false)               AS has_web
      FROM recent r
     GROUP BY r.profile_id
  ),
  by_version AS (
    SELECT COALESCE(NULLIF(l.platform, ''), 'inconnu') AS platform,
           NULLIF(l.app_version, '')                   AS app_version,
           NULLIF(l.runtime_version, '')               AS runtime_version,
           count(*)::bigint                            AS users,
           max(l.created_at)                           AS last_seen
      FROM latest l
     GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'days',         v_days,
    'since',        v_since,
    -- Même assiette que le reste de l'écran : sans ça, « X situés sur Y inscrits » comparerait
    -- une population sans administrateurs à un total qui les compte.
    'total_users',  (SELECT count(*) FROM public.profiles p WHERE NOT COALESCE(p.is_admin, false)),
    'active_users', (SELECT count(*) FROM latest),
    'usage', jsonb_build_object(
      'installed',   (SELECT count(*) FROM per_user WHERE has_native),                 -- app installée
      'web_only',    (SELECT count(*) FROM per_user WHERE has_web AND NOT has_native),  -- jamais installée
      'native_only', (SELECT count(*) FROM per_user WHERE has_native AND NOT has_web),
      'both',        (SELECT count(*) FROM per_user WHERE has_native AND has_web),
      'unknown',     (SELECT count(*) FROM per_user WHERE NOT has_native AND NOT has_web)
    ),
    'versions', COALESCE(
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.users DESC, v.platform) FROM by_version v),
      '[]'::jsonb
    )
  )
  INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_app_version_stats(integer) FROM public;
REVOKE ALL ON FUNCTION public.admin_app_version_stats(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_app_version_stats(integer) TO authenticated;

-- ── 2. Répartition par palier (remplace la 211) ─────────────────────────────────────────────
-- ⚠️ `user_financial_profile.profile_id` est le PALIER (P1…P9) ; l'utilisateur, c'est `user_id`.
CREATE OR REPLACE FUNCTION public.admin_profile_distribution(p_ladder_version integer DEFAULT 0)
RETURNS TABLE (profile_id text, users bigint, pending bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;

  RETURN QUERY
    SELECT fp.profile_id::text,
           count(*)::bigint,
           count(*) FILTER (WHERE COALESCE(fp.ladder_version, 0) < p_ladder_version)::bigint
      FROM public.user_financial_profile fp
     -- Un administrateur qui se range dans un palier n'est pas un utilisateur à segmenter : sur une
     -- petite population, ses comptes de test déforment l'histogramme qui sert à calibrer l'échelle.
     WHERE NOT EXISTS (
             SELECT 1 FROM public.profiles p WHERE p.id = fp.user_id AND p.is_admin
           )
     GROUP BY fp.profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_profile_distribution(integer) FROM public;
REVOKE ALL ON FUNCTION public.admin_profile_distribution(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_profile_distribution(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ─────────────────────────────────────────────────────────────────
--   -- Combien de lignes l'exclusion retire (doit correspondre au nombre d'admins actifs) :
--   SELECT count(DISTINCT a.profile_id) FROM analytics_events a
--     JOIN profiles p ON p.id = a.profile_id AND p.is_admin
--    WHERE a.created_at >= now() - interval '30 days';
--   SELECT admin_app_version_stats(30);          -- `active_users` doit avoir baissé d'autant
--   SELECT * FROM admin_profile_distribution(4); -- total = inscrits classés, admins exclus
