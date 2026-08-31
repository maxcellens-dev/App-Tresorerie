-- ============================================================================
-- 217 — BUDGETS : ce que l'utilisateur DÉCIDE de dépenser.
--
-- POURQUOI
-- ────────
-- Relyka sait déjà ce que l'utilisateur VA dépenser : c'est l'enveloppe variable
-- (`variable_envelope_initial`), une PRÉVISION calculée depuis l'historique ou le questionnaire.
-- Elle irrigue le Relyka, le point bas, la projection et le profil.
--
-- Le budget répond à une autre question : « combien je veux m'autoriser ». C'est une INTENTION,
-- pas une prévision. Les deux doivent coexister sans jamais se remplacer l'une l'autre : quelqu'un
-- qui dépense 1 040 €/mois d'habitude et se fixe 900 € doit voir les DEUX chiffres.
--
-- CE QUE CETTE TABLE NE FAIT PAS, ET C'EST L'ESSENTIEL
-- ───────────────────────────────────────────────────
-- Le budget n'entre dans AUCUN calcul de trésorerie. Ni le Relyka, ni le point bas, ni le garde-fou
-- de projection, ni la répartition des recommandations, ni le profil financier, ni la fiabilité.
-- C'est une couche de LECTURE posée sur des transactions déjà calculées : le « dépensé » d'un
-- budget est celui de `lib/finance/variableSpend`, exactement le même que celui du Pilotage.
-- Conséquence testable, et testée : supprimer tous les budgets d'un profil ne change AUCUN chiffre
-- de l'app (cf. __tests__/budgetEngine.test.ts).
--
-- POURQUOI PAS DE COLONNE `scope`
-- ───────────────────────────────
-- Une sous-catégorie EST une catégorie, avec un `parent_id` non nul. Un enum
-- 'global'|'category'|'subcategory' créerait une seconde source de vérité sur la hiérarchie, qui
-- divergerait le jour où l'utilisateur déplace une catégorie. Ici : `category_id IS NULL` = budget
-- global, et le niveau se déduit de la catégorie elle-même. Trois niveaux, deux cas dans le schéma.
--
-- MENSUEL ET ANNUEL : DEUX FENÊTRES, JAMAIS UNE DIVISION
-- ──────────────────────────────────────────────────────
-- Un budget annuel ne vaut pas un mensuel × 12, et surtout il ne se divise PAS par 12 pour
-- s'afficher dans le mois. Il existe pour les postes qui ne tombent pas tous les mois (vacances,
-- cadeaux, entretien) : les découper en douzièmes fabriquerait un budget mensuel faux, dépassé onze
-- mois sur douze. Les deux cadences cohabitent, chacune avec sa fenêtre de lecture, et ne
-- s'additionnent jamais entre elles.
--
-- REPORT IMPLICITE (pas de colonne, c'est une règle de LECTURE)
-- ────────────────────────────────────────────────────────────
-- Le budget effectif d'une période P est la ligne de P si elle existe, sinon la plus récente ligne
-- <= P de MÊME cadence et de même périmètre. Écrire crée toujours une ligne datée de la période
-- affichée : modifier octobre n'altère donc jamais septembre. L'écran affiche « Repris d'août »
-- quand la valeur est héritée — un chiffre hérité qui ne s'annonce pas est un chiffre qu'on croit
-- avoir saisi. Supprimer un budget = poser une ligne à 0, sinon la lecture ressusciterait celle du
-- mois précédent (cf. hooks/data/useBudgets → deleteBudget).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.budgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period       text NOT NULL,
  period_key   text NOT NULL,
  category_id  uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  amount       numeric(14,2) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Cadence : deux valeurs seulement. Une troisième ferait retomber le client sur un affichage par
-- défaut sans le dire — exactement le genre de silence qu'on ne veut pas sur un réglage visible.
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_period_check;
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_period_check CHECK (period IN ('month', 'year'));

-- Cohérence clé/cadence : une ligne 'year' ne peut pas porter '2026-09', et inversement. Sans
-- cette contrainte, une clé mal formée passerait silencieusement et le budget deviendrait
-- introuvable à la lecture (le report irait chercher la période précédente à la place).
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_period_key_check;
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_period_key_check CHECK (
    (period = 'month' AND period_key ~ '^\d{4}-\d{2}$')
    OR (period = 'year' AND period_key ~ '^\d{4}$')
  );

-- Un budget est un plafond : jamais négatif. Zéro est VALIDE et signifie « pas de limite fixée »
-- (c'est aussi la trace d'une suppression, cf. le report implicite ci-dessus).
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_amount_check;
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_amount_check CHECK (amount >= 0);

-- Un seul budget par (profil, cadence, période, périmètre). DEUX index partiels, et pas un UNIQUE
-- ordinaire : en SQL, plusieurs NULL ne se contredisent pas — un index unique incluant
-- `category_id` laisserait donc passer autant de budgets globaux qu'on veut sur le même mois.
CREATE UNIQUE INDEX IF NOT EXISTS budgets_cat_uniq
  ON public.budgets (profile_id, period, period_key, category_id)
  WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS budgets_global_uniq
  ON public.budgets (profile_id, period, period_key)
  WHERE category_id IS NULL;

-- Lecture typique : « tous les budgets de ce profil <= cette période » (le report remonte le
-- temps). L'index couvre le filtre profil + le tri de période.
CREATE INDEX IF NOT EXISTS budgets_profile_period_idx
  ON public.budgets (profile_id, period, period_key DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- La branche DIRECTE `profile_id = auth.uid()` vient EN PREMIER : lors d'un INSERT ... RETURNING
-- (PostgREST .select()), la relecture de la ligne passe par la policy SELECT, et une fonction
-- STABLE/SECURITY DEFINER ne « voit » pas encore la ligne insérée → « new row violates row-level
-- security policy ». `is_app_admin()` est indispensable partout : sans elle, le mode admin
-- « connecté en tant que » renvoie 403 sur la moindre écriture.
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_select ON public.budgets;
DROP POLICY IF EXISTS budgets_insert ON public.budgets;
DROP POLICY IF EXISTS budgets_update ON public.budgets;
DROP POLICY IF EXISTS budgets_delete ON public.budgets;

CREATE POLICY budgets_select ON public.budgets FOR SELECT
  USING (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY budgets_insert ON public.budgets FOR INSERT
  WITH CHECK (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY budgets_update ON public.budgets FOR UPDATE
  USING (profile_id = auth.uid() OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY budgets_delete ON public.budgets FOR DELETE
  USING (profile_id = auth.uid() OR is_app_admin());

COMMENT ON TABLE public.budgets IS
  'Budgets déclarés par l''utilisateur (intention), à ne jamais confondre avec l''enveloppe variable (prévision). Couche de lecture : n''entre dans aucun calcul de trésorerie.';
COMMENT ON COLUMN public.budgets.period IS 'Cadence : month | year. Un annuel ne se divise jamais par 12.';
COMMENT ON COLUMN public.budgets.period_key IS 'YYYY-MM si period = month, YYYY si period = year.';
COMMENT ON COLUMN public.budgets.category_id IS 'NULL = budget global. Sinon n''importe quel niveau (catégorie ou sous-catégorie).';

NOTIFY pgrst, 'reload schema';
