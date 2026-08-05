-- ============================================================================
-- 169 — Campagnes e-mail RÉCURRENTES (« la newsletter du 1er de chaque mois »).
--
-- Même vocabulaire que les notifications planifiées (`scheduled_notifications`, migration 063) :
-- quotidien / hebdomadaire / mensuel, heure locale, fuseau, `day_of_month = 0` = dernier jour.
-- La logique « c'est dû maintenant ? » est d'ailleurs PARTAGÉE côté serveur (_shared/recurrence.ts)
-- plutôt que recopiée : deux copies d'un calcul de calendrier finissent toujours par diverger.
--
-- ⚠️ POURQUOI UNE TABLE À PART, et pas une récurrence posée sur `email_campaigns` :
-- une campagne porte son REGISTRE d'envois (`email_campaign_sends`, migration 168), qui sert à ne
-- jamais réécrire deux fois au même destinataire. Rendre une campagne récurrente rendrait ce
-- registre absurde : dès la 2ᵉ occurrence, tout le monde y figurerait déjà et plus personne ne
-- recevrait rien. Une planification ENGENDRE donc, à chaque échéance, une campagne NEUVE — avec son
-- propre registre, sa propre reprise sur quota, sa propre ligne d'historique.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Contenu de l'e-mail, identique à celui d'une campagne ponctuelle.
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  -- Ciblage, même vocabulaire que les campagnes et les notifications.
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'premium', 'free', 'group')),
  group_id UUID REFERENCES public.user_groups(id) ON DELETE SET NULL,
  -- Récurrence.
  recurrence TEXT NOT NULL DEFAULT 'monthly' CHECK (recurrence IN ('daily', 'weekly', 'monthly')),
  time_of_day TEXT NOT NULL DEFAULT '09:00',
  day_of_week INT,                      -- 0 = dimanche (hebdomadaire)
  day_of_month INT,                     -- 1-31, ou 0 = dernier jour du mois
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  active BOOLEAN NOT NULL DEFAULT true,
  -- Dernier déclenchement : c'est lui qui garantit « une fois par jour » même si le cron
  -- passe toutes les 5 minutes.
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_schedules IS
  'Campagnes e-mail récurrentes. Chaque échéance ENGENDRE une ligne email_campaigns neuve (avec son '
  'propre registre d''envois), elle n''envoie jamais directement.';

CREATE INDEX IF NOT EXISTS idx_email_schedules_active
  ON public.email_schedules(active) WHERE active = true;

ALTER TABLE public.email_schedules ENABLE ROW LEVEL SECURITY;

-- Réservé aux admins, dans les deux sens. Les QUATRE verbes sont couverts : une policy UPDATE
-- manquante rendrait tout upsert impossible (le bug de month_closures, migration 162).
DROP POLICY IF EXISTS "email_schedules_admin_select" ON public.email_schedules;
CREATE POLICY "email_schedules_admin_select" ON public.email_schedules FOR SELECT TO authenticated
  USING (public.is_app_admin());
DROP POLICY IF EXISTS "email_schedules_admin_insert" ON public.email_schedules;
CREATE POLICY "email_schedules_admin_insert" ON public.email_schedules FOR INSERT TO authenticated
  WITH CHECK (public.is_app_admin());
DROP POLICY IF EXISTS "email_schedules_admin_update" ON public.email_schedules;
CREATE POLICY "email_schedules_admin_update" ON public.email_schedules FOR UPDATE TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
DROP POLICY IF EXISTS "email_schedules_admin_delete" ON public.email_schedules;
CREATE POLICY "email_schedules_admin_delete" ON public.email_schedules FOR DELETE TO authenticated
  USING (public.is_app_admin());

-- Lien occurrence → planification : l'historique doit pouvoir dire « ceci vient de la newsletter
-- mensuelle », et non afficher une campagne surgie de nulle part.
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES public.email_schedules(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.email_campaigns.schedule_id IS
  'Planification récurrente qui a engendré cette occurrence (NULL = campagne ponctuelle).';
