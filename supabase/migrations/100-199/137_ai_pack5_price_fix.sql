-- ============================================================================
-- 137 — Conseils IA : correction du prix du pack 5 requêtes (0,99 € et non 1,99 €).
--
-- La migration 123 écrivait `"price_cents":099` — JSON INVALIDE (zéro en tête) → l'UPDATE échouait
-- silencieusement, laissant le prix par défaut de la 122 (199 = 1,99 €). On force ici la valeur
-- correcte (idempotent) sur la ligne existante. La 123 a aussi été corrigée pour les nouvelles bases.
-- ============================================================================
UPDATE public.ai_config
SET extra_credit_packs = '[
  {"id":"pack_5","credits":5,"price_cents":99,"product_id":"ai_credits_5"},
  {"id":"pack_25","credits":25,"price_cents":399,"product_id":"ai_credits_25"},
  {"id":"pack_100","credits":100,"price_cents":1199,"product_id":"ai_credits_100"}
]'::jsonb
WHERE id = 'default';

NOTIFY pgrst, 'reload schema';
