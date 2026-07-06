-- ============================================================================
-- 126 — Différé de remboursement : mode de traitement des intérêts du différé TOTAL.
--
-- 'capitalized' : les intérêts du différé s'ajoutent au capital (comportement historique de l'app).
-- 'deferred'    : les intérêts vont dans un compteur SÉPARÉ (le CRD ne bouge pas), remboursé EN
--                 PRIORITÉ par les premières mensualités avant tout amortissement du capital —
--                 pratique courante des banques françaises (colonne « Total des intérêts différés »
--                 des échéanciers LCL/CA…). Validé au centime contre un échéancier LCL réel.
--
-- NB : le moteur (lib/amortization.ts) ajoute désormais le différé EN TÊTE du tableau :
-- duration_months = nombre d'échéances REMBOURSÉES (comme sur le contrat), le différé s'ajoute.
-- `interim_interest` (existant) sert de valeur RÉELLE des intérêts intercalaires quand un différé
-- est actif (remplace l'estimation auto — utile si le capital est débloqué par tranches).
-- ============================================================================

ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS deferral_interest_mode text NOT NULL DEFAULT 'capitalized'
  CHECK (deferral_interest_mode IN ('capitalized', 'deferred'));

-- Recharge le cache de schéma PostgREST (sinon « column not found in schema cache » côté API).
NOTIFY pgrst, 'reload schema';
