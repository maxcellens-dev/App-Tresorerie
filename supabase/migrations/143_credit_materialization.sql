-- ============================================================================
-- 143 — MATÉRIALISATION des échéances de crédit échues.
--
-- Problème : les mensualités de crédit étaient des FLUX VIRTUELS (useCreditFlows), jamais écrits en
-- base. Conséquences : le solde du compte de prélèvement n'était jamais débité, les échéances du mois
-- disparaissaient rétroactivement au changement de mois (horizon = 1er du mois courant), la charge
-- crédit passée n'était jamais catégorisée (absorbée sans catégorie par les régularisations), et la
-- projection partait d'un solde trop haut du montant des échéances échues non saisies.
--
-- Solution : comme pour les récurrentes (migration 030/084), chaque échéance échue devient une VRAIE
-- transaction. Le tableau d'amortissement étant calculé côté client (lib/amortization.ts : différé,
-- paliers, événements, overrides), le serveur ne sait PAS le recalculer → le client du PROPRIÉTAIRE
-- PUBLIE le tableau en base (table credit_schedule, rafraîchie à chaque changement via un hash),
-- et la RPC materialize_credit_from_schedule (SECURITY DEFINER) matérialise les échéances échues
-- depuis ce cache. Elle est appelée par N'IMPORTE QUEL participant à sa connexion (propriétaire,
-- membre du crédit ou du compte) → le compte est à jour dès que quelqu'un le regarde, même si le
-- propriétaire ne s'est pas connecté depuis des mois. Attribution : les lignes appartiennent
-- toujours au propriétaire du crédit. Unicité par index, solde par recompute (084).
-- Les flux virtuels ne couvrent plus que le FUTUR (date > aujourd'hui).
-- ============================================================================

-- 1) Identification d'une échéance matérialisée (dédup + rattachement au crédit).
--    transactions.credit_id existe depuis la 104 (prévu pour le rapprochement, jamais utilisé).
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credit_kind text CHECK (credit_kind IN ('pay','ins'));
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credit_period integer;

-- Unicité d'une échéance (anti double-insertion : multi-appareils, sessions concurrentes).
-- Index NON partiel exprès : les lignes normales ont credit_id NULL → jamais en conflit entre elles
-- (NULLs distincts), et PostgREST peut inférer l'index pour l'upsert `ON CONFLICT DO NOTHING`
-- (impossible avec un index partiel, l'inférence exigerait le prédicat).
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_credit_occurrence
  ON public.transactions(credit_id, credit_kind, credit_period);

-- 2) Borne de matérialisation par crédit : les échéances datées ≤ materialized_until ne sont JAMAIS
--    matérialisées (le client avance la borne à « aujourd'hui » après chaque passage).
--    Backfill des crédits existants + défaut des nouveaux = dernier jour du mois PRÉCÉDENT :
--    le mois courant est matérialisé (c'est ce que l'app affichait déjà virtuellement depuis le 1er),
--    le passé antérieur reste porté par les vraies transactions / régularisations de l'utilisateur
--    (principe historique du module : « passé = vraies transactions »).
ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS materialized_until date NOT NULL
    DEFAULT (date_trunc('month', now()) - interval '1 day');

-- 3) CACHE serveur du tableau d'amortissement, publié par le client du propriétaire (le serveur ne
--    sait pas calculer l'amortissement : différé, paliers, événements, overrides → lib/amortization).
--    credits.schedule_hash évite de republier un tableau inchangé à chaque session.
CREATE TABLE IF NOT EXISTS public.credit_schedule (
  credit_id uuid NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pay','ins')),
  period integer NOT NULL,
  date date NOT NULL,
  amount numeric NOT NULL,             -- négatif (sortie), montant RÉEL complet
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  note text,
  PRIMARY KEY (credit_id, kind, period)
);
CREATE INDEX IF NOT EXISTS credit_schedule_date ON public.credit_schedule(date);

ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS schedule_hash text;

