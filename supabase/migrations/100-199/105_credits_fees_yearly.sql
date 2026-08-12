-- ============================================================================
-- 105 — Crédit : frais détaillés + montants ANNUELS (assurance & mensualité qui évoluent par an).
-- ============================================================================

-- Frais détaillés (en plus de fees_file/fees_guarantee de la migration 104).
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS fees_bank numeric DEFAULT 0;              -- frais de banque
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS fees_notary numeric DEFAULT 0;            -- frais de notaire
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS personal_contribution numeric DEFAULT 0;  -- apport personnel
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS interim_interest numeric DEFAULT 0;       -- intérêts intercalaires
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS management_fees numeric DEFAULT 0;        -- intérêts/frais de gestion
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS other_fees numeric DEFAULT 0;             -- autres frais

-- Montants ANNUELS éditables (tableaux JSON indexés par année : [an1, an2, …], montants MENSUELS).
-- insurance_yearly : assurance mensuelle pour chaque année (vide → flat insurance_monthly).
-- payment_yearly   : mensualité (capital+intérêts) forcée pour chaque année (vide/null → calcul standard).
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS insurance_yearly jsonb;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS payment_yearly jsonb;

-- Recharge le cache de schéma PostgREST (sinon « column not found in schema cache » côté API).
NOTIFY pgrst, 'reload schema';
