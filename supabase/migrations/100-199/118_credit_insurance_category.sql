-- ============================================================================
-- 118 — Crédits : catégorie de dépense CHOISIE pour l'ASSURANCE (défaut « Assurance Crédit »).
-- NULL → repli sur « Assurance Crédit ».
-- ============================================================================
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS insurance_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
