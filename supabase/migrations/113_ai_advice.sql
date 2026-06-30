-- ============================================================================
-- 113 — Conseils IA (Lot A1) : schéma + prompts admin + quota + historique + tickets.
-- L'appel au modèle se fait dans une Edge Function (la clé API n'est JAMAIS côté client). Ici : la
-- config éditable par l'admin, les prompts, l'historique de chat, le décompte des requêtes, les tickets.
-- ============================================================================

-- 1) Configuration (singleton, admin) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_config (
  id text PRIMARY KEY DEFAULT 'default',
  -- Liste ORDONNÉE des modèles (bascule auto dans cet ordre). [{ id, label, enabled }]
  models jsonb NOT NULL DEFAULT '[
    {"id":"gemini-2.0-flash","label":"Gemini 2.0 Flash","enabled":true},
    {"id":"gemini-2.0-flash-lite","label":"Gemini 2.0 Flash-Lite","enabled":true},
    {"id":"gemini-1.5-flash","label":"Gemini 1.5 Flash","enabled":true},
    {"id":"gemini-1.5-pro","label":"Gemini 1.5 Pro","enabled":true}
  ]'::jsonb,
  free_monthly_limit integer NOT NULL DEFAULT 1,     -- requêtes/mois user gratuit
  premium_monthly_limit integer NOT NULL DEFAULT 10, -- requêtes/mois Premium
  daily_global_cap integer NOT NULL DEFAULT 200,     -- garde-fou quota gratuit Gemini (tous users/jour)
  open_to_all boolean NOT NULL DEFAULT false,        -- ouvrir la fonctionnalité à tous (phase découverte)
  pay_to_use_enabled boolean NOT NULL DEFAULT false, -- ANTICIPÉ, non activé
  pay_to_use_price_cents integer NOT NULL DEFAULT 0,
  consent_text text NOT NULL DEFAULT 'Pour te conseiller, un résumé ANONYMISÉ de tes finances (montants et catégories, sans nom ni libellé) est envoyé à un service d''IA tiers. En continuant, tu acceptes ce traitement.',
  predefined_questions jsonb NOT NULL DEFAULT '[
    "Comment réduire mes dépenses ce mois-ci ?",
    "Combien puis-je épargner sans risque ?",
    "Mes abonnements sont-ils trop élevés ?",
    "Comment financer mon prochain projet ?",
    "Ai-je une marge de sécurité suffisante ?"
  ]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ai_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_config_read ON public.ai_config;
DROP POLICY IF EXISTS ai_config_write ON public.ai_config;
CREATE POLICY ai_config_read ON public.ai_config FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY ai_config_write ON public.ai_config FOR ALL USING (is_app_admin()) WITH CHECK (is_app_admin());

