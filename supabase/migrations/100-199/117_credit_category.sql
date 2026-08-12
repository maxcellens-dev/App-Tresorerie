-- ============================================================================
-- 117 — Crédits : catégorie de dépense CHOISIE pour la mensualité (remboursement).
-- Le flux de mensualité (pilotage/tréso/projection/suivi + modaux) utilise cette catégorie au lieu du
-- « Crédits » par défaut. NULL → repli sur la catégorie par défaut « Crédits ».
-- ============================================================================
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
