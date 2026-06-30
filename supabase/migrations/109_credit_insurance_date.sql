-- ============================================================================
-- 109 — Crédit : date de 1ʳᵉ échéance d'ASSURANCE distincte du remboursement.
-- Le prélèvement de l'assurance peut tomber à une date différente de la mensualité de remboursement.
-- NULL → on utilise la date de 1ʳᵉ échéance du remboursement (first_payment_date).
-- ============================================================================
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS first_insurance_date date;

-- Recharge le cache de schéma PostgREST (sinon « column not found in schema cache » côté API).
NOTIFY pgrst, 'reload schema';
