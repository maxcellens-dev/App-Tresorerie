# Sécurité — Relyka

## 1. Centre de sécurité (admin)

Écran : **Admin → Sécurité → Centre de sécurité** (`app/(tabs)/(secondary)/admin/security.tsx`).
Migration : `148_security_center.sql`.

### Coupure globale (kill switch)
- Drapeau `app_config.features.app_lockdown_enabled` (via `useFeatureFlags` / `useSaveFeatureFlags`).
- Propagation **temps réel** : `app_config` est publié dans `supabase_realtime` ; le hook `useAppLockdown`
  ré-invalide les flags dès qu'un changement tombe → bascule quasi instantanée sur tous les appareils.
- Rendu : `components/SecurityGate.tsx` (voile plein écran, monté au niveau racine). Les **admins ne
  sont pas bloqués** (bandeau d'alerte + accès direct au Centre pour rouvrir).
- `is_app_locked()` (SQL) expose l'état — base d'un futur durcissement RLS des écritures.

> ⚠️ **Limite** : le verrou agit **côté client**. Contre une attaque frappant l'API Supabase en direct
> (JWT volé, script), le rempart ultime reste :
> 1. **Mettre le projet Supabase en pause** (Dashboard → Settings → General → Pause project) ;
> 2. **Faire tourner les clés** (anon + service_role) et **révoquer les sessions** (`auth.admin.signOut` / rotation JWT secret) ;
> 3. Le cas échéant, restaurer depuis une sauvegarde PITR.

### Détection des crashs & erreurs
- L'app remonte ses exceptions via `lib/errorReporting.ts` (handler global `ErrorUtils`, `unhandledrejection`,
  et `components/GlobalErrorBoundary.tsx` pour les erreurs de rendu React).
- Écriture par l'RPC bornée `log_client_error` (ouverte à `anon`/`authenticated`, dédoublonnée et throttlée
  côté client, taille limitée côté serveur). Lecture/résolution réservées aux admins (RLS `is_app_admin`).
- Purge : `client_errors_purge()` (entrées > 30 jours).

## 2. Mots de passe (comptes e-mail)

- Politique unique : `lib/passwordPolicy.ts` — **≥ 12 caractères, 1 majuscule, 1 minuscule, 1 chiffre,
  1 caractère spécial**, et refus des suites/mots trop courants. Jauge : `components/PasswordStrength.tsx`.
- Appliquée à l'**inscription** (`app/register.tsx`), à la **réinitialisation** (`app/reset-password.tsx`)
  et à la réinitialisation **admin**.
- **Réinitialisation admin** (repli sans messagerie) : Edge Function `admin-set-password`
  (service role, `auth.admin.updateUserById`) — appelant vérifié admin, mot de passe re-validé côté serveur.

### À configurer côté Supabase (une fois, hors code)
Dashboard → **Authentication → Policies / Passwords** :
- **Minimum length = 12**.
- **Required characters** : lettres majuscules + minuscules + chiffres + symboles.
- Activer **Leaked password protection** (HaveIBeenPwned).
- (Recommandé) Réduire la durée de vie des liens de récupération et activer la limite de tentatives.

Ces réglages serveur **doublent** la validation client (jamais confiance au client seul).
