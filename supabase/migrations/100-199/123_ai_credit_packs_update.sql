-- ============================================================================
-- 123 — Conseils IA : mise à jour des offres de recharge (packs click-to-pay).
-- Nouveaux paliers : 5 requêtes (0,99 €), 25 (3,99 €), 100 (11,99 €).
-- product_id = identifiants à créer dans RevenueCat / App Store / Google Play.
-- On force la valeur sur la ligne existante (la migration 122 ne s'applique qu'aux nouvelles bases).
-- ============================================================================
UPDATE public.ai_config
SET extra_credit_packs = '[
  {"id":"pack_5","credits":5,"price_cents":99,"product_id":"ai_credits_5"},
  {"id":"pack_25","credits":25,"price_cents":399,"product_id":"ai_credits_25"},
  {"id":"pack_100","credits":100,"price_cents":1199,"product_id":"ai_credits_100"}
]'::jsonb
WHERE id = 'default';

NOTIFY pgrst, 'reload schema';
