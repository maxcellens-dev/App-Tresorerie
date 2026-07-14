-- ============================================================================
-- 140 — LE POULS (état des lieux de la santé financière).
--
-- Trois temps, un seul moteur (lib/pulseEngine) :
--   • live    — delta chips après chaque saisie (aucun stockage) ;
--   • hebdo   — carte « Pouls de la semaine », 1ʳᵉ ouverture de la semaine ;
--   • mensuel — « État des lieux », offert à la clôture du mois.
--
-- Ce que cette migration ajoute :
--  1. app_config.pulse       — config ADMIN (signaux par profil, repères, notif hebdo).
--  2. profiles.pulse_state   — dernière période VUE par l'utilisateur (anti-réaffichage).
--  3. pulse_snapshots        — historique des bilans (évolution, série « tout au vert », stats admin).
--
-- Les snapshots sont écrits par le CLIENT (le moteur est en TS, partagé avec l'affichage : une seule
-- source de vérité). Le serveur ne recalcule rien — il stocke le constat déjà affiché à l'utilisateur.
-- ============================================================================

-- 1) Config admin ────────────────────────────────────────────────────────────
-- Les signaux MONTENT avec le profil : P1 tient son mois, P5 fait croître son patrimoine.
-- Repères : cushionMonths (mois de revenus couverts), savingRatePct (% des revenus mis de côté),
-- investOfCapacityPct (% de la capacité d'investissement du mois à utiliser pour être « au vert »).
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS pulse jsonb NOT NULL DEFAULT '{
    "enabled": true,
    "live": true,
    "weekly": true,
    "monthly": true,
    "signalsByProfile": {
      "P1": ["end_of_month", "spending", "cushion", "projects"],
      "P2": ["cushion", "saving", "spending", "no_overdraft", "projects"],
      "P3": ["cushion", "investing", "saving", "spending", "projects"],
      "P4": ["investing", "cushion", "spending", "no_overdraft", "projects"],
      "P5": ["investing", "wealth", "cushion", "projects"]
    },
    "benchmarks": {
      "P1": {"cushionMonths": 1, "savingRatePct": 5,  "investOfCapacityPct": 0},
      "P2": {"cushionMonths": 3, "savingRatePct": 10, "investOfCapacityPct": 50},
      "P3": {"cushionMonths": 3, "savingRatePct": 15, "investOfCapacityPct": 60},
      "P4": {"cushionMonths": 6, "savingRatePct": 10, "investOfCapacityPct": 70},
      "P5": {"cushionMonths": 3, "savingRatePct": 0,  "investOfCapacityPct": 70}
    },
    "weeklyPush": {
      "enabled": true,
      "weekday": 0,
      "hour": 21,
      "title": "Ton pouls de la semaine 🫀",
      "body": "Ouvre Relyka pour voir où tu en es cette semaine."
    }
  }'::jsonb;

-- 2) Dernière période vue ────────────────────────────────────────────────────
-- { "week": "2026-W29", "month": "2026-07" } — la carte hebdo ne s'affiche qu'une fois par semaine,
-- l'état des lieux qu'une fois par mois. L'utilisateur les ferme lui-même (aucune auto-disparition).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pulse_state jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3) Historique des bilans ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pulse_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 'week' → period_key = '2026-W29' · 'month' → period_key = '2026-07'
  period_kind  text NOT NULL CHECK (period_kind IN ('week', 'month')),
  period_key   text NOT NULL,
  -- Profil financier au moment du bilan (les repères en dépendent → indispensable pour relire l'histoire).
  profile_tier text,
  -- Signaux tels qu'AFFICHÉS (id, statut, titre) : on stocke le constat, on ne le recalcule jamais.
  signals      jsonb NOT NULL DEFAULT '[]'::jsonb,
  green_count  integer NOT NULL DEFAULT 0,
  judged_count integer NOT NULL DEFAULT 0,
  all_green    boolean NOT NULL DEFAULT false,
  -- Chiffres non fiables (confiance basse) → bilan indicatif, EXCLU des séries « tout au vert ».
  estimated    boolean NOT NULL DEFAULT false,
  -- Patrimoine total du jour → permet l'évolution sur 3 mois sans historiser les comptes.
  wealth       numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, period_kind, period_key)
);

CREATE INDEX IF NOT EXISTS pulse_snapshots_profile_idx
  ON public.pulse_snapshots (profile_id, period_kind, period_key DESC);

ALTER TABLE public.pulse_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS : chacun ses bilans. La branche directe (profile_id = auth.uid()) vient EN PREMIER — sans elle,
-- un INSERT ... RETURNING échoue en « violates RLS » quand la fonction admin est STABLE.
DROP POLICY IF EXISTS pulse_snapshots_select ON public.pulse_snapshots;
CREATE POLICY pulse_snapshots_select ON public.pulse_snapshots
  FOR SELECT USING (profile_id = auth.uid() OR is_app_admin());

DROP POLICY IF EXISTS pulse_snapshots_insert ON public.pulse_snapshots;
CREATE POLICY pulse_snapshots_insert ON public.pulse_snapshots
  FOR INSERT WITH CHECK (profile_id = auth.uid() OR is_app_admin());

DROP POLICY IF EXISTS pulse_snapshots_update ON public.pulse_snapshots;
CREATE POLICY pulse_snapshots_update ON public.pulse_snapshots
  FOR UPDATE USING (profile_id = auth.uid() OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR is_app_admin());

DROP POLICY IF EXISTS pulse_snapshots_delete ON public.pulse_snapshots;
CREATE POLICY pulse_snapshots_delete ON public.pulse_snapshots
  FOR DELETE USING (profile_id = auth.uid() OR is_app_admin());

-- 4) Notification système « pouls hebdo » ────────────────────────────────────
-- Activable dans l'admin (Fiabilité & confiance → notifications système, ou écran Pouls).
UPDATE public.app_config
SET system_notifications = COALESCE(system_notifications, '{}'::jsonb)
  || jsonb_build_object('pulse_weekly', jsonb_build_object('enabled', true))
WHERE id = 'default'
  AND NOT (COALESCE(system_notifications, '{}'::jsonb) ? 'pulse_weekly');
