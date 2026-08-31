-- ============================================================================
-- 218 — BUDGETS : suppression du budget GLOBAL.
--
-- POURQUOI (produit)
-- ──────────────────
-- « Un budget global de 1 200 € » ne dit rien d'actionnable. Au moment de faire ses courses,
-- personne ne raisonne sur une enveloppe totale : on se demande « combien il me reste pour
-- l'alimentation ». Et Relyka SAIT déjà répondre à la question du total — c'est l'enveloppe
-- variable (`variable_envelope_initial`), qui a l'avantage d'être calculée sur les dépenses réelles
-- au lieu d'être devinée. Le budget global doublonnait donc une information existante et meilleure.
--
-- POURQUOI (technique) — et c'est le point qui a fait échouer les enregistrements
-- ──────────────────────────────────────────────────────────────────────────────
-- La migration 217 portait DEUX index uniques PARTIELS (l'un `WHERE category_id IS NOT NULL`,
-- l'autre `WHERE category_id IS NULL`), parce que plusieurs NULL ne se contredisent pas en SQL.
-- Mais `INSERT ... ON CONFLICT (colonnes)` ne peut PAS viser un index partiel : Postgres exige que
-- le prédicat soit répété dans la clause, et PostgREST n'a aucun moyen de l'envoyer. Tout upsert
-- répondait donc « there is no unique or exclusion constraint matching the ON CONFLICT
-- specification » — d'où le « Changement non enregistré » à chaque « Terminer ».
--
-- En rendant `category_id` obligatoire, un index unique ORDINAIRE redevient possible, et l'upsert
-- fonctionne. La décision produit et la correction technique vont dans le même sens.
-- ============================================================================

-- Les budgets globaux existants n'ont plus de sens ni de place : on les retire.
DELETE FROM public.budgets WHERE category_id IS NULL;

DROP INDEX IF EXISTS public.budgets_cat_uniq;
DROP INDEX IF EXISTS public.budgets_global_uniq;

ALTER TABLE public.budgets ALTER COLUMN category_id SET NOT NULL;

-- Index unique ORDINAIRE : plus aucune colonne nullable dedans, donc `ON CONFLICT` peut le viser.
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_scope_uniq;
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_scope_uniq UNIQUE (profile_id, period, period_key, category_id);

COMMENT ON COLUMN public.budgets.category_id IS
  'Catégorie budgétée — n''importe quel niveau (grande catégorie ou sous-catégorie). Obligatoire : il n''y a plus de budget global (cf. migration 218).';

NOTIFY pgrst, 'reload schema';
