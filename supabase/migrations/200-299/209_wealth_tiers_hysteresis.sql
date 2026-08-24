-- ============================================================================
-- 209 — LES PALIERS DE PATRIMOINE CESSENT DE CLIGNOTER.
--
-- CE QUI SE PASSAIT
-- ─────────────────
-- Toute l'échelle des profils est protégée par une BANDE : le seuil à franchir pour MONTER n'est pas
-- celui sous lequel on REDESCEND. C'est ce qui empêche un profil de basculer d'avant en arrière
-- quand une mesure oscille autour d'un seuil.
--
-- Trois lignes y échappaient : P6_P7, P7_P8 et P8_P9. Elles portent, dans
-- `upgrade_months_threshold`, la RÉSERVE minimale exigée en plus du montant de patrimoine — mais
-- leur colonne `downgrade_months_threshold` était restée vide. Le moteur réutilisait donc le seuil
-- de montée pour décider de la descente : même valeur dans les deux sens, donc aucune bande.
--
-- Conséquence concrète, chez quelqu'un dont le matelas frôle six mois — et il bouge à chaque
-- saisie, puisque l'enveloppe de dépenses variables entre dans son dénominateur :
--
--     5,98 mois → P6     6,02 mois → P7     5,95 mois → P6 …
--
-- soit un changement de profil par opération saisie, chacun accompagné d'une fenêtre « ton profil a
-- changé » et d'une ligne dans le journal. Exactement ce que la bande existe pour empêcher, sur le
-- seul palier qui en était privé.
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
-- Elle sème la bande de sortie : CINQ mois pour se maintenir, six pour entrer. C'est la même bande
-- que P5_P6 (6 pour monter, 5 pour redescendre) — la chaîne des paliers reste donc lisible d'un
-- bout à l'autre, et le patrimoine n'est pas traité différemment du matelas.
--
-- Le code porte la même valeur de repli (`wealthMinMonthsDown`) : une instance qui n'aurait pas joué
-- cette migration se comporte exactement pareil. La configuration reste la source de vérité dès
-- qu'elle est lisible.
--
-- CE QUE ÇA NE CHANGE PAS
-- ───────────────────────
-- Le seuil de MONTÉE ne bouge pas : on entre en P7/P8/P9 aux mêmes conditions qu'avant. Personne ne
-- change de palier du fait de cette migration — on cesse seulement d'en changer pour rien.
-- ============================================================================

UPDATE public.profile_matrix_config
   SET downgrade_months_threshold = 5
 WHERE transition IN ('P6_P7', 'P7_P8', 'P8_P9')
   AND downgrade_months_threshold IS NULL;

-- ── LE MÊME OUBLI, SUR LE PALIER LE PLUS DUR À RECEVOIR ──────────────────────────────────────
-- La ligne P1_P2 porte la « réserve qui dispense de Fragile » : au-dessus, quelqu'un qui vit
-- volontairement sur son épargne (sabbatique, transition, création d'entreprise) n'est pas déclaré
-- en difficulté. Ce seuil n'avait, lui non plus, qu'UNE valeur pour les deux sens.
--
-- Or le matelas d'une personne en déficit bouge à chaque saisie — l'enveloppe de dépenses variables
-- est à son dénominateur. À 5,95 puis 6,05 mois, elle basculait « Fragile » ⇄ « Sécurité acquise » :
-- QUATRE paliers d'un coup, dans les deux sens, avec une fenêtre à chaque passage. C'est le
-- diagnostic le plus dur de l'app ; il ne peut pas clignoter.
--
-- Les colonnes « mois » de cette ligne n'étaient lues par personne (l'échelle du matelas commence à
-- P2_P3) : la colonne de descente accueille donc la borne de sortie de la dispense.
UPDATE public.profile_matrix_config
   SET downgrade_months_threshold = 5
 WHERE transition = 'P1_P2'
   AND downgrade_months_threshold IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT transition, upgrade_months_threshold, downgrade_months_threshold
--     FROM profile_matrix_config ORDER BY transition;
--   -- les trois lignes de patrimoine doivent afficher 6 / 5, comme P5_P6.
