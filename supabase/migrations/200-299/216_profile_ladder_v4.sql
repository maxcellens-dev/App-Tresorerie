-- ============================================================================
-- 216 — ÉCHELLE DES PROFILS v4 : le correctif que la 209 n'a jamais appliqué, et la fin de la
--       falaise « un euro placé ».
--
-- ── 1) LA BANDE DE « FRAGILE » N'A JAMAIS ÉTÉ POSÉE ─────────────────────────────────────────
-- La migration 209 devait donner sa bande d'hystérésis à la dispense de P1 : six mois de réserve
-- pour l'obtenir, cinq pour la perdre. Elle écrivait `downgrade_months_threshold = 5` sur la ligne
-- P1_P2 — mais sous la condition `AND downgrade_months_threshold IS NULL`, en croyant la colonne
-- vide (« ses colonnes mois n'étaient lues par personne »).
--
-- Elle ne l'était pas : la migration 020 y avait semé 0,5, un seuil de matelas de l'échelle d'alors.
-- Le garde-fou a donc bloqué le correctif, en silence, sur toutes les instances déjà installées.
--
-- Conséquence, pendant tout ce temps : la bande valait 6 / 0,5 au lieu de 6 / 5. Pour TOMBER en
-- « Fragile », il fallait un déficit structurel ET moins d'une demi-semaine de réserve. Quelqu'un
-- dont les charges dépassent durablement les revenus avec trois mois d'avance descendait
-- P5 → P4 → P3 → P2 en brûlant son épargne, sans jamais recevoir le seul diagnostic qui décrit sa
-- situation — il ne lui tombait dessus qu'au dernier euro.
--
-- Et rien ne pouvait le rattraper : le REPLI du code portait la bonne valeur (5), donc les tests,
-- qui tournent sur le repli, passaient au vert. Le code disait vrai, la base disait faux.
--
-- ── 2) « INVESTIR » CESSE D'ÊTRE UN BOOLÉEN À UN EURO ───────────────────────────────────────
-- `totalInvested > 0` ouvrait P6, et avec lui les paliers de patrimoine. Avec six mois de réserve
-- et 100 000 € sur un livret, UN EURO posé sur un compte d'investissement faisait passer de P5 à
-- P8 : trois paliers d'un coup, et une répartition du Relyka qui bascule de « Épargner 50 % » à
-- « Investir 70 % ». C'était la seule falaise de l'échelle — tout le reste a sa bande.
--
-- Deux réglages la suppriment :
--   • un MONTANT minimal réellement placé pour être considéré comme investisseur (ouvre P6) ;
--   • une PART du patrimoine réellement placée, exigée en plus par P7 → P9 : ces paliers prétendent
--     décrire un patrimoine PILOTÉ, et 500 € placés sur 300 000 € qui dorment ne décrivent pas ça.
--
-- Les deux sont portés par des colonnes que personne ne lisait sur ces lignes-là, plutôt que par de
-- nouvelles colonnes à moitié remplies ailleurs :
--   • le montant → colonnes « patrimoine » de la ligne P5_P6, qui EST le passage « il investit » ;
--   • la part    → deux colonnes ajoutées ici, sur la ligne P6_P7, lue une seule fois pour les trois
--     paliers de patrimoine (comme `chronic_overdraft_months` l'est sur P1_P2).
--
-- ⚠️ ORDRE DE DÉPLOIEMENT : cette migration AVANT l'OTA. L'inverse est sans danger — le code retombe
-- champ par champ sur ses valeurs de repli, qui sont exactement celles semées ici.
--
-- ⚠️ `PROFILE_LADDER_VERSION` passe à 4 côté client : le point 2 déplace réellement des gens, et le
-- reclassement doit donc se faire EN SILENCE (cf. financialProfileEngine). Personne ne reçoit « ton
-- profil a changé » pour une décision qu'il n'a pas prise.
-- ============================================================================

-- ── 1. La bande de la dispense de P1, cette fois sans garde-fou ──────────────────────────────
-- Sans `IS NULL` : c'est précisément ce garde-fou qui a fait échouer la 209.
UPDATE public.profile_matrix_config
   SET downgrade_months_threshold = 5
 WHERE transition = 'P1_P2';

-- ── 2. Le montant placé minimal (ouvre P6) ───────────────────────────────────────────────────
-- 500 € pour franchir : assez pour qu'un compte ouvert « pour voir » ne change pas de palier, assez
-- bas pour qu'un premier vrai versement compte tout de suite. 250 € pour se maintenir : un
-- portefeuille qui perd 20 % ne doit pas coûter un palier.
UPDATE public.profile_matrix_config
   SET upgrade_wealth_threshold = 500, downgrade_wealth_threshold = 250
 WHERE transition = 'P5_P6';

-- ── 3. La part du patrimoine réellement placée (exigée par P7 → P9) ─────────────────────────
ALTER TABLE public.profile_matrix_config
  ADD COLUMN IF NOT EXISTS invested_share_up   numeric,
  ADD COLUMN IF NOT EXISTS invested_share_down numeric;

COMMENT ON COLUMN public.profile_matrix_config.invested_share_up IS
  'Part du patrimoine (épargne + placements) devant être réellement placée pour ENTRER dans un palier de patrimoine (0,10 = 10 %). Ligne P6_P7 uniquement, lue pour les trois paliers.';
COMMENT ON COLUMN public.profile_matrix_config.invested_share_down IS
  'Part sous laquelle on QUITTE un palier de patrimoine (0,05 = 5 %). Toujours ≤ invested_share_up.';

UPDATE public.profile_matrix_config
   SET invested_share_up = 0.10, invested_share_down = 0.05
 WHERE transition = 'P6_P7';

-- ── 4. Les colonnes « montée » de P1_P2 ne gouvernent rien ───────────────────────────────────
-- L'échelle du matelas commence à P2_P3 : `upgrade_months_threshold` de la ligne P1_P2 n'est lu par
-- personne. Il valait 1 depuis la 020, et l'écran d'administration l'affichait sous le libellé
-- « Montée — mois de DÉPENSES couverts ≥ » : un réglage qu'on pouvait modifier sans effet, sur la
-- ligne la plus sensible de l'échelle. Le champ disparaît de l'écran (cf. admin/financial-profiles) ;
-- la colonne est vidée pour que personne ne la lise comme un réglage actif — c'est la règle posée
-- par la 194 (« un réglage sans effet est pire qu'un réglage absent »).
-- Ce que porte réellement cette ligne : viability_exit_ratio, viability_enter_ratio,
-- viability_grace_months (entrée/sortie de P1), downgrade_months_threshold (sortie de la dispense)
-- et chronic_overdraft_months.
UPDATE public.profile_matrix_config
   SET upgrade_months_threshold = NULL
 WHERE transition = 'P1_P2';

-- ── 5. Les messages qui contredisaient la répartition affichée ──────────────────────────────
-- La répartition par palier se règle en administration (`profile_allocations`), et elle a été
-- recalibrée : plus aucun investissement recommandé tant que la réserve n'est pas pleine (P0→P4 à
-- 0 %), une première part placée dès que le matelas est fait (P5). Deux messages promettaient le
-- contraire, juste au-dessus des pourcentages appliqués.
-- ⚠️ SEULS LES CORPS CHANGENT. Les titres ont été volontairement RACCOURCIS par la migration 159 :
-- ils reprenaient le nom du profil, que la carte juste en dessous affiche déjà, et tenaient sur deux
-- lignes — la feuille dépassait alors la hauteur utile et le bouton passait sous la barre système.
UPDATE public.profile_notification_messages
   SET body = 'Trois mois de dépenses de côté : ta situation est stable. Dernière ligne droite jusqu''à six mois — c''est à partir de là que placer une part de ton épargne aura du sens.',
       updated_at = now()
 WHERE transition = 'P3_P4' AND direction = 'upgrade';

UPDATE public.profile_notification_messages
   SET body = 'Plus de six mois de dépenses couverts : ton matelas est fait. Tu peux commencer à en placer une part, sans toucher à ta réserve.',
       updated_at = now()
 WHERE transition = 'P4_P5' AND direction = 'upgrade';

-- P6 s'appelle désormais « Placements lancés » : l'investissement COMMENCE en P5, où l'app le
-- propose pour la première fois — P6 constate qu'il a eu lieu. On retire au passage la promesse de
-- « régularité », que plus rien ne mesure depuis que le taux d'épargne est sorti du classement
-- (migration 206) — et on raccourcit ce titre-là, semé par la 182 après le passage de la 159.
UPDATE public.profile_notification_messages
   SET title = '🌍 Tes placements sont lancés',
       body  = 'Réserve solide et argent réellement placé : tu es passé de l''épargne à l''investissement. La part investie prend désormais le dessus dans ce que Relyka te recommande.',
       updated_at = now()
 WHERE transition = 'P5_P6' AND direction = 'upgrade';

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT transition, upgrade_months_threshold, downgrade_months_threshold,
--          upgrade_wealth_threshold, downgrade_wealth_threshold,
--          invested_share_up, invested_share_down, viability_grace_months
--     FROM profile_matrix_config ORDER BY transition;
--
--   -- P1_P2 : montée VIDE, descente 5, grâce 6           → la bande de « Fragile » est enfin 6 / 5
--   -- P5_P6 : patrimoine 500 / 250                       → montant placé minimal
--   -- P6_P7 : part 0,10 / 0,05 + patrimoine 30000/24000  → patrimoine piloté
--
--   SELECT ladder_version, count(*) FROM user_financial_profile GROUP BY 1;
--   -- 3 partout au départ ; passe à 4 au fil des ouvertures, sans notification.
