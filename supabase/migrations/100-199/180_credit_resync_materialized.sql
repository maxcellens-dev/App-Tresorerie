-- ============================================================================
-- 180 — CRÉDIT : les échéances DÉJÀ matérialisées suivent les corrections du tableau.
--
-- LE PROBLÈME
-- ───────────
-- Depuis la 143, chaque échéance échue devient une VRAIE transaction, insérée depuis le cache
-- `credit_schedule` par `materialize_credit_from_schedule`. Cette fonction n'INSÈRE que ce qui
-- manque : `ON CONFLICT (credit_id, credit_kind, credit_period) DO NOTHING`, dans la fenêtre
-- (materialized_until, aujourd'hui].
--
-- Conséquence : dès qu'on corrige un crédit (mensualité, taux, palier, événement de remboursement
-- anticipé, changement de compte de prélèvement), le client republie bien le tableau — mais les
-- échéances DÉJÀ écrites gardent leurs anciens montants, pour toujours. Le passé affichait donc des
-- prélèvements que la banque n'a jamais faits, et le solde recalculé était faux d'autant. Le futur,
-- lui, se corrigeait tout seul (ce sont des flux virtuels recalculés à chaque affichage) : d'où
-- l'impression d'une app qui « se met à jour à moitié ».
--
-- LA CORRECTION
-- ─────────────
-- Une RPC de RÉ-ALIGNEMENT, appelée par le propriétaire juste après la republication du cache.
-- Elle rend les échéances matérialisées identiques au tableau qui fait foi :
--   • montant / date / catégorie / libellé / compte corrigés quand ils diffèrent ;
--   • échéance disparue du tableau (crédit raccourci, soldé par anticipation) → supprimée ;
--   • échéance REPOUSSÉE dans le futur (report, différé rallongé) → supprimée : elle redevient un
--     flux prévisionnel, exactement comme si elle n'avait jamais été prélevée.
-- Les soldes des comptes touchés sont recalculés depuis les faits (recompute_account_balance).
--
-- SECURITY DEFINER : les lignes appartiennent au propriétaire du crédit, comme à l'insertion. Seul
-- le propriétaire (ou un admin) peut déclencher le réalignement — c'est lui qui publie le tableau.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resync_credit_materialized(
  p_credit uuid,
  p_today  date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_cred    RECORD;
  v_today   date;
  v_changed integer := 0;
  d         integer;
  a         RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  SELECT id, profile_id, account_id INTO v_cred FROM public.credits WHERE id = p_credit;
  IF v_cred.id IS NULL THEN RETURN 0; END IF;
  IF v_cred.profile_id <> v_uid AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Seul le propriétaire du crédit peut réaligner ses échéances';
  END IF;

  -- Même borne que la matérialisation (cf. 143) : un client à l'horloge fausse ne fabrique pas
  -- le futur.
  v_today := LEAST(p_today, current_date + 1);

  -- Cache pas encore publié → on ne conclut RIEN. Sans ce garde, un tableau momentanément vide
  -- (republication en deux temps : delete puis insert) ferait supprimer tout l'historique du crédit.
  IF NOT EXISTS (SELECT 1 FROM public.credit_schedule s WHERE s.credit_id = p_credit) THEN
    RETURN 0;
  END IF;

  -- 1) Réalignement des échéances encore présentes ET encore échues.
  UPDATE public.transactions t
  SET amount      = s.amount,
      date        = s.date,
      category_id = s.category_id,
      note        = s.note,
      account_id  = s.account_id
  FROM public.credit_schedule s
  WHERE t.credit_id     = p_credit
    AND s.credit_id     = t.credit_id
    AND s.kind          = t.credit_kind
    AND s.period        = t.credit_period
    AND s.date         <= v_today
    AND (t.amount      IS DISTINCT FROM s.amount
      OR t.date        IS DISTINCT FROM s.date
      OR t.category_id IS DISTINCT FROM s.category_id
      OR t.note        IS DISTINCT FROM s.note
      OR t.account_id  IS DISTINCT FROM s.account_id);
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  -- 2) Échéance disparue du tableau, ou repoussée après aujourd'hui → elle n'a plus lieu d'exister
  --    en tant que transaction réelle.
  DELETE FROM public.transactions t
  WHERE t.credit_id = p_credit
    AND t.credit_period IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_schedule s
      WHERE s.credit_id = t.credit_id AND s.kind = t.credit_kind AND s.period = t.credit_period
        AND s.date <= v_today
    );
  GET DIAGNOSTICS d = ROW_COUNT;
  v_changed := v_changed + d;

  IF v_changed > 0 THEN
    -- Le compte de prélèvement a pu CHANGER : on recalcule tous les comptes qui portent (ou ont
    -- porté) une échéance de ce crédit, plus celui déclaré sur le crédit.
    FOR a IN
      SELECT DISTINCT account_id AS id FROM public.credit_schedule WHERE credit_id = p_credit
      UNION
      SELECT DISTINCT account_id FROM public.transactions WHERE credit_id = p_credit
      UNION
      SELECT v_cred.account_id WHERE v_cred.account_id IS NOT NULL
    LOOP
      IF a.id IS NOT NULL THEN PERFORM public.recompute_account_balance(a.id, v_today); END IF;
    END LOOP;
  END IF;

  RETURN v_changed;
END; $$;

GRANT EXECUTE ON FUNCTION public.resync_credit_materialized(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