ALTER TABLE public.credit_schedule ENABLE ROW LEVEL SECURITY;
-- Écriture/lecture : propriétaire du crédit (+ admin). Les autres participants n'y accèdent que via
-- la RPC SECURITY DEFINER (qui vérifie elle-même leurs droits).
DROP POLICY IF EXISTS credit_schedule_all ON public.credit_schedule;
CREATE POLICY credit_schedule_all ON public.credit_schedule FOR ALL
  USING (EXISTS (SELECT 1 FROM public.credits c WHERE c.id = credit_id
                 AND (c.profile_id = auth.uid() OR is_app_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.credits c WHERE c.id = credit_id
                      AND (c.profile_id = auth.uid() OR is_app_admin())));

-- 4) Matérialisation depuis le cache — appelable par TOUT participant (propriétaire, membre du
--    crédit, membre/propriétaire du compte de prélèvement). SECURITY DEFINER : insère des lignes
--    ATTRIBUÉES AU PROPRIÉTAIRE du crédit (l'RLS du caller ne le permettrait pas), d'où les
--    vérifications d'accès explicites ci-dessous. Idempotente et sûre en concurrence :
--    ON CONFLICT DO NOTHING (index unique) + borne materialized_until.
--    Renvoie le nombre de lignes insérées (le client invalide ses caches si > 0).
CREATE OR REPLACE FUNCTION public.materialize_credit_from_schedule(p_today date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c       RECORD;
  v_uid   uuid := auth.uid();
  v_today date;
  v_regul date;
  ins     integer;
  n       integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  -- p_today = date LOCALE du client (cf. 081), mais bornée : un client (malveillant ou à l'horloge
  -- fausse) ne peut pas matérialiser le futur — au plus demain (fuseaux en avance sur UTC).
  v_today := LEAST(p_today, current_date + 1);

  FOR c IN
    SELECT cr.id, cr.profile_id, cr.account_id, cr.materialized_until
    FROM public.credits cr
    WHERE cr.is_active AND NOT cr.is_simulation AND cr.account_id IS NOT NULL
      AND cr.materialized_until < v_today
      AND (
        cr.profile_id = v_uid
        OR public.is_app_admin()
        OR EXISTS (SELECT 1 FROM public.credit_members m
                   WHERE m.credit_id = cr.id AND m.user_id = v_uid)
        OR EXISTS (SELECT 1 FROM public.account_members am
                   WHERE am.account_id = cr.account_id AND am.user_id = v_uid)
        OR EXISTS (SELECT 1 FROM public.accounts a
                   WHERE a.id = cr.account_id AND a.profile_id = v_uid)
      )
  LOOP
    -- Cache pas encore publié par le propriétaire → ne PAS avancer la borne (sinon les échéances
    -- de la fenêtre seraient perdues à jamais) ; on retentera quand le tableau sera publié.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.credit_schedule s WHERE s.credit_id = c.id);

    -- Dernière régularisation du compte (cf. 084) : une échéance datée du JOUR de la régul est
    -- déjà comprise dans le solde réconcilié ; datée avant, la date l'exclut au recalcul.
    SELECT max(date) INTO v_regul
    FROM public.transactions
    WHERE account_id = c.account_id AND COALESCE(is_draft, false) = false
      AND category_id IS NULL AND (note ILIKE '%gul%' OR note = 'Ajustement de solde');

    INSERT INTO public.transactions
      (profile_id, account_id, category_id, amount, date, note,
       is_forecast, is_reconciled, is_draft, is_recurring,
       credit_id, credit_kind, credit_period, regul_covered)
    SELECT c.profile_id, s.account_id, s.category_id, s.amount, s.date, s.note,
           false, false, false, false,
           s.credit_id, s.kind, s.period,
           (v_regul IS NOT NULL AND s.date <= v_regul)
    FROM public.credit_schedule s
    WHERE s.credit_id = c.id
      AND s.date > c.materialized_until AND s.date <= v_today
    ON CONFLICT (credit_id, credit_kind, credit_period) DO NOTHING;
    GET DIAGNOSTICS ins = ROW_COUNT;
    n := n + ins;

    UPDATE public.credits SET materialized_until = v_today WHERE id = c.id;
    IF ins > 0 THEN
      PERFORM public.recompute_account_balance(c.account_id, v_today);
    END IF;
  END LOOP;

  RETURN n;
END; $$;

-- 5) Limites d'usage (migration 135) : les échéances matérialisées sont des lignes SYSTÈME, comme
--    les occurrences de récurrentes → jamais bloquées, et exclues des comptages.
CREATE OR REPLACE FUNCTION public.enforce_transaction_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prem boolean; lim_m int; lim_y int; cnt_m int; cnt_y int; y int; m int;
BEGIN
  -- Jamais de blocage pour l'admin ni pour les occurrences système (matérialisation de récurrentes
  -- ou d'échéances de crédit).
  IF public.is_app_admin() THEN RETURN NEW; END IF;
  IF NEW.materialized_from IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.credit_kind IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.date IS NULL THEN RETURN NEW; END IF;

  prem := public.is_profile_premium(NEW.profile_id);
  lim_m := public.app_usage_limit('transactions_per_month', prem);
  lim_y := public.app_usage_limit('transactions_per_year', prem);
  y := EXTRACT(YEAR FROM NEW.date);
  m := EXTRACT(MONTH FROM NEW.date);

  SELECT count(*) INTO cnt_m FROM public.transactions
    WHERE profile_id = NEW.profile_id AND materialized_from IS NULL AND credit_kind IS NULL
      AND EXTRACT(YEAR FROM date) = y AND EXTRACT(MONTH FROM date) = m;
  IF cnt_m >= lim_m THEN
    RAISE EXCEPTION 'USAGE_LIMIT_TRANSACTIONS_MONTH (%/%)', cnt_m, lim_m USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO cnt_y FROM public.transactions
    WHERE profile_id = NEW.profile_id AND materialized_from IS NULL AND credit_kind IS NULL
      AND EXTRACT(YEAR FROM date) = y;
  IF cnt_y >= lim_y THEN
    RAISE EXCEPTION 'USAGE_LIMIT_TRANSACTIONS_YEAR (%/%)', cnt_y, lim_y USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

-- Recharge le cache de schéma PostgREST (sinon « column not found in schema cache » côté API).
NOTIFY pgrst, 'reload schema';
