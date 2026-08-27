-- ============================================================================
-- 215 — QUELLE VERSION DE L'APP LES GENS FONT-ILS TOURNER (et qui ne fait que du web).
--
-- POURQUOI
-- ────────
-- L'écran « Mise à jour de l'App » laisse déclarer une « dernière version publiée » et une « version
-- minimale requise » — deux réglages qui décident si un bandeau, voire un bandeau BLOQUANT, s'affiche
-- chez les gens. Or rien ne permettait de savoir COMBIEN de monde ces réglages allaient toucher :
-- l'analytique enregistrait la plateforme (web / ios / android), jamais la version. On publiait donc
-- une version minimale à l'aveugle, sans pouvoir répondre à « qui va se retrouver bloqué ? ».
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
--   1. deux colonnes sur `analytics_events` : la version applicative RÉELLEMENT exécutée
--      (`app_version`, celle que compare le bandeau de mise à jour) et la génération native
--      (`runtime_version`, qui ne change qu'à une vraie build store) ;
--   2. un index (profil, date décroissante) — sans lui, « le dernier évènement de chaque personne »
--      est un balayage complet de la table ;
--   3. une fonction d'agrégation qui rend une poignée de lignes, quel que soit le nombre d'inscrits.
--
-- CE QUE MESURE LA FONCTION
-- ─────────────────────────
-- La version d'une personne, c'est celle de son DERNIER évènement — pas la plus fréquente sur la
-- période : quelqu'un qui vient de mettre à jour est sur la nouvelle version, même s'il a passé
-- trois semaines sur l'ancienne. En parallèle, l'usage est classé sur TOUTE la fenêtre : « web
-- uniquement » signifie qu'on n'a jamais vu cette personne sur un appareil, donc qu'elle n'a pas
-- l'app installée — l'information qui manquait pour peser une décision de version minimale.
--
-- ⚠️ Les évènements ANTÉRIEURS à cette migration n'ont pas de version : ils remontent en « version
-- inconnue » et se résorbent d'eux-mêmes à mesure que les gens rouvrent l'app. L'écran le dit
-- explicitement plutôt que de faire passer un trou de mesure pour une population.
--
-- SÉCURITÉ
-- ────────
-- `SECURITY DEFINER` contourne la RLS — indispensable pour compter toute la population, dangereux
-- si c'est ouvert à tous. Mêmes garde-fous que la 211 : refus avant toute lecture si l'appelant
-- n'est pas administrateur, `search_path` figé, et AUCUN identifiant en sortie — que des agrégats.
-- ============================================================================

-- ── 1. Les colonnes ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS app_version     text,   -- version exécutée (JS embarqué ou OTA)
  ADD COLUMN IF NOT EXISTS runtime_version text;   -- génération native (ne bouge qu'à une build)

-- ── 2. L'index ──────────────────────────────────────────────────────────────────────────────
-- « Le dernier évènement de chaque personne » = un DISTINCT ON (profile_id) ORDER BY created_at DESC.
-- L'index existant ne porte que sur `profile_id` : il faut la date DANS l'index pour éviter un tri.
CREATE INDEX IF NOT EXISTS idx_analytics_profile_recent
  ON public.analytics_events (profile_id, created_at DESC);

-- ── 3. L'agrégation ─────────────────────────────────────────────────────────────────────────
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
  -- Refus AVANT toute lecture (cf. migration 101 — `is_app_admin` lit `profiles.is_admin` hors RLS,
  -- colonne verrouillée depuis la 203 : on ne peut pas s'auto-promouvoir).
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;

  WITH recent AS (
    SELECT a.profile_id, a.platform, a.app_version, a.runtime_version, a.created_at
      FROM public.analytics_events a
     WHERE a.profile_id IS NOT NULL
       AND a.created_at >= v_since
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
    'total_users',  (SELECT count(*) FROM public.profiles),
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

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ─────────────────────────────────────────────────────────────────
--   SELECT admin_app_version_stats(30);   -- en admin : { usage: {...}, versions: [...] }
--   -- connecté en tant qu'utilisateur ordinaire : doit lever « Réservé aux administrateurs ».
--   -- Tant que personne n'a rouvert l'app depuis la migration, `versions` ne contient que des
--   -- lignes à `app_version: null` — c'est normal, pas une panne.
