-- Migration 053 : Série de connexion quotidienne (succès « L'Assidu » : N jours consécutifs)
--
-- Suivi de la connexion jour par jour, distinct de la série hebdo de suivi (streak/best_streak).
-- Renseigné côté app à chaque ouverture (recordLogin).

ALTER TABLE user_gamification ADD COLUMN IF NOT EXISTS last_login_day   DATE;
ALTER TABLE user_gamification ADD COLUMN IF NOT EXISTS login_streak     INT NOT NULL DEFAULT 0;  -- jours consécutifs en cours
ALTER TABLE user_gamification ADD COLUMN IF NOT EXISTS best_login_streak INT NOT NULL DEFAULT 0; -- record de jours consécutifs
