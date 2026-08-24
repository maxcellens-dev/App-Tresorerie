-- ============================================================================
-- 207 — LES POURCENTAGES DE RÉPARTITION DEVIENNENT RÉGLABLES.
--
-- POURQUOI
-- ────────
-- La répartition du Relyka par palier (Épargner / Investir / Confort / Conserver) vivait UNIQUEMENT
-- dans le code (`PROFILE_ALLOCATIONS`). Toute la calibration de l'échelle — seuils, viabilité,
-- patrimoine — est réglable depuis l'administration ; les pourcentages, eux, exigeaient une
-- livraison. Or ce sont eux que l'utilisateur voit : ils décident de ce qu'on lui recommande de
-- faire de son argent, palier par palier.
--
-- CE QUI RESTE VRAI
-- ─────────────────
-- Ces pourcentages sont une BASE, pas un verdict : la priorité du mois les borne ensuite
-- (investissement à 0 % tant qu'il n'y a pas un mois de réserve…), puis les modificateurs
-- contextuels s'appliquent, puis on normalise à 100 %. Régler la base ne débranche aucun garde-fou.
--
-- LA SOMME DOIT FAIRE 100
-- ───────────────────────
-- Contrainte en base, et pas seulement à l'écran : une ligne qui ne fait pas 100 distribuerait un
-- Relyka faux à tout un palier — donc à toute une population — et ça ne se voit qu'à l'euro près,
-- sur un écran. Le code garde en outre ses valeurs de repli : une table vide, une lecture en échec
-- ou une ligne manquante laissent le moteur fonctionner exactement comme avant.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profile_allocations (
  profile_id     text PRIMARY KEY CHECK (profile_id IN ('P0','P1','P2','P3','P4','P5','P6','P7','P8','P9')),
  save_percent    integer NOT NULL CHECK (save_percent    BETWEEN 0 AND 100),
  invest_percent  integer NOT NULL CHECK (invest_percent  BETWEEN 0 AND 100),
  enjoy_percent   integer NOT NULL CHECK (enjoy_percent   BETWEEN 0 AND 100),
  keep_percent    integer NOT NULL CHECK (keep_percent    BETWEEN 0 AND 100),
  CONSTRAINT profile_allocations_sum_100
    CHECK (save_percent + invest_percent + enjoy_percent + keep_percent = 100),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.profile_allocations IS
  'Répartition de BASE du Relyka par palier (avant les bornes de la priorité du mois). Vide ⇒ le code applique PROFILE_ALLOCATIONS.';

-- ── Lecture pour tous, écriture pour les administrateurs ─────────────────────────────────────
-- Même forme que `profile_matrix_config` : la table est un RÉFÉRENTIEL, chaque client doit pouvoir
-- la lire pour calculer ses recommandations ; seule l'administration l'écrit.
ALTER TABLE public.profile_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_allocations_read_all" ON public.profile_allocations;
CREATE POLICY "profile_allocations_read_all" ON public.profile_allocations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profile_allocations_admin_write" ON public.profile_allocations;
CREATE POLICY "profile_allocations_admin_write" ON public.profile_allocations
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- ── Amorçage sur les valeurs du code ─────────────────────────────────────────────────────────
-- La table part à l'identique de `PROFILE_ALLOCATIONS` : brancher le réglage ne doit déplacer
-- personne. L'administration voit donc d'emblée les vraies valeurs, et non des cases vides.
INSERT INTO public.profile_allocations (profile_id, save_percent, invest_percent, enjoy_percent, keep_percent) VALUES
  ('P0', 25,  0, 20, 55),
  ('P1', 30,  0,  5, 65),
  ('P2', 55,  0, 10, 35),
  ('P3', 45,  5, 15, 35),
  ('P4', 30, 20, 20, 30),
  ('P5', 20, 30, 22, 28),
  ('P6', 12, 40, 25, 23),
  ('P7',  8, 47, 25, 20),
  ('P8',  5, 55, 25, 15),
  ('P9',  0, 62, 28, 10)
ON CONFLICT (profile_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT profile_id, save_percent, invest_percent, enjoy_percent, keep_percent,
--          save_percent + invest_percent + enjoy_percent + keep_percent AS total
--     FROM profile_allocations ORDER BY profile_id;   -- total = 100 partout
