-- 196 — Investissement : un vrai MARQUEUR pour les apports et les plus/moins-values.
--
-- ── LE PROBLÈME ────────────────────────────────────────────────────────────────────────────────
-- Sur un compte d'investissement, trois natures d'opérations cohabitent et se ressemblent
-- exactement en base : `category_id` NULL, pas de `linked_account_id`, un simple montant signé.
--   • un APPORT (« j'ai versé 500 »)                 → augmente l'apport ET la valeur ;
--   • une PLUS/MOINS-VALUE (« ça a pris 500 »)       → augmente la valeur, PAS l'apport ;
--   • un retrait, lui, se reconnaît (virement lié).
--
-- Rien ne les distinguait, sauf… le LIBELLÉ, testé à la volée :
--     apport          →  /apport/i.test(note)
--     plus/moins-value→  /plus|moins|gain|perte/i.test(note)
--
-- Or le libellé est un champ de texte LIBRE, modifiable à tout moment depuis l'écran d'édition
-- d'une transaction. Deux conséquences, toutes deux silencieuses :
--   • renommer « Plus-value » en « Revalorisation T3 » la faisait sortir des plus-values — le gain
--     disparaissait du bilan et le montant se mettait à gonfler l'APPORT, donc à écraser la
--     performance affichée du compte ;
--   • à l'inverse, un versement noté « Apport moins les frais » contient « moins » : il était
--     compté comme une moins-value.
--
-- ── LA CORRECTION ──────────────────────────────────────────────────────────────────────────────
-- La nature est désormais une DONNÉE, posée par le bouton qui crée l'opération, et non une
-- devinette sur du texte. Le libellé redevient ce qu'il doit être : un commentaire.
--
-- `investment_kind` NULL = tout le reste (l'immense majorité des transactions). La colonne ne
-- concerne que les opérations saisies sur un compte d'investissement.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS investment_kind text;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_investment_kind_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_investment_kind_check
  CHECK (investment_kind IS NULL OR investment_kind IN ('gain', 'loss', 'deposit'));

-- Index partiel : les lectures ne cherchent JAMAIS les lignes à NULL (= presque toute la table).
CREATE INDEX IF NOT EXISTS transactions_investment_kind_idx
  ON public.transactions(account_id, investment_kind)
  WHERE investment_kind IS NOT NULL;

-- ── REPRISE DE L'EXISTANT ──────────────────────────────────────────────────────────────────────
-- On rejoue EXACTEMENT la règle que l'app appliquait jusqu'ici, restreinte aux comptes
-- d'investissement et aux lignes qui ne sont ni un virement ni une régularisation. C'est
-- volontairement conservateur : le but est de figer la classification ACTUELLE, pas d'en inventer
-- une nouvelle. Une ligne dont le libellé avait déjà été retouché au point d'être méconnaissable
-- reste non marquée — l'information n'a jamais été stockée, on ne peut pas la deviner. Elle
-- continuera d'être lue par le repli sur le libellé, comme aujourd'hui.
--
-- ORDRE IMPORTANT : les plus/moins-values d'abord, les apports ensuite avec `investment_kind IS
-- NULL` — sinon « Apport moins les frais » serait marqué deux fois, et c'est la règle plus/moins
-- value qui primait dans le code (elle était testée en premier).

UPDATE public.transactions t
SET investment_kind = CASE WHEN t.amount < 0 THEN 'loss' ELSE 'gain' END
FROM public.accounts a
WHERE a.id = t.account_id
  AND a.type = 'investment'
  AND t.investment_kind IS NULL
  AND t.linked_account_id IS NULL
  AND t.regul_target IS NULL
  AND t.note ~* '(plus|moins|gain|perte)';

UPDATE public.transactions t
SET investment_kind = 'deposit'
FROM public.accounts a
WHERE a.id = t.account_id
  AND a.type = 'investment'
  AND t.investment_kind IS NULL
  AND t.linked_account_id IS NULL
  AND t.regul_target IS NULL
  AND t.amount > 0
  AND t.note ~* 'apport';

COMMENT ON COLUMN public.transactions.investment_kind IS
  'Compte d''investissement : nature de l''opération, posée à la saisie. gain/loss = plus ou '
  'moins-value (fait bouger la valeur, jamais l''apport) ; deposit = versement (fait bouger les '
  'deux). NULL partout ailleurs. Remplace la détection par libellé, que l''utilisateur pouvait '
  'casser en renommant sa transaction.';
