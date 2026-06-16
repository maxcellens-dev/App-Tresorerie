-- Premium « manuel » : accordé par un admin et NON rattaché à un abonnement payant.
-- Quand premium_manual = true, la synchro RevenueCat (côté app) ne RETIRE pas le Premium.
-- Les abonnés normaux ont premium_manual = false → résilier retire bien le Premium.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS premium_manual boolean NOT NULL DEFAULT false;
