-- ============================================================================
-- 198 — Crédit partagé : ce que le partage donne, et ce qu'il ne donne pas.
--       + bornes de cohérence sur les paramètres financiers.
--
-- RÈGLE : partager un crédit, c'est le porter à plusieurs — l'invité en « écriture »
-- doit pouvoir le CORRIGER (montants, taux, échéances, événements). Restent au seul
-- propriétaire les actions qui font disparaître le crédit ou changent à qui il
-- appartient : activer/désactiver, repasser en simulation, changer de propriétaire,
-- de projet, de responsabilité partagée — et publier l'échéancier.
--
-- La policy de 110 laissait un membre write modifier profile_id, account_id,
-- project_id et les métadonnées de matérialisation : il pouvait donc déplacer le
-- crédit vers son compte ou en devenir propriétaire. Cette garde est côté base : le
-- client ne doit jamais être l'autorité sur ces invariants.
--
-- ⚠️ `materialized_until` est volontairement ABSENT de la liste réservée : c'est un
-- curseur avancé par une RPC que TOUT participant appelle (cf. plus bas).
-- ============================================================================

-- Bornes de cohérence. `NOT VALID` : on ne rejette que les écritures À VENIR, sans faire échouer la
-- migration sur d'éventuelles lignes anciennes hors bornes.
-- `DROP ... IF EXISTS` d'abord : PostgreSQL n'a pas d'`ADD CONSTRAINT IF NOT EXISTS`, et sans ça
-- rejouer cette migration (ce que fait tout déploiement idempotent) échouerait sur
-- « constraint already exists ».
ALTER TABLE public.credits
  DROP CONSTRAINT IF EXISTS credits_principal_positive,
  DROP CONSTRAINT IF EXISTS credits_duration_bounded,
  DROP CONSTRAINT IF EXISTS credits_rate_bounded,
  DROP CONSTRAINT IF EXISTS credits_insurance_nonnegative,
  DROP CONSTRAINT IF EXISTS credits_deferral_bounded,
  DROP CONSTRAINT IF EXISTS credits_deferral_within_duration;

ALTER TABLE public.credits
  ADD CONSTRAINT credits_principal_positive CHECK (principal > 0) NOT VALID,
  ADD CONSTRAINT credits_duration_bounded CHECK (duration_months BETWEEN 1 AND 1200) NOT VALID,
  ADD CONSTRAINT credits_rate_bounded CHECK (rate_annual BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT credits_insurance_nonnegative CHECK (COALESCE(insurance_monthly, 0) >= 0) NOT VALID,
  ADD CONSTRAINT credits_deferral_bounded CHECK (COALESCE(deferral_months, 0) BETWEEN 0 AND 600) NOT VALID,
  -- Le différé s'AJOUTE à la durée d'amortissement : un différé plus long que la période de
  -- remboursement ne correspond à aucun produit réel (50 ans d'intérêts seuls avant 1 an de
  -- remboursement). Miroir de la validation de l'écran.
  ADD CONSTRAINT credits_deferral_within_duration
    CHECK (COALESCE(deferral_months, 0) <= duration_months) NOT VALID;

CREATE OR REPLACE FUNCTION public.guard_credit_owner_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF public.is_app_admin() OR OLD.profile_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  /* ── CE QUE LE PARTAGE NE DONNE PAS ───────────────────────────────────────────────────────────
     Partager un crédit donne le droit de le CORRIGER (montants, taux, échéances) : c'est le but.
     Restent au propriétaire les actions qui font DISPARAÎTRE le crédit ou qui changent à qui il
     appartient :
       • `profile_id`    — devenir propriétaire du crédit d'un autre ;
       • `is_active`     — le désactiver le retire de la projection, de la trésorerie et du récap
                           de TOUS les participants, et arrête la matérialisation de ses échéances.
                           C'est un archivage : même portée qu'une suppression, sans la corbeille ;
       • `is_simulation` — même effet, par une autre porte (une simulation ne compte nulle part) ;
       • `is_shared`     — la responsabilité de la dette ;
       • `project_id`    — le rattachement à un projet, qui appartient au propriétaire ;
       • `schedule_hash` — SEUL le propriétaire publie le tableau d'amortissement
                           (useMaterializeCredits ne traite que les crédits dont `_role = 'owner'`).
     La suppression et la gestion des membres sont déjà réservées au propriétaire par les policies
     de la migration 110 (`credits_delete`, `credit_mem_cud`). */
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.is_shared IS DISTINCT FROM OLD.is_shared
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.is_simulation IS DISTINCT FROM OLD.is_simulation
     OR NEW.schedule_hash IS DISTINCT FROM OLD.schedule_hash THEN
    RAISE EXCEPTION 'Seul le propriétaire peut activer, désactiver, rattacher ou transmettre ce crédit';
  END IF;

  /* ── `materialized_until` : BORNÉ, surtout pas verrouillé ─────────────────────────────────────
     Ce champ n'est pas un attribut de propriété : c'est le CURSEUR de matérialisation, avancé par
     la RPC `materialize_credit_from_schedule` (143/175/197). Cette RPC est appelée par TOUT
     participant — c'est même sa raison d'être : les échéances échues d'un crédit partagé doivent
     devenir de vraies transactions même quand le propriétaire n'ouvre pas l'app.

     Le verrouiller au propriétaire cassait donc la matérialisation pour tous les autres. Et pas
     seulement pour le crédit partagé : la RPC boucle sur TOUS les crédits éligibles en une seule
     transaction, donc l'exception levée sur le crédit d'autrui annulait aussi la matérialisation
     des crédits PERSONNELS de l'appelant, silencieusement (le client avale l'erreur et réessaie
     indéfiniment).

     On garde malgré tout le garde-fou utile : personne d'autre que le propriétaire ne peut pousser
     le curseur DANS LE FUTUR (ce qui sauterait des échéances). La borne est la même que celle que
     la RPC s'applique à elle-même : au plus demain (fuseaux en avance sur UTC). Reculer le curseur
     reste permis — la matérialisation est idempotente (ON CONFLICT DO NOTHING). */
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

DROP TRIGGER IF EXISTS trg_guard_credit_owner_fields ON public.credits;
CREATE TRIGGER trg_guard_credit_owner_fields
  BEFORE UPDATE ON public.credits
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_owner_fields();

CREATE OR REPLACE FUNCTION public.guard_credit_event_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Admin : indispensable pour le mode « connecté en tant que », où l'écriture porte l'auth.uid()
  -- de l'admin mais le profile_id de l'utilisateur incarné.
  IF public.is_app_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Un événement de crédit doit être attribué à son auteur';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'L’auteur d’un événement de crédit ne peut pas être modifié';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_credit_event_profile ON public.credit_events;
CREATE TRIGGER trg_guard_credit_event_profile
  BEFORE INSERT OR UPDATE ON public.credit_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_event_profile();

NOTIFY pgrst, 'reload schema';
