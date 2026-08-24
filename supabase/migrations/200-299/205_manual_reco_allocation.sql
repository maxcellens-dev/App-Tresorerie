-- ============================================================================
-- 205 — RÉPARTITION MANUELLE DES RECOMMANDATIONS.
--
-- POURQUOI
-- ────────
-- La répartition du Relyka (Épargner / Investir / Confort / Conserver) découle du PROFIL FINANCIER,
-- lui-même déduit des données réelles. C'est le bon réglage par défaut — mais il n'y a jamais eu de
-- porte de sortie : quelqu'un qui sait exactement ce qu'il veut faire de son surplus (« 60 % en
-- investissement, quoi qu'en pense l'app ») n'avait aucun moyen de le dire.
--
-- CE QUE CETTE MIGRATION AJOUTE
-- ─────────────────────────────
--   • `reco_mode` : 'auto' (le profil décide, défaut) ou 'manual' (l'utilisateur décide).
--   • quatre pourcentages, la répartition CHOISIE.
--
-- CE QU'ELLE NE CHANGE PAS, ET C'EST L'ESSENTIEL
-- ──────────────────────────────────────────────
-- En mode manuel, ces quatre pourcentages remplacent EXACTEMENT la table du palier
-- (`PROFILE_ALLOCATIONS`) — rien d'autre. Tout ce qui vient après continue de s'appliquer à
-- l'identique : les bornes de la priorité du mois (investissement à 0 % tant qu'il n'y a pas un mois
-- de réserve…), les modificateurs contextuels, la normalisation à 100 %, les seuils d'affichage et
-- le garde-fou de projection. Choisir ses pourcentages, ce n'est pas désactiver les garde-fous :
-- c'est se donner un profil sur mesure. C'est aussi pour cela qu'on ne touche pas au profil
-- financier lui-même — il continue d'être calculé en arrière-plan (cf. useLiveProfileSync), pour
-- rester juste le jour où l'utilisateur revient en automatique.
--
-- ⚠️ NE PAS RÉUTILISER `allocation_*_percent` (les colonnes historiques) : elles sont RÉÉCRITES à
-- chaque changement de profil par le moteur vivant. Y ranger un choix utilisateur revenait à le
-- faire effacer par le premier virement d'épargne venu.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reco_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS manual_alloc_save_percent   integer,
  ADD COLUMN IF NOT EXISTS manual_alloc_invest_percent integer,
  ADD COLUMN IF NOT EXISTS manual_alloc_enjoy_percent  integer,
  ADD COLUMN IF NOT EXISTS manual_alloc_keep_percent   integer;

-- Deux valeurs, pas trois : un mode inconnu ferait retomber le client sur l'automatique sans le
-- dire, ce qui est exactement le genre de silence qu'on ne veut pas sur un réglage visible.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_reco_mode_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_reco_mode_check CHECK (reco_mode IN ('auto', 'manual'));

/* Chaque pourcentage est borné 0–100 SÉPARÉMENT ; la somme, elle, n'est PAS contrainte ici.
   Raison : l'écran enregistre les quatre valeurs en une seule mise à jour, mais une contrainte de
   somme ferait échouer toute écriture partielle future (une seule colonne modifiée) et transformerait
   un réglage en source d'erreurs 400. La règle « somme = 100 » est tenue là où elle a du sens : le
   client refuse d'enregistrer autre chose, et le moteur IGNORE une répartition qui ne fait pas 100
   (cf. lib/finance/recoMode → readManualAllocation) — il retombe alors sur le profil, jamais sur une
   répartition à moitié écrite. */
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_manual_alloc_range_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_manual_alloc_range_check CHECK (
    (manual_alloc_save_percent   IS NULL OR manual_alloc_save_percent   BETWEEN 0 AND 100)
    AND (manual_alloc_invest_percent IS NULL OR manual_alloc_invest_percent BETWEEN 0 AND 100)
    AND (manual_alloc_enjoy_percent  IS NULL OR manual_alloc_enjoy_percent  BETWEEN 0 AND 100)
    AND (manual_alloc_keep_percent   IS NULL OR manual_alloc_keep_percent   BETWEEN 0 AND 100)
  );

COMMENT ON COLUMN public.profiles.reco_mode IS
  'Qui décide de la répartition du Relyka : ''auto'' = le profil financier (défaut), ''manual'' = les manual_alloc_*_percent ci-dessous.';
COMMENT ON COLUMN public.profiles.manual_alloc_save_percent IS
  'Répartition CHOISIE (mode manuel) — remplace la table du palier, avant les bornes de la priorité du mois. Les quatre doivent totaliser 100, sinon le mode manuel est ignoré.';

NOTIFY pgrst, 'reload schema';
