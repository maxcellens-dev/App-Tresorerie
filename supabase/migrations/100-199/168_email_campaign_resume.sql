-- ============================================================================
-- 168 — Campagnes e-mail ÉTALÉES sur plusieurs jours (reprise exacte).
--
-- Le problème : un compte Brevo gratuit plafonne à ~300 envois par jour. Une campagne à 600
-- personnes s'arrêtait donc au milieu, passait en `failed`, et il n'existait AUCUN moyen sûr de la
-- terminer : la relancer réécrivait aux premiers destinataires (doublon), et ne pas la relancer
-- laissait la moitié du parc sans nouvelle.
--
-- La solution tient en deux morceaux :
--
--   1. Un REGISTRE des envois (`email_campaign_sends`). On note qui a déjà reçu quoi. La reprise
--      n'est plus « repartir de l'indice N » — un indice dérive dès qu'une inscription ou une
--      désinscription change l'ordre de la liste — mais « tous les destinataires SAUF ceux déjà
--      servis ». C'est exact quoi qu'il arrive entre deux jours.
--
--   2. Un état `paused` + `resume_at`. Quota épuisé n'est pas un échec : c'est une pause. Le cron
--      qui passe déjà toutes les 5 min reprend la campagne dès que `resume_at` est atteint, et la
--      termine sans intervention.
-- ============================================================================

-- 1) Registre des envois : une ligne par destinataire SERVI, par campagne. ----------------------
CREATE TABLE IF NOT EXISTS public.email_campaign_sends (
  campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- La clé primaire EST la garantie anti-doublon : même en cas de double exécution du cron, un
  -- destinataire ne peut pas être inscrit deux fois pour la même campagne.
  PRIMARY KEY (campaign_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON public.email_campaign_sends(campaign_id);

COMMENT ON TABLE public.email_campaign_sends IS
  'Qui a déjà reçu quelle campagne. Sert à REPRENDRE une campagne étalée sur plusieurs jours sans '
  'réécrire aux destinataires déjà servis.';

ALTER TABLE public.email_campaign_sends ENABLE ROW LEVEL SECURITY;

-- Lecture admin uniquement (l'écriture passe par l'Edge Function, en rôle service).
DROP POLICY IF EXISTS "campaign_sends_admin_select" ON public.email_campaign_sends;
CREATE POLICY "campaign_sends_admin_select" ON public.email_campaign_sends FOR SELECT TO authenticated
  USING (public.is_app_admin());
DROP POLICY IF EXISTS "campaign_sends_admin_delete" ON public.email_campaign_sends;
CREATE POLICY "campaign_sends_admin_delete" ON public.email_campaign_sends FOR DELETE TO authenticated
  USING (public.is_app_admin());

-- 2) État « en pause » + heure de reprise + avancement. -----------------------------------------
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS resume_at TIMESTAMPTZ,
  -- Nombre de destinataires VISÉS au total (recipients_count, lui, compte les servis) : sans les
  -- deux, une campagne en pause n'a pas d'avancement affichable (« 300 / 612 »).
  ADD COLUMN IF NOT EXISTS total_recipients INT NOT NULL DEFAULT 0;

-- `paused` rejoint les états permis. On reconstruit la contrainte : PostgreSQL n'a pas d'« ALTER
-- CHECK », et la laisser telle quelle ferait échouer toute mise en pause.
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_status_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'sent', 'failed'));

COMMENT ON COLUMN public.email_campaigns.resume_at IS
  'Campagne en pause (quota d''envoi épuisé) : instant à partir duquel le cron la reprend.';

-- Index de reprise, jumeau de celui des campagnes programmées.
CREATE INDEX IF NOT EXISTS idx_email_campaigns_resume
  ON public.email_campaigns(status, resume_at)
  WHERE status = 'paused';
