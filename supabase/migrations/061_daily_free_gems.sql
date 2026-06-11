-- Boutique : achat gratuit quotidien (5 gemmes, 1×/jour).
-- On mémorise le dernier jour de réclamation pour limiter à une fois par jour.
ALTER TABLE public.user_gamification
  ADD COLUMN IF NOT EXISTS last_free_gems_day DATE;
