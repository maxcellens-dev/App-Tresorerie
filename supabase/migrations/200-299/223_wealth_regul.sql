-- 223 — Mettre à jour le solde d'un compte d'ÉPARGNE ou d'INVESTISSEMENT.
--
-- ── LE BESOIN ──────────────────────────────────────────────────────────────────────────────────
-- « Mettre à jour mon solde » n'existait que pour les comptes COURANTS. Sur un livret ou un compte
-- titres, la seule façon de recoller à la réalité était de ressaisir a posteriori les virements
-- oubliés — y compris sur des mois déjà clôturés, où l'on ne veut plus rien toucher.
--
-- ── POURQUOI CE N'EST PAS LA MÊME RÉGULARISATION QUE SUR UN COMPTE COURANT ──────────────────────
-- Une régularisation de compte courant dit : « il manquait 80 € que je n'avais pas saisis » — c'est
-- de l'argent RÉELLEMENT sorti (ou entré) du quotidien. Elle est donc rangée en « Frais variables ›
-- Régularisation Solde » (ou « Autres recettes › … »), elle pèse sur le plan de trésorerie et elle
-- calibre le doute de l'app sur les soldes courants.
--
-- Sur un compte d'épargne, la même correction ne dit pas ça du tout. Elle dit : « j'ai mis 500 € de
-- côté sans le noter ». Ce n'est ni une dépense, ni une recette du quotidien : c'est un MOUVEMENT DE
-- PATRIMOINE, exactement comme un virement entrant (ou sortant, si le montant est négatif). Le
-- traiter comme une régularisation de trésorerie produisait trois faux :
--   • une ligne dans le plan de trésorerie, alors que le compte courant n'a pas bougé ;
--   • un écart compté dans les dépenses (ou les recettes) variables du mois ;
--   • une dérive de fiabilité gonflée du montant corrigé — l'app se mettait à douter des soldes
--     courants parce qu'on avait ajusté un livret.
--
-- ── LE MARQUEUR ────────────────────────────────────────────────────────────────────────────────
-- `regul_kind = 'wealth'` distingue les deux. Il reste une régularisation au sens du moteur de solde
-- (`regul_target` est posé, donc `is_regul_tx` la voit et l'ANCRE fonctionne : le compte vaut
-- exactement le montant saisi à cette date). Ce qui change, c'est son INTERPRÉTATION côté app :
-- hors plan de trésorerie, hors budget, hors calibration du doute — mais comptée comme épargne
-- (ou investissement) mise de côté, au même titre qu'un virement.
--
-- Un MARQUEUR, et pas la catégorie : la catégorie est renommable par l'utilisateur (et par
-- l'administration). C'est exactement l'erreur que les migrations 175 et 196 ont eu à corriger.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS regul_kind text;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_regul_kind_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_regul_kind_check
  CHECK (regul_kind IS NULL OR regul_kind IN ('wealth'));

-- Index partiel : les lectures ne cherchent jamais les lignes à NULL (= presque toute la table).
CREATE INDEX IF NOT EXISTS transactions_regul_kind_idx
  ON public.transactions(account_id, regul_kind)
  WHERE regul_kind IS NOT NULL;

COMMENT ON COLUMN public.transactions.regul_kind IS
  'Régularisation de solde : ''wealth'' = mise à jour du solde d''un compte d''épargne ou '
  'd''investissement — mouvement de patrimoine (compté comme un virement entrant/sortant), hors '
  'plan de trésorerie, hors budget, hors calibration du doute. NULL = régularisation de trésorerie '
  '(compte courant), comportement historique inchangé.';

-- ── REPRISE DE L'EXISTANT ──────────────────────────────────────────────────────────────────────
-- Les régularisations DÉJÀ posées sur un compte d'épargne ou d'investissement (l'écran « Mettre à
-- jour mon solde » les acceptait déjà quand on y arrivait depuis la fiche du compte) sont marquées :
-- elles n'ont jamais été des régularisations de trésorerie, et les compter comme telles fausse
-- rétroactivement la dérive de fiabilité et le plan de trésorerie. On exclut les ancres de SOLDE
-- INITIAL : elles disent « ce compte démarre à X », ce n'est pas un mouvement (cf. lib/finance/regul).
UPDATE public.transactions t
SET regul_kind = 'wealth'
FROM public.accounts a
WHERE a.id = t.account_id
  AND a.type IN ('savings', 'investment')
  AND t.regul_kind IS NULL
  AND t.regul_target IS NOT NULL
  AND COALESCE(t.note, '') <> 'Régularisation solde initial';

-- ── LA CATÉGORIE ───────────────────────────────────────────────────────────────────────────────
-- Sous « Mouvements » — le tiroir des écritures NEUTRES (virements vers l'épargne, vers
-- l'investissement), `is_variable = false`, et le SEUL parent que le plan de trésorerie écarte de
-- ses lignes comme de ses totaux. C'est précisément ce qu'on veut : la mise à jour d'un livret n'a
-- rien à faire dans un plan de trésorerie, qui raconte le compte courant.
--
-- Une seule catégorie, de type « expense », quel que soit le SENS du montant : le type d'une
-- catégorie de « Mouvements » ne décide de rien (ni budget, ni recettes, ni dépenses), et créer une
-- jumelle côté recettes l'aurait fait apparaître dans le total RECETTES du plan — l'inverse du but.
INSERT INTO public.base_categories (name, type, parent_id, sort_order, is_variable, is_active)
SELECT 'Régularisation épargne / invest', 'expense', mv.id, 20, false, true
FROM public.base_categories mv
WHERE mv.parent_id IS NULL AND mv.type = 'expense' AND mv.name = 'Mouvements'
  AND NOT EXISTS (
    SELECT 1 FROM public.base_categories c
    WHERE c.parent_id = mv.id AND c.name ILIKE 'r%gularisation %pargne%'
  );

/* Propagation aux utilisateurs — même RPC que « Appliquer à tous » en administration (elle n'ajoute
   que ce qui manque et ne touche à aucun renommage).

   ⚠️ NON BLOQUANTE, et c'est capital (cf. migration 175) : `apply_base_categories()` exige un
   administrateur connecté. Exécutée depuis l'éditeur SQL, `auth.uid()` vaut NULL — l'appel lève, et
   comme la migration tourne dans UNE transaction, cet échec annulerait TOUT ce qui précède, colonne
   comprise. La catégorie manquante n'empêche rien : la mise à jour de solde s'écrit alors sans
   catégorie, exactement comme les régularisations d'avant la migration 175. */
DO $$
BEGIN
  PERFORM public.apply_base_categories();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Propagation des catégories non effectuée ici (%). Lance « Appliquer à tous » depuis l''administration.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
