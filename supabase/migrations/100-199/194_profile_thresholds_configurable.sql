-- ============================================================================
-- 194 — LES SEUILS DE PROFIL DEVIENNENT RÉELLEMENT RÉGLABLES.
--
-- L'écran d'administration proposait depuis longtemps de régler « Montée — mois de dépenses
-- couverts ≥ » et « Descente — < », en affichant même l'écart d'hystérésis obtenu. Mais plus rien
-- ne lisait ces valeurs : le moteur de profil portait ses seuils en dur (1 / 3 / 6 mois, 10 % et
-- 20 % de taux d'épargne, 30k / 100k / 300k de patrimoine). On croyait calibrer ; le comportement
-- ne bougeait pas d'un iota. Un réglage sans effet est pire qu'un réglage absent.
--
-- Le moteur lit désormais `profile_matrix_config` (cf. `thresholdsFromMatrix`). Cette migration :
--   1. ajoute ce qui manquait à la table pour tout exprimer (patrimoine, découvert chronique) ;
--   2. ALIGNE les valeurs existantes sur celles qui étaient codées en dur.
--
-- Le point 2 est essentiel : le basculement doit être NEUTRE. Personne ne doit changer de palier
-- parce qu'on a rebranché un fil. Les seuils semés en migration 182 avaient été écrits pour l'autre
-- moteur (celui à compteurs mensuels, aujourd'hui débranché) et ne correspondaient pas au calcul
-- réellement appliqué — les recopier tels quels aurait déplacé des utilisateurs sans raison.
--
-- ── CE QUE SIGNIFIENT LES DEUX SEUILS ───────────────────────────────────────────────────────
-- `upgrade_*` = le niveau à ATTEINDRE pour monter. `downgrade_*` = celui sous lequel on REDESCEND.
-- L'écart entre les deux est la bande d'hystérésis, et elle est volontairement ASYMÉTRIQUE : on
-- monte dès que le but est atteint (six mois de réserve, c'est un accomplissement — le dire le
-- lendemain serait mesquin), on ne redescend que sur une vraie rechute. Un mois difficile ne fait
-- pas perdre son palier.
-- ============================================================================

-- ── 1) Ce qui manquait pour tout exprimer ───────────────────────────────────────────────────
ALTER TABLE public.profile_matrix_config
  ADD COLUMN IF NOT EXISTS upgrade_wealth_threshold   numeric,
  ADD COLUMN IF NOT EXISTS downgrade_wealth_threshold numeric,
  ADD COLUMN IF NOT EXISTS chronic_overdraft_months   integer;

COMMENT ON COLUMN public.profile_matrix_config.upgrade_wealth_threshold IS
  'Patrimoine bancaire (€) à atteindre pour ce palier. Ne concerne que P6_P7, P7_P8, P8_P9.';
COMMENT ON COLUMN public.profile_matrix_config.downgrade_wealth_threshold IS
  'Patrimoine sous lequel on quitte ce palier. Toujours ≤ upgrade_wealth_threshold (hystérésis).';
COMMENT ON COLUMN public.profile_matrix_config.chronic_overdraft_months IS
  'Mois consécutifs dans le rouge à partir desquels le découvert est CHRONIQUE (lu sur la ligne P1_P2).';

-- ── 2) Alignement sur le calcul réellement appliqué ─────────────────────────────────────────
-- Matelas : les seuils de MONTÉE sont ceux du moteur (1 / 3 / 6 mois). Les seuils de DESCENTE
-- gardent la bande large déjà semée — c'est elle qui empêche le profil de clignoter.
UPDATE public.profile_matrix_config SET upgrade_months_threshold = 1,   downgrade_months_threshold = 0.5 WHERE transition = 'P2_P3';
UPDATE public.profile_matrix_config SET upgrade_months_threshold = 3,   downgrade_months_threshold = 1   WHERE transition = 'P3_P4';
UPDATE public.profile_matrix_config SET upgrade_months_threshold = 6,   downgrade_months_threshold = 2.5 WHERE transition = 'P4_P5';
UPDATE public.profile_matrix_config SET upgrade_months_threshold = 6,   downgrade_months_threshold = 5   WHERE transition = 'P5_P6';

-- Taux d'épargne : 10 % (« il met de côté ») et 20 % (« fort taux », qui ouvre P4 par raccourci).
-- La 182 avait semé 5 % et 10 % — des valeurs pensées pour l'autre moteur.
UPDATE public.profile_matrix_config SET upgrade_flux_threshold = 10 WHERE transition = 'P2_P3';
UPDATE public.profile_matrix_config SET upgrade_flux_threshold = 20 WHERE transition = 'P3_P4';

-- Paliers de PATRIMOINE. `upgrade_months_threshold` y porte la RÉSERVE minimale exigée en plus du
-- montant : trois mois pour P7, six pour P8 et P9 (plus le patrimoine est important, plus l'absence
-- de liquidité est anormale). La bande de sortie est fixée à ~15 % sous le seuil d'entrée : un
-- portefeuille qui respire ne doit pas faire changer quelqu'un de profil toutes les semaines.
UPDATE public.profile_matrix_config
   SET upgrade_months_threshold = 3, upgrade_wealth_threshold =  30000, downgrade_wealth_threshold =  24000
 WHERE transition = 'P6_P7';
UPDATE public.profile_matrix_config
   SET upgrade_months_threshold = 6, upgrade_wealth_threshold = 100000, downgrade_wealth_threshold =  85000
 WHERE transition = 'P7_P8';
UPDATE public.profile_matrix_config
   SET upgrade_months_threshold = 6, upgrade_wealth_threshold = 300000, downgrade_wealth_threshold = 260000
 WHERE transition = 'P8_P9';

-- Découvert chronique : deux mois consécutifs. Porté par la ligne P1_P2, qui gouverne l'entrée et
-- la sortie du palier déficitaire.
UPDATE public.profile_matrix_config SET chronic_overdraft_months = 2 WHERE transition = 'P1_P2';

-- Filet : si une instance n'a jamais reçu le seed de la 182, on ne laisse aucune ligne sans valeur
-- de patrimoine là où elle est attendue.
UPDATE public.profile_matrix_config SET chronic_overdraft_months = 2
 WHERE chronic_overdraft_months IS NULL AND transition = 'P1_P2';

NOTIFY pgrst, 'reload schema';
