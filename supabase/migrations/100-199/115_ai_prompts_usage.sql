-- ============================================================================
-- 115 — Conseils IA :
--   (A) Registre d'usage NON supprimable → le quota mensuel ne se « recharge » plus quand l'utilisateur
--       efface son historique de chat (le décompte ne lit plus ai_messages, qui est effaçable).
--   (B) Prompts améliorés : réponses moins génériques, respect des TYPES de mouvements (dépenses
--       fixes/variables, virements épargne vs investissement), du % d'impact des crédits, du contexte
--       temporel (jour du mois) et de l'ancienneté des projets. Pas de récap de situation pour la reco.
-- ============================================================================

-- (A) Registre d'usage --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text,                       -- 'analysis' | 'chat'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_profile_month ON public.ai_usage(profile_id, created_at);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_select ON public.ai_usage;
-- Lecture seule (soi/admin). Écriture réservée à l'Edge Function (service role) → pas de policy insert/delete.
CREATE POLICY ai_usage_select ON public.ai_usage FOR SELECT USING (profile_id = auth.uid() OR is_app_admin());

-- Reprise de l'existant : on sème le registre à partir des requêtes déjà décomptées (idempotent).
INSERT INTO public.ai_usage (profile_id, kind, created_at)
SELECT profile_id, kind, created_at FROM public.ai_messages
WHERE role = 'user' AND counted = true
  AND NOT EXISTS (SELECT 1 FROM public.ai_usage u WHERE u.profile_id = ai_messages.profile_id AND u.created_at = ai_messages.created_at);

-- Le quota lit désormais le REGISTRE (non effaçable), toujours par MOIS calendaire.
CREATE OR REPLACE FUNCTION public.ai_my_quota(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; used int; lim int; prem boolean; cfg public.ai_config;
BEGIN
  eff := CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
  SELECT * INTO cfg FROM public.ai_config WHERE id = 'default';
  SELECT COALESCE(is_premium, false) INTO prem FROM public.profiles WHERE id = eff;
  SELECT count(*) INTO used FROM public.ai_usage
    WHERE profile_id = eff AND created_at >= date_trunc('month', now());
  lim := CASE WHEN prem THEN cfg.premium_monthly_limit ELSE cfg.free_monthly_limit END;
  RETURN jsonb_build_object('used', used, 'limit', lim, 'remaining', GREATEST(0, lim - used), 'is_premium', prem);
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_my_quota(uuid) TO authenticated;

-- (B) Prompts améliorés -------------------------------------------------------
UPDATE public.ai_prompts SET prompt_template =
E'Tu es un conseiller financier personnel bienveillant et concret (français, tutoiement). Voici un instantané ANONYMISÉ de ses finances, STRUCTURÉ PAR TYPE de mouvement :\n\n{{SNAPSHOT}}\n\nAnalyse UNIQUEMENT ses DÉPENSES. Règles STRICTES :\n- Distingue dépenses FIXES (engagements récurrents) et VARIABLES.\n- Les VIREMENTS INTERNES (vers épargne / investissement) NE sont PAS des dépenses : ne les compte jamais comme telles.\n- CONTEXTE TEMPOREL : les montants « du mois » sont partiels (regarde le jour du mois indiqué). En début de mois, peu de dépenses passées est NORMAL — raisonne en rythme mensuel, pas sur le partiel.\nDonne 3 à 5 pistes d''optimisation concrètes et CHIFFRÉES, ciblées sur les postes réellement lourds. 200-350 mots, titres + listes, sans jargon. Base-toi UNIQUEMENT sur l''instantané.'
WHERE key = 'analysis_expenses';

UPDATE public.ai_prompts SET prompt_template =
E'Tu es un conseiller financier personnel bienveillant (français, tutoiement). Instantané ANONYMISÉ, structuré par type :\n\n{{SNAPSHOT}}\n\nFais un BILAN GLOBAL : liquidités, taux d''épargne, marge de sécurité, endettement, trajectoire de patrimoine. Règles STRICTES :\n- Les virements vers épargne/investissement sont des MISES DE CÔTÉ (positif), pas des dépenses.\n- Un crédit à IMPACT 0 % ne pèse PAS sur ses finances : IGNORE-le totalement.\n- Les montants « du mois » sont PARTIELS (voir le jour du mois) : n''en tire pas de tendance.\n- La progression d''un projet dépend de son ANCIENNETÉ : un projet récent à faible % est NORMAL.\nDonne un « score » sur 100 et les 3 priorités. Texte structuré, 200-350 mots. Base-toi UNIQUEMENT sur l''instantané.'
WHERE key = 'analysis_global';

UPDATE public.ai_prompts SET prompt_template =
E'Tu es un conseiller financier personnel (français, tutoiement). Instantané ANONYMISÉ, structuré par type :\n\n{{SNAPSHOT}}\n\nDonne des RECOMMANDATIONS personnalisées. IMPORTANT : COMMENCE DIRECTEMENT par les recommandations — NE fais AUCUN récapitulatif de sa situation (il connaît déjà ses chiffres), pas d''introduction descriptive.\nRègles STRICTES : distingue épargne / investissement / dépenses ; IGNORE les crédits à impact 0 % ; tiens compte de l''ancienneté et du rythme des projets pour conseiller leur financement ; les montants du mois sont partiels.\nDis concrètement combien épargner / investir / conserver chaque mois, comment financer les projets, et un plan d''action en étapes chiffrées. 200-350 mots, structuré. Base-toi UNIQUEMENT sur l''instantané.'
WHERE key = 'analysis_reco';

UPDATE public.ai_prompts SET prompt_template =
E'Tu es le conseiller financier personnel de l''utilisateur dans l''app Relyka (français, tutoiement, bienveillant et concret). Instantané ANONYMISÉ, structuré par type :\n\n{{SNAPSHOT}}\n\nRéponds à sa question en respectant les TYPES : les virements internes (épargne/investissement) ne sont pas des dépenses ; un crédit à impact 0 % est à ignorer ; les montants du mois sont PARTIELS (jour du mois indiqué) ; un projet récent à faible % est normal. Si une info manque, dis-le simplement. Reste synthétique et actionnable.\n\nQuestion : {{QUESTION}}'
WHERE key = 'chat_system';

NOTIFY pgrst, 'reload schema';
