-- ============================================================================
-- 125 — Conseils IA : crédits d'achat en TEMPS RÉEL.
-- Le webhook RevenueCat insère le crédit dans `ai_extra_credits` de façon asynchrone (parfois
-- quelques secondes après l'achat, voire plusieurs tentatives en sandbox). Sans realtime, l'app
-- ne relit le quota que dans les ~15 s suivant l'achat → un crédit tardif n'apparaît jamais tant
-- que l'écran reste ouvert. On ajoute la table à la publication realtime pour que le compteur se
-- mette à jour dès l'insertion (cf. hook `useAiExtraCreditsRealtime`).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_extra_credits'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_extra_credits;
  END IF;
EXCEPTION WHEN undefined_object THEN NULL; -- publication absente (setup minimal) → on ignore
END $$;

NOTIFY pgrst, 'reload schema';
