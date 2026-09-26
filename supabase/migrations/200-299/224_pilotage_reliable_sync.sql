-- Récurrence historique durable et publication atomique des échéanciers.
BEGIN;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_recurring_occurrence boolean NOT NULL DEFAULT false;

UPDATE public.transactions SET is_recurring_occurrence = true
WHERE materialized_from IS NOT NULL AND NOT is_recurring_occurrence;

CREATE OR REPLACE FUNCTION public.preserve_recurring_occurrence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.is_recurring_occurrence := COALESCE(NEW.is_recurring_occurrence, false)
      OR OLD.is_recurring_occurrence OR OLD.materialized_from IS NOT NULL
      OR NEW.materialized_from IS NOT NULL;
  ELSE
    NEW.is_recurring_occurrence := COALESCE(NEW.is_recurring_occurrence, false)
      OR NEW.materialized_from IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_recurring_occurrence ON public.transactions;
CREATE TRIGGER preserve_recurring_occurrence
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.preserve_recurring_occurrence();

-- Même périmètre que la migration 199 : aucun droit d'écriture pour un lecteur.
DROP POLICY IF EXISTS credit_schedule_all ON public.credit_schedule;
CREATE POLICY credit_schedule_all ON public.credit_schedule FOR ALL
  USING (EXISTS (SELECT 1 FROM public.credits c WHERE c.id = credit_id
    AND (c.profile_id = auth.uid() OR public.credit_role(c.id) = 'write' OR public.is_app_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.credits c WHERE c.id = credit_id
    AND (c.profile_id = auth.uid() OR public.credit_role(c.id) = 'write' OR public.is_app_admin())));

ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS events_revision bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.touch_credit_events_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ids uuid[]; target uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN ids := ARRAY[NEW.credit_id];
  ELSIF TG_OP = 'DELETE' THEN ids := ARRAY[OLD.credit_id];
  ELSE ids := ARRAY[OLD.credit_id, NEW.credit_id]; END IF;
  -- Verrou parent partagé avec la publication ; ordre stable si un événement change de crédit.
  FOR target IN SELECT DISTINCT x FROM unnest(ids) x ORDER BY x LOOP
    UPDATE public.credits SET events_revision = events_revision + 1 WHERE id = target;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS touch_credit_events_revision ON public.credit_events;
CREATE TRIGGER touch_credit_events_revision BEFORE INSERT OR UPDATE OR DELETE ON public.credit_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_credit_events_revision();

CREATE OR REPLACE FUNCTION public.publish_credit_schedule(
  p_credit uuid, p_hash text, p_rows jsonb, p_today date,
  p_expected_updated_at timestamptz, p_previous_hash text, p_expected_events_revision bigint
)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  c public.credits%ROWTYPE;
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
  SELECT * INTO c FROM public.credits WHERE id = p_credit FOR UPDATE;
  IF NOT FOUND OR NOT (c.profile_id = auth.uid()
      OR public.credit_role(p_credit) = 'write' OR public.is_app_admin()) THEN
    RAISE EXCEPTION 'Écriture du crédit refusée';
  END IF;
  IF NOT c.is_active OR c.is_simulation OR c.account_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = c.account_id AND is_active) THEN
    RAISE EXCEPTION 'Compte de prélèvement inactif';
  END IF;
  IF c.updated_at IS DISTINCT FROM p_expected_updated_at
      OR c.schedule_hash IS DISTINCT FROM p_previous_hash
      OR c.events_revision IS DISTINCT FROM p_expected_events_revision THEN
    RAISE EXCEPTION 'Le crédit a changé. Actualise ses données avant de réessayer.';
  END IF;
  IF p_today IS NULL OR p_today < current_date - 1 OR p_today > current_date + 1 THEN
    RAISE EXCEPTION 'Date de synchronisation invalide';
  END IF;
  IF p_hash IS NULL OR length(p_hash) > 120 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Échéancier invalide';
  END IF;
  IF jsonb_array_length(p_rows) > 2400 OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(kind text, period integer, date date, amount numeric, account_id uuid)
    WHERE r.account_id IS DISTINCT FROM c.account_id OR r.kind IS NULL OR r.kind NOT IN ('pay', 'ins')
      OR r.period IS NULL OR r.period < 1 OR r.date IS NULL
      OR r.amount IS NULL OR r.amount >= 0 OR r.amount::text IN ('NaN', 'Infinity', '-Infinity')
  ) THEN RAISE EXCEPTION 'Échéancier invalide'; END IF;

  -- Toute erreur (droits, validation, réalignement) annule aussi le DELETE.
  DELETE FROM public.credit_schedule WHERE credit_id = p_credit;
  INSERT INTO public.credit_schedule(credit_id, kind, period, date, amount, account_id, category_id, note)
  SELECT p_credit, r.kind, r.period, r.date, r.amount, r.account_id, r.category_id, r.note
  FROM jsonb_to_recordset(p_rows) AS r(kind text, period integer, date date, amount numeric, account_id uuid, category_id uuid, note text);
  n := public.resync_credit_materialized(p_credit, p_today);
  UPDATE public.credits SET schedule_hash = p_hash WHERE id = p_credit;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_credit_schedule(uuid, text, jsonb, date, timestamptz, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_credit_schedule(uuid, text, jsonb, date, timestamptz, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
