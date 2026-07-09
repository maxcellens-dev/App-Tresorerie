-- ============================================================================
-- 136 — SEO Center : configuration complète du référencement (app_config.seo).
-- Objet unique édité en admin (SEO Center) et appliqué au <head> côté web (composant SeoHead).
-- Couvre : général, robots, Open Graph, Twitter/X, réseaux (sameAs), vérification, organisation
-- (JSON-LD) et surcharges par page.
-- ============================================================================

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS seo jsonb NOT NULL DEFAULT '{
    "siteName": "Relyka",
    "titleDefault": "Relyka — Pilote ta trésorerie personnelle",
    "titleTemplate": "%s · Relyka",
    "description": "Relyka t''aide à piloter ta trésorerie au quotidien : reste à vivre, projections, épargne et investissement, en toute sérénité.",
    "keywords": "trésorerie, budget, finances personnelles, épargne, investissement, reste à vivre",
    "canonicalBase": "https://relyka.app",
    "language": "fr",
    "author": "Relyka",
    "themeColor": "#0D2E2A",
    "index": true,
    "follow": true,
    "ogType": "website",
    "ogImage": "",
    "ogImageAlt": "Relyka — pilote ta trésorerie",
    "twitterCard": "summary_large_image",
    "twitterSite": "",
    "twitterCreator": "",
    "social": {"twitter": "", "facebook": "", "instagram": "", "linkedin": "", "youtube": ""},
    "verifyGoogle": "",
    "verifyBing": "",
    "orgName": "Relyka",
    "orgLogo": "",
    "pages": {}
  }'::jsonb;

NOTIFY pgrst, 'reload schema';
