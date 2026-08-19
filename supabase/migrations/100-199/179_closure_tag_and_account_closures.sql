-- ============================================================================
-- 179 — CLÔTURE : les régularisations qu'elle écrit sont enfin IDENTIFIABLES,
--                 et un compte JOINT ne se clôture qu'une fois, par qui veut.
--
-- ── LE BUG QUI RENDAIT LA RÉOUVERTURE INOPÉRANTE ────────────────────────────────────────────
-- Rouvrir un mois devait supprimer les régularisations créées PAR la clôture. Elles étaient
-- reconnues à leur libellé ET à l'absence de catégorie :
--        .is('category_id', null).in('note', CLOSURE_REGUL_NOTES)
-- Or depuis la migration 175 une régularisation PORTE une catégorie (« Régularisation Solde »,
-- rangée en frais variables ou en autres recettes). Le filtre ne correspondait donc plus à rien :
-- depuis la 175, rouvrir un mois retirait la ligne `month_closures`… et laissait TOUTES les
-- régularisations en place. Le solde restait corrigé, et la clôture suivante en réécrivait
-- par-dessus. C'est très exactement le symptôme « quand je rouvre un mois, il me propose des
-- montants différents de ceux qu'il me proposait à la validation ».
--
-- Reconnaître une écriture au texte qu'elle affiche était de toute façon fragile : « Régularisation
-- solde » est aussi le libellé d'une mise à jour de solde saisie à la main, qu'une réouverture ne
-- doit JAMAIS effacer. On pose donc une marque explicite : `closure_month` = le mois clôturé qui a
-- produit la ligne. Écrite par la clôture, et par elle seule ; lue par la réouverture, et par elle
-- seule. Plus aucune ambiguïté possible avec une saisie de l'utilisateur.
--
-- ── COMPTES JOINTS ──────────────────────────────────────────────────────────────────────────
-- La clôture ne proposait que les comptes courants PERSO (useAccounts filtre is_joint = false) : un
-- compte joint n'était jamais vérifié, donc jamais régularisé — son solde dérivait sans que rien ne
-- le signale. Il doit y entrer, mais un compte joint est vu par plusieurs personnes : sans trace
-- partagée, chacune le clôturerait de son côté et empilerait autant de régularisations que de
-- participants sur le même compte. `account_closures` est cette trace : UNE clôture par compte et
-- par mois, quel que soit celui qui la fait.
-- ============================================================================

-- ── 1) Marque d'origine sur les régularisations de clôture ──────────────────────────────────
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS closure_month text;
COMMENT ON COLUMN public.transactions.closure_month IS
  'YYYY-MM du mois clôturé qui a produit cette régularisation. Posé par la clôture mensuelle uniquement ; la réouverture de ce mois supprime exactement ces lignes.';
CREATE INDEX IF NOT EXISTS transactions_closure_month
  ON public.transactions(profile_id, closure_month) WHERE closure_month IS NOT NULL;

-- Reprise de l'historique : les libellés ci-dessous n'ont JAMAIS été écrits par autre chose que la
-- clôture, et leur date est celle du mois clos (dernier jour du mois pour les deux premiers).
-- « Régularisation clôture (mois courant) » est la part reportée sur le mois en cours : elle est
-- datée APRÈS le mois clos, on la rattache donc au dernier mois clôturé antérieur à sa date.
UPDATE public.transactions t
SET closure_month = to_char(t.date, 'YYYY-MM')
WHERE t.closure_month IS NULL
  AND t.note IN ('Régularisation (à jour)', 'Régularisation clôture (mois)');

UPDATE public.transactions t
SET closure_month = (
  SELECT max(c.month_key) FROM public.month_closures c
  WHERE c.profile_id = t.profile_id AND (c.month_key || '-01')::date <= t.date
)
WHERE t.closure_month IS NULL
  AND t.note = 'Régularisation clôture (mois courant)';

-- ── 2) Une clôture par COMPTE et par mois (comptes joints inclus) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.account_closures (
  account_id uuid    NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  month_key  text    NOT NULL,
  closed_by  uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    numeric,                    -- solde retenu à la fin du mois (informatif)
  closed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, month_key)
);
CREATE INDEX IF NOT EXISTS account_closures_month ON public.account_closures(month_key);

ALTER TABLE public.account_closures ENABLE ROW LEVEL SECURITY;

-- Périmètre = celui du compte (propriétaire ou membre) — c'est ce qui permet à CHAQUE participant
-- de voir qu'un compte joint a déjà été clôturé, et donc de ne pas le reproposer.
DROP POLICY IF EXISTS account_closures_select ON public.account_closures;
CREATE POLICY account_closures_select ON public.account_closures FOR SELECT
  USING (public.acct_can_access(account_id));

-- Seuls le propriétaire et un membre en écriture peuvent clôturer : un accès en consultation
-- regarde, il n'engage rien.
DROP POLICY IF EXISTS account_closures_insert ON public.account_closures;
CREATE POLICY account_closures_insert ON public.account_closures FOR INSERT
  WITH CHECK (closed_by = auth.uid() AND public.acct_role(account_id) IN ('owner', 'write'));

DROP POLICY IF EXISTS account_closures_delete ON public.account_closures;
CREATE POLICY account_closures_delete ON public.account_closures FOR DELETE
  USING (public.acct_role(account_id) IN ('owner', 'write') OR public.is_app_admin());

-- Réouverture d'un mois : défait CE que la clôture avait écrit, et rien d'autre.
--   • les régularisations marquées `closure_month = p_month` (marque posée par la clôture) ;
--   • les anciennes lignes, d'avant cette migration, reconnues au libellé + à la date — le repli
--     historique, conservé pour ne pas laisser d'orphelines chez les comptes déjà clôturés ;
--   • la trace de clôture des comptes (joints compris) pour ce mois.
-- Les soldes sont recalculés par l'appelant (recompute_account_balance), comme partout ailleurs.
CREATE OR REPLACE FUNCTION public.reopen_month_regularisations(p_month text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_from  date;
  v_to    date;
  n       integer := 0;
  d       integer;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  IF p_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mois invalide'; END IF;
  v_from := (p_month || '-01')::date;
  v_to   := (v_from + interval '1 month - 1 day')::date;

  DELETE FROM public.transactions
  WHERE profile_id = v_uid AND closure_month = p_month;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Repli historique (lignes écrites avant la marque). On ne touche « Régularisation solde » que
  -- daté EXACTEMENT du dernier jour du mois : c'est la seule date que la clôture lui donne.
  DELETE FROM public.transactions
  WHERE profile_id = v_uid AND closure_month IS NULL
    AND (
      (note IN ('Régularisation (à jour)', 'Régularisation clôture (mois)') AND date BETWEEN v_from AND v_to)
      OR (note = 'Régularisation clôture (mois courant)' AND date > v_to)
      OR (note = 'Régularisation solde' AND date = v_to AND regul_target IS NOT NULL)
    );
  GET DIAGNOSTICS d = ROW_COUNT;
  n := n + d;

  DELETE FROM public.account_closures
  WHERE month_key = p_month AND public.acct_role(account_id) IN ('owner', 'write');

  RETURN n;
END; $$;
GRANT EXECUTE ON FUNCTION public.reopen_month_regularisations(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
