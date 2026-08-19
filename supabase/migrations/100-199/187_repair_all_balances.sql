-- ============================================================================
-- 187 — RÉPARATION : recalculer TOUS les soldes, et vérifier la fonction qui les produit.
--
-- LE SYMPTÔME
-- ───────────
-- Une régularisation de clôture est bien écrite (elle s'affiche, avec son solde cible), mais le
-- solde du compte ne bouge pas d'un centime. Exemple constaté :
--     régularisation du 31/07 → solde cible 3 916,50 €, montant −450,41 €
--     opérations d'août                                          −2 009,59 €
--     solde attendu                                               1 906,91 €
--     solde affiché                                               2 357,32 €   (= attendu + 450,41)
-- L'écart vaut EXACTEMENT le montant de la régularisation : le solde stocké est resté celui
-- d'AVANT la clôture, augmenté de l'activité postérieure. Autrement dit, `accounts.balance` n'a
-- jamais été réécrit après l'insertion de la régularisation.
--
-- LA CAUSE, IDENTIFIÉE
-- ────────────────────
--     ERROR 42883: function public.is_regul_tx(uuid, text, numeric) does not exist
--     CONTEXT: PL/pgSQL function recompute_account_balance(uuid,date) line 10
--
-- `is_regul_tx` est créée par la migration 175. Elle n'a jamais été appliquée sur cette base. La
-- migration 181, elle, a réécrit `recompute_account_balance` en SUPPOSANT que cette fonction
-- existait — depuis, CHAQUE appel échoue, sur TOUS les comptes. Le solde n'était donc plus jamais
-- recalculé : ni après une régularisation, ni après une saisie, ni après une clôture.
--
-- Deux fautes se sont additionnées, et chacune mérite d'être nommée :
--   • une migration a été écrite en tenant pour acquise une dépendance non vérifiée ;
--   • le client appelait `recompute_account_balance` puis IGNORAIT l'erreur retournée. Une panne
--     totale et permanente du calcul des soldes n'a donc produit AUCUN signal — juste des chiffres
--     faux, crédibles, pendant des jours. Le client lève désormais (cf. hooks/useTransactions).
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
--  1. elle CRÉE `is_regul_tx` si elle manque — sans dépendre de la 175, et sans rien casser si
--     elle est déjà là. Une fonction dont tout le calcul des soldes dépend ne doit exister que
--     dans une migration qu'on peut rejouer seule ;
--  2. elle REPOSE les attributs de `recompute_account_balance` (SECURITY DEFINER + droit
--     d'exécution) : un `CREATE OR REPLACE FUNCTION` les remet aux valeurs par défaut quand ils ne
--     sont pas redéclarés, et la fonction repasse en SECURITY INVOKER — son UPDATE sur `accounts`
--     se heurte alors à la RLS de l'appelant, typiquement sur un compte JOINT ;
--  3. elle RECALCULE le solde de TOUS les comptes actifs depuis les faits. Aucune donnée n'est
--     inventée : on repart de la dernière régularisation ancrée et on rejoue ce qui a suivi. Un
--     compte déjà juste reste identique.
--
-- Sans la reprise (3), les soldes faux le resteraient jusqu'à la prochaine écriture sur chaque
-- compte — c'est-à-dire indéfiniment pour un compte peu utilisé.
-- ============================================================================

-- 1) LA DÉPENDANCE MANQUANTE. Recopiée à l'identique de la migration 175 : marqueur de référence
--    `regul_target`, avec repli sur le libellé pour les lignes écrites avant l'existence de la
--    colonne. C'est la MÊME règle que `isRegul` côté client — une seule définition de « ceci est
--    une régularisation », des deux côtés du réseau.
CREATE OR REPLACE FUNCTION public.is_regul_tx(
  p_category_id  uuid,
  p_note         text,
  p_regul_target numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_regul_target IS NOT NULL
      OR (p_category_id IS NULL AND (p_note ILIKE '%gul%' OR p_note = 'Ajustement de solde'));
$fn$;

-- 2) Les attributs, réaffirmés (ils ne survivent pas toujours à un CREATE OR REPLACE).
ALTER FUNCTION public.recompute_account_balance(uuid, date) SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.recompute_account_balance(uuid, date) TO authenticated;

-- 3) Reprise de l'existant : tous les comptes actifs, un par un.
--    Volontairement une boucle et non un `SELECT recompute(...) FROM accounts` : la fonction écrit
--    dans `accounts`, et on veut chaque écriture isolée plutôt qu'un ordre d'évaluation implicite.
DO $$
DECLARE a RECORD; n integer := 0;
BEGIN
  FOR a IN SELECT id FROM public.accounts WHERE COALESCE(is_active, true) LOOP
    PERFORM public.recompute_account_balance(a.id, current_date);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Soldes recalculés : %', n;
END $$;

-- 4) FILET DE DIAGNOSTIC — le solde attendu d'un compte, sans rien écrire.
--    Permet de comparer `accounts.balance` à ce que les faits donnent, sans avoir à rejouer le
--    calcul de tête depuis l'écran. Utile la prochaine fois qu'un chiffre est contesté :
--        SELECT id, name, balance, public.expected_account_balance(id) FROM accounts;
CREATE OR REPLACE FUNCTION public.expected_account_balance(p_account uuid, p_today date DEFAULT current_date)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_regul_id      uuid;
  v_regul_date    date;
  v_regul_created timestamptz;
  v_regul_target  numeric(14,2);
  v_bal           numeric(14,2);
BEGIN
  SELECT id, date, created_at, regul_target
    INTO v_regul_id, v_regul_date, v_regul_created, v_regul_target
  FROM transactions
  WHERE account_id = p_account
    AND COALESCE(is_draft, false) = false
    AND date <= p_today
    AND public.is_regul_tx(category_id, note, regul_target)
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  IF v_regul_id IS NOT NULL AND v_regul_target IS NOT NULL THEN
    SELECT v_regul_target + COALESCE(SUM(tx.amount), 0) INTO v_bal
    FROM transactions tx
    WHERE tx.account_id = p_account
      AND COALESCE(tx.is_draft, false) = false
      AND tx.date <= p_today
      AND tx.id <> v_regul_id
      AND (
        tx.date > v_regul_date
        OR (tx.date = v_regul_date AND tx.created_at > v_regul_created
            AND NOT COALESCE(tx.regul_covered, false))
      );
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO v_bal
    FROM transactions tx
    WHERE tx.account_id = p_account
      AND COALESCE(tx.is_draft, false) = false
      AND tx.date <= p_today;
  END IF;

  RETURN v_bal;
END; $$;
GRANT EXECUTE ON FUNCTION public.expected_account_balance(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
