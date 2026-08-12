-- ============================================================================
-- 108 — Crédit : overrides MANUELS du tableau d'amortissement, par échéance.
-- JSON { "<n° échéance>": { "p": mensualité_hors_assurance, "i": assurance } }.
-- Une valeur présente force ce montant pour cette échéance (le CRD se recalcule à partir de là).
-- ============================================================================
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS schedule_overrides jsonb;

-- Recharge le cache de schéma PostgREST (sinon « column not found in schema cache » côté API).
NOTIFY pgrst, 'reload schema';
