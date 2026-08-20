-- ============================================================================
-- 192 — Deux séries de lignes orphelines qui font disparaître des choses à l'écran.
--
-- ── 1) DES COMPTES COURANTS ABSENTS DE LA CLÔTURE ───────────────────────────────────────────
-- `account_closures` dit « ce compte est déjà clôturé pour ce mois » (migration 179, pour qu'un
-- compte joint ne soit pas clôturé une fois par participant). La modale de clôture RETIRE de sa
-- liste tout compte qui y figure.
--
-- Une réouverture doit donc effacer ces lignes en même temps que la clôture. Ça n'a pas toujours
-- été le cas : les réouvertures faites avant la 179 ne connaissaient pas cette table, et celles
-- faites avant la 190 ne voyaient pas les comptes hors de leur propre profil. Il reste donc des
-- lignes qui affirment qu'un compte est clôturé pour un mois qui, lui, ne l'est plus — et ces
-- comptes ont purement disparu de l'écran de clôture, sans un mot.
--
-- La règle qui les distingue est simple et vérifiable : une clôture par compte n'a de sens que si
-- la personne qui l'a faite a, elle, ce mois-là clôturé et CONFIRMÉ. Sinon la ligne ne décrit plus
-- rien. On ne touche pas aux clôtures des autres participants d'un compte joint : chacune est jugée
-- sur le mois de SON auteur.
--
-- ── 2) DES LIGNES DE PAIEMENT QUI NE PAIENT RIEN ────────────────────────────────────────────
-- `rw_expense_accounts` répartit l'argent RÉELLEMENT sorti entre les comptes du payeur : chaque
-- ligne porte la transaction qu'elle a créée. Une ligne sans transaction ne correspond donc à aucun
-- mouvement — c'est le résidu d'un enregistrement interrompu entre la création de la ligne et celle
-- de la transaction. Elle fait pourtant croire à l'app qu'une dépense a touché un vrai compte : elle
-- apparaît dans l'onglet « Par compte » et compte dans le garde-fou qui interdit de retirer un
-- participant. C'est ce qui rendait un retrait impossible sans qu'on puisse voir pourquoi.
--
-- (Une dépense réglée en espèces n'a AUCUNE ligne ici — le cas « cash », c'est l'absence de ligne,
-- jamais une ligne vide. Rien de légitime n'est donc supprimé.)
-- ============================================================================

-- ── 1) Clôtures par compte devenues sans objet ──────────────────────────────────────────────
DELETE FROM public.account_closures c
WHERE NOT EXISTS (
  SELECT 1 FROM public.month_closures m
  WHERE m.profile_id = c.closed_by
    AND m.month_key  = c.month_key
    AND COALESCE(m.status, 'confirmed') = 'confirmed'
);

-- ── 2) Lignes de répartition sans transaction ───────────────────────────────────────────────
DELETE FROM public.rw_expense_accounts WHERE transaction_id IS NULL;

-- Colonnes historiques d'une dépense : elles doivent pointer une transaction qui existe encore.
-- Une référence morte y produit exactement le même faux positif que ci-dessus.
UPDATE public.rw_expenses e
SET account_id = NULL, transaction_id = NULL
WHERE e.transaction_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = e.transaction_id);

NOTIFY pgrst, 'reload schema';
