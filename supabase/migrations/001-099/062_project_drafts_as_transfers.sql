-- Les brouillons de projet vers un autre compte (épargne / investissement) étaient créés comme
-- des dépenses (catégorie « Projets », sans linked_account_id) → ils apparaissaient à tort dans
-- les dépenses. On les convertit en VIREMENTS (linked_account_id = compte de destination du projet).
-- Les réservations même-compte (is_reserved) ne sont pas touchées.
UPDATE public.transactions t
SET linked_account_id = p.linked_account_id,
    category_id = NULL
FROM public.projects p
WHERE t.project_id = p.id
  AND t.is_draft = true
  AND t.linked_account_id IS NULL
  AND COALESCE(t.is_reserved, false) = false
  AND p.linked_account_id IS NOT NULL
  AND p.source_account_id IS DISTINCT FROM p.linked_account_id;
