-- ============================================================================
-- 098 — Comptes partagés : un membre ÉCRITURE gère TOUTES les transactions du compte.
--
-- Révision de la règle initiale (« chacun ne gère que les siennes ») : sur un compte joint/partagé en
-- écriture, un membre `write` (et l'owner) peut désormais ÉDITER et SUPPRIMER n'importe quelle
-- transaction du compte, y compris celles créées par d'autres membres — exactement comme sur un compte
-- normal. Le rôle `read` (consultation) reste sans aucune écriture.
-- ============================================================================

DROP POLICY IF EXISTS transactions_update ON public.transactions;
DROP POLICY IF EXISTS transactions_delete ON public.transactions;

-- UPDATE : ma ligne, OU je suis owner/write du compte de la ligne.
CREATE POLICY transactions_update ON public.transactions FOR UPDATE
  USING (profile_id = auth.uid() OR acct_role(account_id) IN ('owner','write'))
  WITH CHECK (profile_id = auth.uid() OR acct_role(account_id) IN ('owner','write'));

-- DELETE : ma ligne, OU je suis owner/write du compte de la ligne.
CREATE POLICY transactions_delete ON public.transactions FOR DELETE
  USING (profile_id = auth.uid() OR acct_role(account_id) IN ('owner','write'));
