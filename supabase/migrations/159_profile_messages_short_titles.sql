-- ============================================================================
-- 159 — Messages de changement de profil : TITRES COURTS.
--
-- Les titres reprenaient le nom du profil (« 🌿 Tu passes au profil "Réserve à construire" ») alors
-- que la carte juste en dessous l'affiche déjà, avec son emoji et son sous-titre. Sur un téléphone,
-- ce titre tenait sur DEUX lignes : la feuille dépassait la hauteur utile et le bouton « J'ai
-- compris » se retrouvait sous la barre de navigation du système.
--
-- On garde donc l'emoji (le repère visuel du profil) et on dit ce qui se passe, sans redite.
-- Les CORPS de message ne changent pas.
--
-- ⚠ La migration 145 (qui a semé ces messages) est déjà appliquée : elle ne peut plus être modifiée.
-- Les mêmes textes courts existent en REPLI dans components/ProfileChangeModal (DEFAULT_MESSAGES).
-- ============================================================================

UPDATE public.profile_notification_messages SET title = '🌿 Tu changes de profil',  updated_at = now() WHERE transition = 'P1_P2' AND direction = 'upgrade';
UPDATE public.profile_notification_messages SET title = '⚖️ Tu changes de profil', updated_at = now() WHERE transition = 'P2_P3' AND direction = 'upgrade';
UPDATE public.profile_notification_messages SET title = '🚀 Tu changes de profil',  updated_at = now() WHERE transition = 'P3_P4' AND direction = 'upgrade';
UPDATE public.profile_notification_messages SET title = '🎯 Tu changes de profil',  updated_at = now() WHERE transition = 'P4_P5' AND direction = 'upgrade';

UPDATE public.profile_notification_messages SET title = '🌱 Ton profil évolue',  updated_at = now() WHERE transition = 'P1_P2' AND direction = 'downgrade';
UPDATE public.profile_notification_messages SET title = '🌿 Ton profil évolue',  updated_at = now() WHERE transition = 'P2_P3' AND direction = 'downgrade';
UPDATE public.profile_notification_messages SET title = '⚖️ Ton profil évolue', updated_at = now() WHERE transition = 'P3_P4' AND direction = 'downgrade';
UPDATE public.profile_notification_messages SET title = '🚀 Ton profil évolue',  updated_at = now() WHERE transition = 'P4_P5' AND direction = 'downgrade';

UPDATE public.profile_notification_messages SET title = '🌱 Tu conserves le profil',  updated_at = now() WHERE transition = 'P1' AND direction = 'same';
UPDATE public.profile_notification_messages SET title = '🌿 Tu conserves le profil',  updated_at = now() WHERE transition = 'P2' AND direction = 'same';
UPDATE public.profile_notification_messages SET title = '⚖️ Tu conserves le profil', updated_at = now() WHERE transition = 'P3' AND direction = 'same';
UPDATE public.profile_notification_messages SET title = '🚀 Tu conserves le profil',  updated_at = now() WHERE transition = 'P4' AND direction = 'same';
UPDATE public.profile_notification_messages SET title = '🎯 Tu conserves le profil',  updated_at = now() WHERE transition = 'P5' AND direction = 'same';

-- Les deux messages « exceptionnels » gardent leur titre : ils n'ont pas de nom de profil à répéter,
-- et leur formulation explique la cause (baisse de revenus) — c'est justement l'information utile.
