-- ============================================================================
-- 111 — Crédit : stockage des PALIERS tels quels (mensualité & assurance), pour les restituer
-- exactement (sinon on les reconstruit depuis les montants annuels et des paliers de même valeur
-- fusionnent → on perdait des paliers).
-- payment_paliers  : [{ startYear, payment }]   (payment vide = auto-calculé)
-- insurance_paliers: [{ startYear, amount }]
-- ============================================================================
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS payment_paliers jsonb;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS insurance_paliers jsonb;

-- Recharge le cache de schéma PostgREST (sinon « column not found in schema cache » côté API).
NOTIFY pgrst, 'reload schema';
