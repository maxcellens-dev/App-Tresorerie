-- ============================================================================
-- 199 — Une correction du tableau d'amortissement s'applique TOUT DE SUITE,
--       même faite par un co-emprunteur.
--
-- LE PROBLÈME
-- ───────────
-- Corriger le montant d'une échéance (fiche du crédit → « Modifier » → toucher la ligne) écrit un
-- `schedule_overrides` sur le crédit. Pour que la transaction DÉJÀ écrite sur le compte suive, il
-- faut ensuite deux choses :
--   1. republier le tableau dans le cache serveur `credit_schedule` ;
--   2. appeler `resync_credit_materialized` (180), qui réaligne les lignes échues sur ce cache.
--
-- Or ces deux opérations étaient réservées au PROPRIÉTAIRE du crédit :
--   • la policy `credit_schedule_all` (143) n'autorise que `c.profile_id = auth.uid()` ;
--   • la RPC 180 lève « Seul le propriétaire du crédit peut réaligner ses échéances ».
--
-- Un co-emprunteur en écriture pouvait donc corriger le tableau — la ligne changeait bien de
-- couleur — mais rien ne se propageait. Sa correction restait décorative jusqu'à ce que le
-- propriétaire ouvre l'app. C'est incohérent avec le sens du partage : partager une dette, c'est
-- pouvoir la corriger POUR DE VRAI.
--
-- LA RÈGLE
-- ────────
-- Publier le tableau et réaligner les échéances font partie de la CORRECTION du crédit : ouvert à
-- l'écriture (`credit_role(id) = 'write'`), exactement comme la modification des montants que la
-- policy `credits_update` (110) autorise déjà. Ce qui reste au propriétaire ne bouge pas :
-- activer/désactiver, repasser en simulation, changer de propriétaire, de projet, de
-- responsabilité, supprimer, et gérer les membres.
-- ============================================================================

-- 1) Cache d'échéancier : lisible/écrivable par les participants EN ÉCRITURE.
--    (La lecture large ne pose pas de question : elle est déjà bornée au crédit, que le membre voit.)
DROP POLICY IF EXISTS credit_schedule_all ON public.credit_schedule;
CREATE POLICY credit_schedule_all ON public.credit_schedule FOR ALL
  USING (EXISTS (SELECT 1 FROM public.credits c WHERE c.id = credit_id
                 AND (c.profile_id = auth.uid() OR public.credit_role(c.id) = 'write' OR public.is_app_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.credits c WHERE c.id = credit_id
                      AND (c.profile_id = auth.uid() OR public.credit_role(c.id) = 'write' OR public.is_app_admin())));

-- 2) Réalignement des échéances déjà matérialisées : même ouverture.
--    Corps identique à la migration 180, seul le contrôle d'accès change.
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
  -- 199 : le propriétaire OU un participant en écriture. Un membre en consultation reste exclu.
  IF v_cred.profile_id <> v_uid
     AND public.credit_role(p_credit) IS DISTINCT FROM 'write'
     AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Réaligner les échéances demande un accès en écriture sur ce crédit';
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

-- 3) Garde des champs « propriétaire » (198) : `schedule_hash` doit suivre la même ouverture, sinon
--    le co-emprunteur republie le cache mais ne peut pas enregistrer l'empreinte correspondante —
--    et l'app republierait le tableau à chaque démarrage, indéfiniment.
--    Le reste de la garde est INCHANGÉ (cf. 198).
CREATE OR REPLACE FUNCTION public.guard_credit_owner_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF public.is_app_admin() OR OLD.profile_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  /* Réservé au propriétaire : ce qui fait DISPARAÎTRE le crédit ou change à qui il appartient.
     `schedule_hash` n'en fait plus partie (199) : publier le tableau est un acte de CORRECTION,
     ouvert à l'écriture. Il reste refusé au membre en consultation, faute de droit d'UPDATE
     (policy `credits_update`, 110). */
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.is_shared IS DISTINCT FROM OLD.is_shared
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.is_simulation IS DISTINCT FROM OLD.is_simulation THEN
    RAISE EXCEPTION 'Seul le propriétaire peut activer, désactiver, rattacher ou transmettre ce crédit';
  END IF;

  /* `materialized_until` : BORNÉ, surtout pas verrouillé — c'est le curseur avancé par
     `materialize_credit_from_schedule`, que TOUT participant appelle. Le verrouiller cassait la
     matérialisation de tous les autres (cf. 198). On interdit seulement de le pousser dans le
     futur, ce qui sauterait des échéances. */
  IF NEW.materialized_until IS DISTINCT FROM OLD.materialized_until
     AND NEW.materialized_until > current_date + 1 THEN
    RAISE EXCEPTION 'Le curseur de matérialisation ne peut pas être avancé dans le futur';
  END IF;

  /* Un co-emprunteur en écriture peut déplacer le prélèvement ENTRE comptes réellement partagés,
     ce qui est une modification légitime d'une dette commune. En revanche, un tiers qui n'a que
     l'accès à la fiche ne peut pas l'envoyer sur son compte personnel : il doit avoir l'écriture
     sur le compte actuel et le nouveau compte, et le propriétaire du crédit doit aussi accéder au
     nouveau compte. */
  IF NEW.account_id IS DISTINCT FROM OLD.account_id AND NOT (
    OLD.account_id IS NOT NULL
    AND NEW.account_id IS NOT NULL
    AND public.acct_role(OLD.account_id) IN ('owner', 'write')
    AND public.acct_role(NEW.account_id) IN ('owner', 'write')
    AND EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = NEW.account_id
        AND (
          a.profile_id = OLD.profile_id
          OR EXISTS (
            SELECT 1 FROM public.account_members m
            WHERE m.account_id = a.id AND m.user_id = OLD.profile_id
          )
        )
    )
  ) THEN
    RAISE EXCEPTION 'Le compte de prélèvement doit rester un compte partagé par les responsables du crédit';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
