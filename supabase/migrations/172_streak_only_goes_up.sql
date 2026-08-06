-- ============================================================================
-- 172 — LA SÉRIE NE FAIT QUE MONTER.
--
-- Décision produit : la flamme compte les semaines où l'utilisateur EST VENU, et ignore simplement
-- celles où il n'est pas venu. Elle ne retombe donc plus jamais à zéro — qu'il ait manqué une
-- semaine ou six mois, sa prochaine visite fait +1.
--
-- Conséquences, appliquées ici :
--  • plus d'alerte « ta série est en danger » (la modale de rachat est supprimée du code) ;
--  • plus de GELS de série ni de RÉCUPÉRATION de série : il n'y a plus rien à protéger ni à
--    racheter, ces articles quittent la boutique ;
--  • plus de « record » : `best_streak` vaut désormais toujours `streak`.
--
-- RATTRAPAGE. Les utilisateurs qui ont déjà PERDU leur série sous l'ancienne règle voient leur
-- compteur remonter à leur meilleur niveau : la nouvelle règle dit qu'ils n'auraient jamais dû le
-- perdre. C'est volontairement généreux — l'inverse (les laisser à 1) leur ferait payer une règle
-- qui n'existe plus.
--
-- Les colonnes `freezes` / `best_streak` RESTENT en base (avec leur DEFAULT) : elles ne sont plus
-- lues côté app, et les garder évite de casser une lecture oubliée.
-- ============================================================================

-- 1) Rattrapage des séries perdues + alignement du « record » ────────────────
UPDATE public.user_gamification
SET streak = GREATEST(streak, best_streak),
    best_streak = GREATEST(streak, best_streak),
    updated_at = now()
WHERE best_streak > streak;

-- Les autres : le record devient simplement le miroir de la série.
UPDATE public.user_gamification
SET best_streak = streak, updated_at = now()
WHERE best_streak <> streak;

-- 2) Boutique : retrait des articles liés aux gels / au rachat de série ──────
-- `mergeShop` (lib/gamification) les filtre déjà côté client ; on nettoie la config stockée pour
-- ne pas traîner un catalogue mort dans l'écran admin.
UPDATE public.app_config AS c
SET gamification = jsonb_set(
  c.gamification,
  '{shop}',
  COALESCE(
    (
      SELECT jsonb_agg(s.value ORDER BY s.ord)
      FROM jsonb_array_elements(c.gamification -> 'shop') WITH ORDINALITY AS s(value, ord)
      WHERE s.value ->> 'type' NOT IN ('freeze', 'streak_restore')
    ),
    '[]'::jsonb
  )
)
WHERE c.id = 'default'
  AND jsonb_typeof(c.gamification -> 'shop') = 'array';

-- 3) Réglage devenu sans objet : le coût d'un gel ────────────────────────────
UPDATE public.app_config
SET gamification = jsonb_set(
  gamification, '{streak}', (gamification -> 'streak') - 'freezeCost'
)
WHERE id = 'default'
  AND gamification -> 'streak' ? 'freezeCost';

-- 4) Gels détenus : sans objet, on remet le compteur à zéro ──────────────────
-- (La colonne reste, mais plus personne ne l'écrit ni ne la lit.)
UPDATE public.user_gamification SET freezes = 0 WHERE freezes <> 0;
