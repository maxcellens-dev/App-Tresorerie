-- ============================================================================
-- 171 — ÉTAT DES LIEUX : suppression du POINT HEBDO et du SYSTÈME DE NOTATION.
--
-- Deux décisions produit, appliquées ensemble :
--
--  1. LE POINT HEBDO N'EXISTE PLUS. Un seul rendez-vous : l'état des lieux du mois écoulé
--     (inchangé par ailleurs). Plus de carte hebdomadaire, plus de déclenchement en fin de
--     semaine, plus de push hebdo « système ».
--
--  2. PLUS AUCUN JUGEMENT. L'état des lieux donne une VISION d'un mois : il n'a plus ni statut de
--     signal, ni couleur (vert / orange / rouge), ni « repères » par profil (matelas visé, taux
--     d'épargne, part de la capacité d'investissement) — c'est de là que venaient les couleurs.
--     Les signaux « Épargne du mois » et « Investissement du mois » disparaissent aussi : l'anneau
--     du bilan et sa légende (mis de côté · placé · conservé) disent déjà ces montants.
--     Conséquence directe : les succès « mois au vert » n'ont plus d'objet.
--
-- Rien n'est supprimé côté COLONNES (green_count / judged_count / all_green restent en base avec
-- leur DEFAULT) : elles ne sont plus écrites ni lues, et les garder évite de casser une lecture
-- oubliée. Elles pourront être retirées plus tard, une fois l'OTA déployée partout.
-- ============================================================================

-- 1) Config admin ────────────────────────────────────────────────────────────
-- On retire les clés devenues sans objet et on nettoie la sélection de signaux par profil.
-- `resolvePulseConfig` (lib/pulseEngine) filtre déjà les signaux inconnus côté client : cette
-- mise à jour évite simplement de traîner une config morte en base.
UPDATE public.app_config
SET pulse = (pulse - 'weekly' - 'weeklyPush' - 'benchmarks')
WHERE id = 'default'
  AND (pulse ? 'weekly' OR pulse ? 'weeklyPush' OR pulse ? 'benchmarks');

-- Signaux par profil : on enlève 'saving' et 'investing' (retirés du code) en gardant l'ordre.
UPDATE public.app_config AS c
SET pulse = jsonb_set(
  c.pulse,
  '{signalsByProfile}',
  (
    SELECT COALESCE(jsonb_object_agg(p.key, p.kept), '{}'::jsonb)
    FROM (
      SELECT
        sp.key,
        COALESCE(
          (
            SELECT jsonb_agg(s.value ORDER BY s.ord)
            FROM jsonb_array_elements(sp.value) WITH ORDINALITY AS s(value, ord)
            WHERE s.value #>> '{}' NOT IN ('saving', 'investing')
          ),
          '[]'::jsonb
        ) AS kept
      FROM jsonb_each(c.pulse -> 'signalsByProfile') AS sp(key, value)
    ) AS p
  )
)
WHERE c.id = 'default'
  AND jsonb_typeof(c.pulse -> 'signalsByProfile') = 'object';

-- 2) Notification système « pouls hebdo » ────────────────────────────────────
-- Le push hebdomadaire n'a plus de contenu à annoncer.
UPDATE public.app_config
SET system_notifications = system_notifications - 'pulse_weekly'
WHERE id = 'default'
  AND system_notifications ? 'pulse_weekly';

-- 3) Historique ──────────────────────────────────────────────────────────────
-- Les bilans HEBDO archivés ne seront plus jamais relus (le seul lecteur restant cherche
-- l'évolution du patrimoine à 3 mois, sur les bilans MENSUELS).
DELETE FROM public.pulse_snapshots WHERE period_kind = 'week';

-- Dernière période vue : la clé 'week' n'a plus de sens (le 'month' reste indispensable).
UPDATE public.profiles
SET pulse_state = pulse_state - 'week'
WHERE pulse_state ? 'week';

-- 4) Succès « mois au vert » ─────────────────────────────────────────────────
-- Ils récompensaient un état des lieux « tout au vert » : il n'y a plus de vert.
-- Les lignes débloquées sont retirées de l'inventaire des utilisateurs, et les définitions
-- éventuellement stockées dans la config admin de gamification sont nettoyées.
DELETE FROM public.user_badges
WHERE badge_key IN ('point_vert_1', 'point_vert_3', 'point_vert_12');

UPDATE public.app_config AS c
SET gamification = jsonb_set(
  c.gamification,
  '{badges}',
  COALESCE(
    (
      SELECT jsonb_agg(b.value ORDER BY b.ord)
      FROM jsonb_array_elements(c.gamification -> 'badges') WITH ORDINALITY AS b(value, ord)
      WHERE b.value ->> 'metric' IS DISTINCT FROM 'pulse_green_months'
    ),
    '[]'::jsonb
  )
)
WHERE c.id = 'default'
  AND jsonb_typeof(c.gamification -> 'badges') = 'array';
