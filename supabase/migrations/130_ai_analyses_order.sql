-- ============================================================================
-- 130 — Conseils IA : ordre des analyses prédéfinies dans l'écran.
-- « Bilan global (santé financière) » en 1ᵉʳ (entrée la plus naturelle : le user veut d'abord une
-- vue d'ensemble), puis « Analyse de mes dépenses », puis « Recommandations personnalisées ».
-- L'écran liste les analyses par `sort_order` (hooks/useAiPrompts) → il suffit de le réordonner.
-- ============================================================================

UPDATE public.ai_prompts SET sort_order = 0 WHERE key = 'analysis_global';
UPDATE public.ai_prompts SET sort_order = 1 WHERE key = 'analysis_expenses';
UPDATE public.ai_prompts SET sort_order = 2 WHERE key = 'analysis_reco';

NOTIFY pgrst, 'reload schema';