-- 2) Prompts (analyses structurées + system du chat), éditables par l'admin ---
CREATE TABLE IF NOT EXISTS public.ai_prompts (
  key text PRIMARY KEY,
  title text NOT NULL,
  prompt_template text NOT NULL,       -- contient {{SNAPSHOT}} (et {{QUESTION}} pour le chat)
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_prompts_read ON public.ai_prompts;
DROP POLICY IF EXISTS ai_prompts_write ON public.ai_prompts;
CREATE POLICY ai_prompts_read ON public.ai_prompts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY ai_prompts_write ON public.ai_prompts FOR ALL USING (is_app_admin()) WITH CHECK (is_app_admin());

INSERT INTO public.ai_prompts (key, title, prompt_template, sort_order) VALUES
('analysis_expenses', 'Analyse de mes dépenses',
 E'Tu es un conseiller financier personnel bienveillant et concret, en français, qui tutoie l''utilisateur. Voici un instantané ANONYMISÉ de ses finances :\n\n{{SNAPSHOT}}\n\nAnalyse ses DÉPENSES : répartition fixe/variable, par catégorie, postes les plus lourds, tendances et anomalies. Donne 3 à 5 pistes d''optimisation concrètes et chiffrées. Texte clair (titres + listes), 250-400 mots, sans jargon. Base-toi UNIQUEMENT sur l''instantané, ne réclame pas d''autres données.', 0),
('analysis_global', 'Bilan global (santé financière)',
 E'Tu es un conseiller financier personnel bienveillant, en français, tutoiement. Instantané ANONYMISÉ :\n\n{{SNAPSHOT}}\n\nFais un BILAN GLOBAL : liquidités, taux d''épargne, marge de sécurité, endettement (crédits), trajectoire de patrimoine. Identifie forces et risques, donne un « score » sur 100 et les 3 priorités. Texte structuré, 250-400 mots. Base-toi UNIQUEMENT sur l''instantané.', 1),
('analysis_reco', 'Recommandations personnalisées',
 E'Tu es un conseiller financier personnel, en français, tutoiement. Instantané ANONYMISÉ :\n\n{{SNAPSHOT}}\n\nDonne des RECOMMANDATIONS personnalisées : combien épargner / investir / conserver chaque mois selon sa situation et sa projection, comment financer ses projets, et un plan d''action en étapes. Sois concret et chiffré. Texte structuré, 250-400 mots. Base-toi UNIQUEMENT sur l''instantané.', 2),
('chat_system', 'Chat — instruction système',
 E'Tu es le conseiller financier personnel de l''utilisateur dans l''app Relyka, en français, tutoiement, bienveillant et concret. Voici un instantané ANONYMISÉ de ses finances :\n\n{{SNAPSHOT}}\n\nRéponds à sa question en t''appuyant sur ces données. Si l''info manque, dis-le simplement. Reste synthétique et actionnable.\n\nQuestion : {{QUESTION}}', 3)
ON CONFLICT (key) DO NOTHING;

-- 3) Historique de chat (un fil par user) ------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','admin')),
  content text NOT NULL,
  model text,              -- modèle ayant répondu (assistant)
  kind text,               -- 'analysis' | 'chat' (message user)
  analysis_key text,       -- clé de l'analyse (si analyse)
  counted boolean NOT NULL DEFAULT false,  -- décompté du quota (succès, non-admin)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_messages_profile ON public.ai_messages(profile_id, created_at);
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_messages_select ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_delete ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_insert ON public.ai_messages;
-- Lecture : ses messages (ou admin). Suppression : ses messages (purge d'historique) ou admin.
CREATE POLICY ai_messages_select ON public.ai_messages FOR SELECT USING (profile_id = auth.uid() OR is_app_admin());
CREATE POLICY ai_messages_delete ON public.ai_messages FOR DELETE USING (profile_id = auth.uid() OR is_app_admin());
-- Insertion directe réservée à l'admin (réponse manuelle). Les messages user/assistant passent par
-- l'Edge Function (service role) qui applique le quota.
CREATE POLICY ai_messages_insert ON public.ai_messages FOR INSERT WITH CHECK (is_app_admin());

-- 4) Tickets d'assistance (échec d'une requête → relance admin) ---------------
CREATE TABLE IF NOT EXISTS public.ai_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_message_id uuid REFERENCES public.ai_messages(id) ON DELETE SET NULL,
  request jsonb,           -- de quoi relancer (kind, analysis_key, question)
  error text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_tickets_status ON public.ai_tickets(status, created_at);
ALTER TABLE public.ai_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_tickets_admin ON public.ai_tickets;
CREATE POLICY ai_tickets_admin ON public.ai_tickets FOR ALL USING (is_app_admin()) WITH CHECK (is_app_admin());

-- 5) Quota : requêtes décomptées du mois courant + limite effective ----------
CREATE OR REPLACE FUNCTION public.ai_my_quota(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eff uuid; used int; lim int; prem boolean; cfg public.ai_config;
BEGIN
  eff := CASE WHEN public.is_app_admin() THEN COALESCE(p_user, auth.uid()) ELSE auth.uid() END;
  SELECT * INTO cfg FROM public.ai_config WHERE id = 'default';
  SELECT COALESCE(is_premium, false) INTO prem FROM public.profiles WHERE id = eff;
  SELECT count(*) INTO used FROM public.ai_messages
    WHERE profile_id = eff AND role = 'user' AND counted = true
      AND created_at >= date_trunc('month', now());
  lim := CASE WHEN prem THEN cfg.premium_monthly_limit ELSE cfg.free_monthly_limit END;
  RETURN jsonb_build_object('used', used, 'limit', lim, 'remaining', GREATEST(0, lim - used), 'is_premium', prem);
END; $$;
GRANT EXECUTE ON FUNCTION public.ai_my_quota(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
