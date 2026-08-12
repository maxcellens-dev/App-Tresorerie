-- Migration 054 : Page d'accueil « bureau » (landing marketing web), éditable en admin.
--
-- Tout le contenu (textes, images, fonctionnalités, stats, pied de page) vit dans
-- app_config.landing (JSONB), édité via l'écran admin « Page d'accueil ».
-- Les images sont téléversées dans le bucket public « gamification » (préfixe landing/).

ALTER TABLE app_config ADD COLUMN IF NOT EXISTS landing JSONB;
