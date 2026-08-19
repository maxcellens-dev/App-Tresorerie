-- ============================================================================
-- 183 — URGENCE : ramener tous les profils dans l'intervalle P1–P5.
--
-- CE QUI S'EST PASSÉ
-- ──────────────────
-- La migration 182 renumérotait les profils existants (ancien P5 → nouveau P6, etc.). Une migration
-- s'applique à la BASE ; le code, lui, arrive plus tard sur les appareils. Entre les deux, chaque
-- application déjà installée a lu un identifiant qu'elle ne connaissait pas :
--       DEFAULT_PULSE_SIGNALS['P6']  →  undefined
--       monthlyIds(undefined).filter →  TypeError, écran mort
-- L'app ne s'ouvrait plus, en production, pour tout le monde à la fois. C'est ce que montrent les
-- crashs « Cannot read property 'filter' of undefined » sur /pilotage.
--
-- POURQUOI CETTE MIGRATION-CI EST LE SEUL REMÈDE IMMÉDIAT
-- ───────────────────────────────────────────────────────
-- Le correctif de code (resolveProfileId : un identifiant inconnu est ramené sur l'échelle au lieu
-- de faire tomber l'écran) n'existe que dans la version PAS ENCORE DÉPLOYÉE. Il ne protège donc
-- aucun des appareils actuellement cassés. La seule chose qu'on puisse changer tout de suite, c'est
-- la donnée qu'ils lisent : on la remet dans le vocabulaire qu'ils connaissent.
--
-- P1–P5 est le PLUS PETIT DÉNOMINATEUR COMMUN aux deux versions :
--   • l'ancienne application les comprend tous → elle redémarre, immédiatement ;
--   • la nouvelle aussi (ils font partie du référentiel P0–P9), et son « profil vivant »
--     (useLiveProfileSync) RECALCULE de toute façon chaque profil depuis les données réelles dès la
--     première ouverture. Le bon palier revient donc tout seul, appareil par appareil, au rythme
--     des mises à jour — sans jamais réécrire un identifiant que le client ne saurait pas lire.
--
-- La table `profile_matrix_config` et les messages P5_P6…P8_P9 posés par la 182 restent en place :
-- ils ne sont lus que par la nouvelle version, et une ligne inutilisée ne casse rien.
--
-- ⚠️ RÈGLE À RETENIR — ne jamais RENUMÉROTER en base une valeur d'énumération que le client
-- interprète. On peut en AJOUTER (les anciennes versions ne les rencontrent pas), jamais déplacer
-- le sens des existantes tant que tout le parc ne sait pas les absorber.
-- ============================================================================

-- Tout ce qui sort de l'intervalle historique y est ramené :
--   P0 (Découverte, introuvable dans l'ancienne échelle) → P1, le plus prudent, comme avant elle ;
--   P6 et au-delà                                        → P5, le plus haut que l'ancienne connaît.
UPDATE public.user_financial_profile
SET profile_id = CASE
      WHEN profile_id IN ('P1','P2','P3','P4','P5') THEN profile_id
      WHEN profile_id = 'P0' THEN 'P1'
      ELSE 'P5'
    END
WHERE profile_id NOT IN ('P1','P2','P3','P4','P5');

-- L'historique des changements de profil est purement informatif (il alimente les statistiques
-- admin), mais autant qu'il ne contienne pas des paliers que l'app d'alors ne savait pas nommer.
UPDATE public.profile_change_log
SET new_profile = CASE WHEN new_profile = 'P0' THEN 'P1' ELSE 'P5' END
WHERE new_profile NOT IN ('P1','P2','P3','P4','P5');

UPDATE public.profile_change_log
SET previous_profile = CASE WHEN previous_profile = 'P0' THEN 'P1' ELSE 'P5' END
WHERE previous_profile IS NOT NULL AND previous_profile NOT IN ('P1','P2','P3','P4','P5');

NOTIFY pgrst, 'reload schema';
