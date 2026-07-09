-- ============================================================================
-- 135 — LIMITES D'USAGE par utilisateur (anti-abus / anti-saisies abusives).
--
-- Config admin (app_config.usage_limits) : limites FREE et PREMIUM. Enforcement SERVEUR par triggers
-- BEFORE INSERT — le client affiche un message avant, mais la base est le vrai garde-fou (contournement
-- par appel API direct impossible).
--
-- Décisions produit :
--  • Transactions comptées PAR DATE (mois/année de la transaction, pas par date de saisie) ; les
--    occurrences MATÉRIALISÉES de récurrentes (materialized_from IS NOT NULL) ne comptent pas
--    (le modèle récurrent compte une fois, pas ses répétitions générées).
--  • Comptes / projets / crédits / conversations IA : compte total de lignes du profil (supprimer
--    d'anciens éléments libère de la place — les transactions des projets supprimés sont conservées
--    côté app via dissociation).
--  • L'admin (is_app_admin, ex. « connecté en tant que ») n'est jamais bloqué.
-- ============================================================================

-- 1) Config free / premium.
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS usage_limits jsonb NOT NULL DEFAULT '{
    "free":    {"transactions_per_month":100,"transactions_per_year":1200,"accounts":20,"projects":10,"credits":20,"ai_conversations":5},
    "premium": {"transactions_per_month":500,"transactions_per_year":6000,"accounts":50,"projects":30,"credits":50,"ai_conversations":20}
  }'::jsonb;

-- 2) Limite effective pour une clé + statut premium (repli : très grand = pas de limite si clé absente).
CREATE OR REPLACE FUNCTION public.app_usage_limit(p_key text, p_premium boolean)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    ((usage_limits -> (CASE WHEN p_premium THEN 'premium' ELSE 'free' END)) ->> p_key)::int,
    2147483647
  )
  FROM public.app_config WHERE id = 'default';
$$;

-- 3) Premium effectif d'un profil (droit stocké sur profiles.is_premium).
CREATE OR REPLACE FUNCTION public.is_profile_premium(p_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_premium FROM public.profiles WHERE id = p_profile), false);
$$;

-- 4) Enforcement TRANSACTIONS (limite mensuelle ET annuelle, par DATE de la transaction).
CREATE OR REPLACE FUNCTION public.enforce_transaction_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prem boolean; lim_m int; lim_y int; cnt_m int; cnt_y int; y int; m int;
BEGIN
  -- Jamais de blocage pour l'admin ni pour les occurrences système (matérialisation de récurrentes).
  IF public.is_app_admin() THEN RETURN NEW; END IF;
  IF NEW.materialized_from IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.date IS NULL THEN RETURN NEW; END IF;

  prem := public.is_profile_premium(NEW.profile_id);
  lim_m := public.app_usage_limit('transactions_per_month', prem);
  lim_y := public.app_usage_limit('transactions_per_year', prem);
  y := EXTRACT(YEAR FROM NEW.date);
  m := EXTRACT(MONTH FROM NEW.date);

  SELECT count(*) INTO cnt_m FROM public.transactions
    WHERE profile_id = NEW.profile_id AND materialized_from IS NULL
      AND EXTRACT(YEAR FROM date) = y AND EXTRACT(MONTH FROM date) = m;
  IF cnt_m >= lim_m THEN
    RAISE EXCEPTION 'USAGE_LIMIT_TRANSACTIONS_MONTH (%/%)', cnt_m, lim_m USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO cnt_y FROM public.transactions
    WHERE profile_id = NEW.profile_id AND materialized_from IS NULL
      AND EXTRACT(YEAR FROM date) = y;
  IF cnt_y >= lim_y THEN
    RAISE EXCEPTION 'USAGE_LIMIT_TRANSACTIONS_YEAR (%/%)', cnt_y, lim_y USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_transaction_limit ON public.transactions;
CREATE TRIGGER trg_enforce_transaction_limit BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_transaction_limit();

-- 5) Enforcement des tables à COMPTE TOTAL (clé de limite passée en argument du trigger).
CREATE OR REPLACE FUNCTION public.enforce_row_usage_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prem boolean; lim int; cnt int; k text;
BEGIN
  IF public.is_app_admin() THEN RETURN NEW; END IF;
  k := TG_ARGV[0];
  prem := public.is_profile_premium(NEW.profile_id);
  lim := public.app_usage_limit(k, prem);
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE profile_id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
    INTO cnt USING NEW.profile_id;
  IF cnt >= lim THEN
    RAISE EXCEPTION 'USAGE_LIMIT_% (%/%)', upper(k), cnt, lim USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_accounts_limit ON public.accounts;
CREATE TRIGGER trg_enforce_accounts_limit BEFORE INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_usage_limit('accounts');

DROP TRIGGER IF EXISTS trg_enforce_projects_limit ON public.projects;
CREATE TRIGGER trg_enforce_projects_limit BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_usage_limit('projects');

DROP TRIGGER IF EXISTS trg_enforce_credits_limit ON public.credits;
CREATE TRIGGER trg_enforce_credits_limit BEFORE INSERT ON public.credits
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_usage_limit('credits');

DROP TRIGGER IF EXISTS trg_enforce_ai_conversations_limit ON public.ai_conversations;
CREATE TRIGGER trg_enforce_ai_conversations_limit BEFORE INSERT ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_usage_limit('ai_conversations');

GRANT EXECUTE ON FUNCTION public.app_usage_limit(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_profile_premium(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
