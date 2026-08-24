-- ============================================================================
-- 208 — LES CONSEILS CESSENT D'ÊTRE LIBELLÉS EN EUROS.
--
-- POURQUOI
-- ────────
-- L'app gère une centaine de devises (compte multi-devises + devise de référence par profil), et
-- chaque montant affiché passe par le symbole du profil. Sauf les CONSEILS : leur texte porte un
-- « € » écrit en dur, juste après la variable interpolée.
--
--     « {budgetlibre}€ restent chaque mois sans destination précise. »
--
-- Résultat, pour quelqu'un dont la devise de référence est le franc suisse : son tableau de bord
-- affiche « 1 200 CHF » et le bandeau juste au-dessus « 1 200€ ». Le même montant, deux monnaies.
-- C'est le genre de détail qui fait douter de tout le reste.
--
-- CE QUE FAIT CETTE MIGRATION
-- ───────────────────────────
-- Le « € » collé à une variable devient `{devise}`, une variable comme les autres. Le client la
-- remplace par le symbole du profil au moment de l'affichage (cf. `interpolate` dans
-- hooks/pilotage/useConseils.ts — elle est fournie là, et pas par les appelants, pour qu'aucun
-- conseil ne puisse l'oublier).
--
-- On en profite pour poser une ESPACE avant le symbole : « 1 200 € » est la typographie française
-- correcte, et « 1 200CHF » aurait été illisible sans elle.
--
-- PORTÉE VOLONTAIREMENT ÉTROITE
-- ─────────────────────────────
-- Seuls les « € » qui suivent immédiatement une variable sont touchés. Les messages de PALIER
-- (`profile_notification_messages`) citent des seuils absolus (« au-delà de 30 000 € ») : ce sont
-- les bornes de l'échelle elle-même, calibrées en euros — les convertir serait une décision produit,
-- pas une correction d'affichage. Elles sont laissées telles quelles.
--
-- Rejouable : la substitution est idempotente (une fois `{devise}` en place, il n'y a plus de « }€ »
-- à remplacer).
-- ============================================================================

UPDATE public.conseils
   SET message = replace(message, '}€', '} {devise}')
 WHERE message LIKE '%}€%';

NOTIFY pgrst, 'reload schema';

-- ── Vérification après coup ──────────────────────────────────────────────────────────────────
--   SELECT critere_key, message FROM conseils WHERE message LIKE '%€%';
--   -- ne doit plus rien rendre : plus aucun conseil n'impose l'euro.
