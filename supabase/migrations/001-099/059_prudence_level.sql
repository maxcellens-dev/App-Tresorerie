-- Migration 059 : Curseur de « prudence » (trésorerie adaptative).
--
-- Pilote la confiance accordée aux revenus non-saisis (inférés de l'historique) pour le
-- budget libre, et l'horizon du garde-fou de projection des recommandations.
-- NULL = valeur par défaut dérivée du profil (allocations). 0 = peu prudent, 100 = très prudent.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS prudence_level INT;
