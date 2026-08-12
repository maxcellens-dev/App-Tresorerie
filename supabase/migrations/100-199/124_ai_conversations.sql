-- ============================================================================
-- 124 — Conseils IA : CONVERSATIONS séparées (comme ChatGPT/Claude).
-- Au lieu d'un fil unique interminable, chaque échange appartient à une conversation avec son
-- propre historique + titre. L'utilisateur peut en créer, basculer, renommer, supprimer.
-- ============================================================================

-- 1) Table des conversations ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nouvelle conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_profile ON public.ai_conversations(profile_id, updated_at DESC);
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_conversations_rw ON public.ai_conversations;
-- L'utilisateur gère SES conversations ; l'admin peut lire (consultation).
CREATE POLICY ai_conversations_rw ON public.ai_conversations
  FOR ALL USING (profile_id = auth.uid() OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR is_app_admin());

-- 2) Rattacher chaque message à une conversation ----------------------------
ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ai_messages_conversation ON public.ai_messages(conversation_id, created_at);

-- 3) Lien conversation ↔ ticket (l'admin relance/répond dans la bonne conversation) ----
ALTER TABLE public.ai_tickets
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL;

-- 4) Reprise de l'existant : on regroupe l'historique de chaque user dans UNE conversation.
DO $$
DECLARE r record; conv uuid;
BEGIN
  FOR r IN SELECT DISTINCT profile_id FROM public.ai_messages WHERE conversation_id IS NULL LOOP
    INSERT INTO public.ai_conversations (profile_id, title, created_at, updated_at)
    VALUES (r.profile_id, 'Mes conseils', now(), now())
    RETURNING id INTO conv;
    UPDATE public.ai_messages SET conversation_id = conv WHERE profile_id = r.profile_id AND conversation_id IS NULL;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
