-- Migration 051 : Premium (entitlement) + config publicités
--
-- is_premium : droit Premium de l'utilisateur (alimenté plus tard par l'intégration de
-- paiement type RevenueCat/Stripe ; modifiable manuellement pour les tests).
-- app_config.ads : config des bannières « maison » (zones de pub activables).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS ads JSONB;
