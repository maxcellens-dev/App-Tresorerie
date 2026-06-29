-- ============================================================================
-- 107 — Crédit : intérêts saisis MANUELLEMENT (bypass du calcul par le taux).
-- Si renseigné, ce montant remplace les intérêts calculés dans la décomposition des coûts.
-- ============================================================================
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS interest_total_manual numeric;
