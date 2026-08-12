-- ============================================================================
-- 104 — Module CRÉDIT (immo / conso / auto / autre).
--
-- Décisions produit : mensualités = FLUX DÉRIVÉ du tableau d'amortissement (pas de vraies transactions
-- récurrentes) ; patrimoine INCHANGÉ (crédits séparés, le CRD n'est PAS déduit des totaux comptes).
-- Le tableau d'amortissement est calculé côté client (déterministe). Ici on stocke les PARAMÈTRES.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'autre' CHECK (type IN ('immobilier','consommation','auto','autre')),
  label text NOT NULL,
  lender text,                                   -- établissement prêteur
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,  -- compte de prélèvement
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,  -- projet financé (optionnel)

  principal numeric NOT NULL,                    -- capital emprunté
  start_date date NOT NULL,                      -- date de déblocage
  first_payment_date date,                       -- 1ère échéance (sinon dérivée de start_date)
  duration_months integer NOT NULL,             -- durée en mois
  rate_annual numeric NOT NULL DEFAULT 0,        -- taux nominal annuel (%)
  rate_type text NOT NULL DEFAULT 'fixe' CHECK (rate_type IN ('fixe','variable','mixte')),

  -- Assurance & frais (coût réel)
  insurance_monthly numeric DEFAULT 0,           -- assurance emprunteur / mois
  fees_file numeric DEFAULT 0,                    -- frais de dossier
  fees_guarantee numeric DEFAULT 0,              -- frais de garantie (hypothèque/caution)
  early_repayment_penalty_pct numeric DEFAULT 0, -- IRA (% du capital remboursé par anticipation)

  -- Différé (franchise) : on ne rembourse rien (total) ou que les intérêts (partiel) au début
  deferral_months integer DEFAULT 0,
  deferral_type text DEFAULT 'none' CHECK (deferral_type IN ('none','partial','total')),

  is_simulation boolean NOT NULL DEFAULT false,  -- scénario non signé (activable → compté en projection/tréso)
  is_active boolean NOT NULL DEFAULT true,       -- false = soldé / archivé
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credits_profile ON public.credits(profile_id);
CREATE INDEX IF NOT EXISTS credits_account ON public.credits(account_id);
CREATE INDEX IF NOT EXISTS credits_project ON public.credits(project_id);

-- Événements en cours de vie : remboursement anticipé, changement de taux, modulation de mensualité.
CREATE TABLE IF NOT EXISTS public.credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('early_repayment','rate_change','modulation','fee','penalty')),
  amount numeric,        -- montant (remboursement anticipé, frais, pénalité)
  new_rate numeric,      -- pour rate_change
  new_payment numeric,   -- pour modulation (nouvelle mensualité)
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_events_credit ON public.credit_events(credit_id);

-- Rapprochement d'une vraie transaction avec une échéance de crédit (prélèvement réel).
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS credit_id uuid REFERENCES public.credits(id) ON DELETE SET NULL;

-- RLS : calquée sur transactions (mes lignes) + bypass admin (impersonation, cf. migration 102).
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credits_all ON public.credits;
CREATE POLICY credits_all ON public.credits FOR ALL
  USING (profile_id = auth.uid() OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR is_app_admin());
DROP POLICY IF EXISTS credit_events_all ON public.credit_events;
CREATE POLICY credit_events_all ON public.credit_events FOR ALL
  USING (profile_id = auth.uid() OR is_app_admin())
  WITH CHECK (profile_id = auth.uid() OR is_app_admin());

-- Recharge le cache de schéma PostgREST (sinon « column not found in schema cache » côté API).
NOTIFY pgrst, 'reload schema';
