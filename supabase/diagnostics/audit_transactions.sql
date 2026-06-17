-- =====================================================================
-- DIAGNOSTIC — cohérence transactions / soldes
-- Requêtes 100% LECTURE (aucune écriture). Compatibles éditeur SQL Supabase.
--
-- Par défaut chaque requête balaie TOUTE la base. Pour la restreindre à un
-- profil, ajoute `AND profile_id = 'TON-UUID'` (ou `AND a.profile_id = '...'`
-- pour la requête 6) dans le WHERE.
--
-- Contexte : avant le correctif, valider un virement de projet pouvait créer une
-- jambe manquante, porter des dates futures au solde, ou supprimer du « validé »
-- sans réverser le solde. Ces requêtes repèrent les résidus de ces incohérences.
-- =====================================================================

-- 1) VIREMENTS À UNE SEULE JAMBE -------------------------------------------------
--    Une transaction « virement » VALIDÉE (non brouillon) dont la jambe opposée
--    (compte croisé, même date, montant opposé) est ABSENTE.
--    → les anciennes validations de projet sans crédit de destination.
--    NB : on EXCLUT les brouillons (is_draft), qui n'ont qu'une jambe par design
--    (le crédit de destination n'est créé qu'à la validation).
SELECT t.id, t.date, t.amount, t.account_id, t.linked_account_id,
       t.project_id, t.is_draft, t.posted, t.note
FROM transactions t
WHERE t.linked_account_id IS NOT NULL
  AND COALESCE(t.is_draft, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM transactions p
    WHERE p.profile_id = t.profile_id
      AND p.account_id = t.linked_account_id
      AND p.linked_account_id = t.account_id
      AND p.date = t.date
      AND p.amount = -t.amount
  )
ORDER BY t.date DESC;

-- 2) FUTUR MARQUÉ « porté au solde » (posted=true) -------------------------------
--    Une transaction NON-brouillon, NON-récurrente, datée dans le futur, ne doit
--    PAS être dans le solde (posted doit être false). Si posted=true ici, son
--    montant a été indûment ajouté au solde et ne sera jamais re-réconcilié.
SELECT id, date, amount, account_id, project_id, note
FROM transactions
WHERE COALESCE(is_draft, false) = false
  AND COALESCE(is_recurring, false) = false
  AND date > current_date
  AND COALESCE(posted, true) = true
ORDER BY date;

-- 3) ÉCHU NON PORTÉ (posted=false alors que date <= aujourd'hui) ------------------
--    Inverse du précédent : devrait être porté par reconcile_posted() au prochain
--    démarrage de l'app. S'il en reste beaucoup, reconcile_posted ne tourne pas.
SELECT id, date, amount, account_id, project_id, note
FROM transactions
WHERE COALESCE(is_draft, false) = false
  AND COALESCE(is_recurring, false) = false
  AND date <= current_date
  AND COALESCE(posted, true) = false
ORDER BY date;

-- 4) TRANSACTIONS ORPHELINES (projet supprimé) ----------------------------------
--    project_id pointant vers un projet inexistant (delete projet n'ayant pas
--    nettoyé/détaché ses transactions).
SELECT t.id, t.date, t.amount, t.account_id, t.project_id, t.is_draft, t.posted
FROM transactions t
WHERE t.project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id)
ORDER BY t.date DESC;

-- 5) BROUILLON marqué posted=true ------------------------------------------------
--    Un brouillon ne contribue jamais au solde ; posted devrait être false/ignoré.
--    (Informatif : sans impact tant que is_draft=true, mais signale un état sale.)
SELECT id, date, amount, account_id, project_id, note
FROM transactions
WHERE COALESCE(is_draft, false) = true
  AND COALESCE(posted, true) = true
ORDER BY date DESC;

-- 6) CONTRÔLE DE SOLDE (approx.) -------------------------------------------------
--    Compare le solde stocké à la somme des lignes « portées » (posted, non-brouillon).
--    NOTE : approximatif si le compte a des « régularisations de solde » (§P12) qui
--    fixent un point absolu — dans ce cas, un écart n'est pas forcément une erreur.
--    Sert à repérer les comptes à inspecter en priorité (gros écart inexpliqué).
SELECT a.id, a.name, a.type,
       a.balance                                   AS solde_stocke,
       COALESCE(SUM(
         CASE WHEN COALESCE(t.is_draft,false)=false
               AND COALESCE(t.posted,true)=true
              THEN t.amount ELSE 0 END), 0)         AS somme_portee,
       a.balance - COALESCE(SUM(
         CASE WHEN COALESCE(t.is_draft,false)=false
               AND COALESCE(t.posted,true)=true
              THEN t.amount ELSE 0 END), 0)         AS ecart
FROM accounts a
LEFT JOIN transactions t
  ON t.account_id = a.id AND t.profile_id = a.profile_id
GROUP BY a.id, a.name, a.type, a.balance
ORDER BY ABS(a.balance - COALESCE(SUM(
         CASE WHEN COALESCE(t.is_draft,false)=false
               AND COALESCE(t.posted,true)=true
              THEN t.amount ELSE 0 END), 0)) DESC;


-- =====================================================================
-- RÉPARATION (ÉCRITURES) — à lancer SÉPARÉMENT et en connaissance de cause.
-- =====================================================================

-- R1) HYGIÈNE : aligner le drapeau `posted` des BROUILLONS sur false.
--     Sûr et idempotent : un brouillon ne contribue jamais au solde (balanceContribution
--     l'ignore, reconcile_posted/matérialisation excluent is_draft=true). Met juste les
--     données au propre (les nouveaux brouillons sont déjà posés à false côté app).
-- UPDATE transactions SET posted = false
-- WHERE COALESCE(is_draft, false) = true AND COALESCE(posted, true) = true;

-- R2) SOLDE DÉRIVÉ (écart NÉGATIF en requête 6) — NE PAS corriger en aveugle.
--     Un écart négatif (ex. compte courant débité plus que ses transactions) = dérive
--     des anciens delete projet non réversés. La bonne méthode : poser le solde réel via
--     l'app (Compte → « Nouveau Solde »/régularisation), qui crée une ligne traçable.
--     Si tu préfères le SQL, fixe-le explicitement compte par compte (remplace les valeurs) :
-- UPDATE accounts SET balance = <SOLDE_REEL> WHERE id = '<ACCOUNT_ID>';
