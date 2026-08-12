-- Migration 079 : « bilan mensuel » du profil financier.
-- Permet d'émettre un message chaque mois MÊME quand le profil ne change pas
-- (après la période de gel), pour informer l'utilisateur qu'il reste dans le même profil.
--
-- On étend deux contraintes CHECK :
--  • profile_change_log.change_reason → ajoute 'monthly_recap'
--  • profile_notification_messages.direction → ajoute 'same'

ALTER TABLE public.profile_change_log
  DROP CONSTRAINT IF EXISTS profile_change_log_change_reason_check;
ALTER TABLE public.profile_change_log
  ADD CONSTRAINT profile_change_log_change_reason_check
  CHECK (change_reason IN (
    'questionnaire_update','automatic_upgrade',
    'automatic_downgrade','exceptional_revenue_drop','monthly_recap'
  ));

ALTER TABLE public.profile_notification_messages
  DROP CONSTRAINT IF EXISTS profile_notification_messages_direction_check;
ALTER TABLE public.profile_notification_messages
  ADD CONSTRAINT profile_notification_messages_direction_check
  CHECK (direction IN ('upgrade','downgrade','exceptional','same'));
