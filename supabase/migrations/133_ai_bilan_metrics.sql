-- ============================================================================
-- 133 — Conseils IA : ÉVOLUTION inter-bilans.
-- Persiste UNE poignée de métriques top-line (~8 nombres) à chaque bilan global généré, pour que
-- l'IA puisse dire « voici où tu en es vs le dernier bilan » (la question implicite n°1 du user).
-- Volume négligeable : 1 ligne ~300 o par bilan → 500 users × 12/an ≈ 2 Mo/an.
-- Le SNAPSHOT complet n'est JAMAIS stocké (regénéré à chaque fois) ; seuls ces agrégats le sont.
--
-- Insert CÔTÉ CLIENT (avec le JWT du user) après un bilan réussi : pas besoin de toucher l'Edge
-- Function. RLS : chacun n'écrit/lit que ses propres lignes (+ admin en lecture pour le snapshot admin).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_bilan_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metrics jsonb NOT NULL,   -- { patrimoine, checking, savings, invested, engaged, balance12, income, score }
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_bilan_metrics_profile ON public.ai_bilan_metrics(profile_id, created_at DESC);

ALTER TABLE public.ai_bilan_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_bilan_metrics_select ON public.ai_bilan_metrics;
DROP POLICY IF EXISTS ai_bilan_metrics_insert ON public.ai_bilan_metrics;
DROP POLICY IF EXISTS ai_bilan_metrics_delete ON public.ai_bilan_metrics;
CREATE POLICY ai_bilan_metrics_select ON public.ai_bilan_metrics FOR SELECT USING (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY ai_bilan_metrics_insert ON public.ai_bilan_metrics FOR INSERT WITH CHECK (profile_id = auth.uid());
CREATE POLICY ai_bilan_metrics_delete ON public.ai_bilan_metrics FOR DELETE USING (profile_id = auth.uid() OR is_app_admin());

NOTIFY pgrst, 'reload schema';
