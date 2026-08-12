-- ============================================================================
-- 165 — E-mails : préférences utilisateur + campagnes admin (ponctuelles ou programmées).
--
-- L'app envoyait déjà des notifications PUSH ; l'e-mail n'existait pas (le SMTP Supabase gratuit
-- était trop limité pour être fiable). Avec Brevo en SMTP + API, on ouvre le canal :
--   • les mails d'AUTH (inscription, mot de passe oublié, changement d'e-mail) partent de Supabase
--     via le SMTP — rien à coder ici, seulement des gabarits à coller dans le dashboard ;
--   • les mails APPLICATIFS (campagnes, informations) partent d'une Edge Function via l'API Brevo.
--
-- RGPD : `email_opt_in` vaut pour les envois NON essentiels. Les mails de sécurité (mot de passe,
-- changement d'adresse) partent toujours — ils ne sont pas du marketing, et s'en désinscrire
-- reviendrait à ne plus pouvoir récupérer son compte.
-- ============================================================================

-- 1) Préférences utilisateur --------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN NOT NULL DEFAULT true,
  -- Jeton de désinscription en 1 clic : présent dans CHAQUE mail non essentiel (obligation légale).
  ADD COLUMN IF NOT EXISTS email_unsub_token UUID NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.profiles.email_opt_in IS
  'Reçoit les e-mails NON essentiels (informations, campagnes). Les mails de sécurité partent toujours.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_unsub_token ON public.profiles(email_unsub_token);

-- 2) Campagnes ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  -- Corps en texte simple ; l'Edge Function l'habille du gabarit Relyka (logo, pied de page,
  -- lien de désinscription). L'admin n'écrit donc jamais de HTML.
  body TEXT NOT NULL,
  /* Ciblage — même vocabulaire que les notifications push :
       'all'      : tous les comptes qui acceptent les e-mails ;
       'premium'  : les comptes Premium ;
       'free'     : les comptes non Premium ;
       'group'    : les membres d'un groupe custom (`group_id`). */
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'premium', 'free', 'group')),
  group_id UUID REFERENCES public.user_groups(id) ON DELETE SET NULL,
  /* NULL = envoi immédiat ; sinon, le cron prend le relais à partir de cet instant. */
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  recipients_count INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_due
  ON public.email_campaigns(status, scheduled_at)
  WHERE status = 'scheduled';

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

-- Réservé aux admins, dans les DEUX sens (lecture ET écriture) : une campagne dit qui on cible.
-- ⚠️ Les quatre verbes sont couverts : une policy UPDATE manquante rendrait tout upsert impossible
--    (c'est exactement le bug qu'a connu month_closures, cf. migration 162).
DROP POLICY IF EXISTS "email_campaigns_admin_select" ON public.email_campaigns;
CREATE POLICY "email_campaigns_admin_select" ON public.email_campaigns FOR SELECT TO authenticated
  USING (public.is_app_admin());
DROP POLICY IF EXISTS "email_campaigns_admin_insert" ON public.email_campaigns;
CREATE POLICY "email_campaigns_admin_insert" ON public.email_campaigns FOR INSERT TO authenticated
  WITH CHECK (public.is_app_admin());
DROP POLICY IF EXISTS "email_campaigns_admin_update" ON public.email_campaigns;
CREATE POLICY "email_campaigns_admin_update" ON public.email_campaigns FOR UPDATE TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
DROP POLICY IF EXISTS "email_campaigns_admin_delete" ON public.email_campaigns;
CREATE POLICY "email_campaigns_admin_delete" ON public.email_campaigns FOR DELETE TO authenticated
  USING (public.is_app_admin());

-- 3) Combien de personnes recevraient une campagne ? ---------------------------------------------
-- Compté CÔTÉ SERVEUR : l'admin ne peut pas lire les profils des autres pour les compter lui-même
-- (et un `select` nu sur profiles chez un admin ferait fuiter tout le parc, cf. RLS ≠ filtre).
CREATE OR REPLACE FUNCTION public.email_audience_count(p_audience TEXT, p_group UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_n INT;
BEGIN
  IF NOT public.is_app_admin() THEN RETURN 0; END IF;
  SELECT count(*) INTO v_n
  FROM public.profiles p
  WHERE COALESCE(p.email_opt_in, true) = true
    AND p.email IS NOT NULL AND p.email <> ''
    AND (
      p_audience = 'all'
      OR (p_audience = 'premium' AND COALESCE(p.is_premium, false) = true)
      OR (p_audience = 'free'    AND COALESCE(p.is_premium, false) = false)
      OR (p_audience = 'group'   AND p_group IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.user_group_members m
                      WHERE m.group_id = p_group AND m.profile_id = p.id))
    );
  RETURN COALESCE(v_n, 0);
END; $$;
GRANT EXECUTE ON FUNCTION public.email_audience_count(TEXT, UUID) TO authenticated;

-- 4) Désinscription en 1 clic (appelée par le lien du pied de page, sans être connecté) ----------
CREATE OR REPLACE FUNCTION public.email_unsubscribe(p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows INT;
BEGIN
  UPDATE public.profiles SET email_opt_in = false WHERE email_unsub_token = p_token;
  -- `FOUND` n'est PAS un item de GET DIAGNOSTICS (erreur 42601) : c'est une variable spéciale qu'on
  -- lit directement. On compte donc les lignes touchées, ce qui dit la même chose sans ambiguïté.
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END; $$;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
