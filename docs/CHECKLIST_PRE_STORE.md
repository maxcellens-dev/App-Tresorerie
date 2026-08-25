# Checklist avant publication (stores)

Complète `docs/SECURITY.md` (qui décrit les mécanismes en place) : ici, **ce qui se vérifie hors du
dépôt** — consoles Google/Apple/Supabase — et qu'aucun test ni `tsc` ne peut attraper.

Convention : ✅ vérifié dans le dépôt · ⬜ à vérifier dans une console externe.

---

## 1. Secrets et fichiers versionnés

- ✅ `.env` et `.env.*` sont ignorés (`.gitignore`), tout comme `*.jks` et `*.p8` (keystores et clés APNs).
- ✅ `eas.json` contient `EXPO_PUBLIC_SUPABASE_ANON_KEY` **en clair — et c'est normal** : la clé `anon`
  est publique par conception, elle est embarquée dans chaque binaire. Sa seule protection est la RLS.
  Corollaire : **toute faille RLS est une fuite de données**, pas une fuite de clé.
  → cf. la note `rls-not-a-list-filter` : une policy admin en `OR` transforme un `select('*')` nu en
  export de la base entière. Chaque liste doit filtrer explicitement, jamais s'en remettre à la RLS.
- ⬜ `SUPABASE_SERVICE_ROLE_KEY` : présente **uniquement** dans les variables d'environnement des Edge
  Functions, jamais dans le dépôt ni dans un `EXPO_PUBLIC_*`.
- ⬜ `JITPACK_TOKEN` : sorti de `eas.json` — **la rotation reste à faire** (le jeton a été exposé).
- ⬜ `BREVO_API_KEYS`, clé Gemini (conseils IA), clés RevenueCat : côté serveur seulement.

## 2. Google Cloud / Firebase

- ✅ `google-services.json` est versionné. Ce n'est **pas un secret** (il est extractible de tout APK),
  mais il porte une clé d'API qui doit être bridée.
- Projet : `relyka-69a32` · package : `com.relyka.myapp` · 1 clé d'API, 0 client OAuth déclaré.
- ⬜ **Restreindre la clé d'API** (Google Cloud → API & Services → Identifiants) :
  restriction d'application « Applications Android » + nom de package + **empreinte SHA-1 de la clé de
  signature de PRODUCTION**, et restriction d'API à celles réellement utilisées.
- ⬜ **0 client OAuth** dans `google-services.json` : à confirmer si la connexion Google native est
  attendue sur Android — sans client OAuth déclaré, elle ne peut pas fonctionner en build de production.
- ⬜ Empreinte SHA-1/SHA-256 de **Play App Signing** (et non celle de l'upload key) déclarée dans
  Firebase **et** dans l'écran de consentement OAuth.

## 3. Notifications push

Le diagnostic détaillé est dans `docs/NOTIFICATIONS_DIAGNOSTIC.md`. Points bloquants à re-vérifier :

- ⬜ **FCM V1** : compte de service téléversé dans EAS (`eas credentials`) — la clé serveur héritée (V0)
  n'est plus acceptée.
- ⬜ **APNs** : clé `.p8`, Key ID et Team ID renseignés ; `aps-environment` = `production` sur le build store.
- ⬜ Envoi réel testé **depuis un build store** (TestFlight / piste interne), pas seulement en dev :
  c'est le seul moyen de valider les credentials de production.
- ✅ La réponse d'Expo est lue et journalisée (`_shared/expoPush`) : un refus ne passe plus pour un succès.
- ⬜ Panneau admin « Qui est joignable » cohérent après un envoi de test.

## 4. Authentification par e-mail — **point le plus fragile**

Un e-mail de confirmation qui ne part pas fait **annuler l'inscription entière** côté Supabase :
ni `auth.users`, ni `profiles`. L'app l'annonce désormais clairement (`lib/authErrors`), mais
l'inscription échoue quand même.

- ⬜ **SMTP personnalisé actif** (Auth → SMTP Settings). L'expéditeur intégré de Supabase est plafonné à
  quelques e-mails par heure et **n'est pas prévu pour la production**.
- ⬜ **Limites de débit** (Auth → Rate Limits) : « emails sent per hour » relevé au volume attendu.
- ⬜ Expéditeur **vérifié dans chaque compte Brevo** utilisé (cf. `BREVO_API_KEYS`, bascule sur quota épuisé).
- ⬜ Parcours testé de bout en bout sur un build store : inscription → e-mail reçu → confirmation →
  connexion, puis **suppression de compte → recréation avec la même adresse**.

## 5. Store — conformité

- ⬜ Politique de confidentialité et mentions légales atteignables **sans compte** (URL publiques).
- ⬜ Déclaration de collecte de données (Data Safety Play / Privacy Nutrition Labels Apple) alignée sur
  ce qui est réellement collecté : e-mail, données financières saisies, identifiants d'appareil (push),
  analytics d'usage.
- ⬜ Suppression de compte **accessible depuis l'app** (exigence Play et Apple) : présente
  (Profil → Zone de danger), à re-tester après la migration 176.
- ⬜ Achats intégrés : produits RevenueCat déclarés et **testés en sandbox** des deux côtés.
- ⬜ Compte de démonstration fourni aux évaluateurs (les deux stores le demandent pour une app
  derrière authentification).

## 6. Avant chaque publication

> **⚠️ D'ABORD : `npm run check:session`** (`ota` ou `build` en argument). Rien ne part avant qu'il
> soit au vert — c'est ce qui empêche de déconnecter tout le monde. Voir la section 7.

- ⬜ `npx tsc --noEmit` et `npx jest` au vert.
- ⬜ **Migrations SQL appliquées AVANT de publier l'OTA/le binaire** : du code qui appelle une RPC
  absente casse en production. Dernières en date : `176`, `177`.
- ⬜ `runtimeVersion` : ne le bumper **que** si le natif change (cf. note `versioning-and-ota`) — sinon
  l'OTA n'atteint plus les installations existantes.
- ⬜ AAB vérifié 16 Ko : `node scripts/check-16kb.js`.
- ⬜ Coupure globale (kill switch) testée sur le build final : c'est le dernier recours en cas d'incident.

---

## 7. Ne PAS déconnecter les utilisateurs (à chaque OTA, à chaque build)

Une mise à jour qui oblige les gens à se reconnecter est un incident : leurs données sont derrière
l'authentification, et rien à l'écran n'explique ce qui s'est passé. Ça ne se voit **jamais** en
développement (l'app y est réinstallée sans arrêt) — seulement en production, après coup.

**La commande, avant chaque publication, sans exception :**

```bash
npm run check:session ota     # avant eas update   (ou directement : npm run ota)
npm run check:session build   # avant eas build    (déjà enchaîné par npm run build:android/ios)
```

Ce qu'elle refuse de laisser passer, et pourquoi c'est fatal :

| Contrôle | Effet si ça passe |
|---|---|
| URL du projet Supabase modifiée | La clé de session est dérivée de l'URL (`sb-<ref>-auth-token`) → **100 % des sessions perdues** |
| `storageKey` posé à la main | Même effet, en une ligne |
| `persistSession` / `autoRefreshToken` désactivés | Reconnexion à chaque ouverture / au bout d'une heure |
| Stockage natif qui ne lit plus les formats hérités (`.__i`, `.__n`, AsyncStorage) | Les installations existantes ne retrouvent plus leur session |
| Écriture qui efface avant de réécrire | Une interruption (app tuée, OTA appliquée au lancement) laisse un jeu de morceaux illisible |
| `AsyncStorage.clear()` égaré | Emporte la session avec le reste |
| Rechargement OTA piloté depuis le JS | Ferme l'app en plein démarrage, éventuellement pendant l'écriture de la session |
| `runtimeVersion` bumpée + publication OTA | L'OTA **n'atteint personne** (il ne sert que les runtimes identiques) |

Si un changement est **volontaire** (nouveau projet Supabase, nouveau runtime), on l'enregistre
sciemment : `node scripts/check-session-safety.js --accept` — et on prévient les utilisateurs.

**Ce qui garantit le reste, côté code** (à ne pas défaire) :

- `lib/platform/secureStorage.ts` — l'écriture passe par une **nouvelle génération** de morceaux et
  ne bascule l'index qu'à la fin (écriture unique = atomique). Il n'existe aucun instant où la
  session n'est pas lisible. Repli sur AsyncStorage si le coffre natif est absent (OTA vers une
  ancienne build) ou en panne. Couvert par `__tests__/sessionStorage.test.ts`.
- `lib/auth/sessionWatchdog.ts` — si une session disparaît alors qu'il y en avait une au lancement
  précédent, l'incident est remonté au Centre de sécurité avec les versions **d'avant et d'après**
  (donc : OTA ou nouvelle build ?) et l'état du coffre. **Après chaque publication, regarder le
  Centre de sécurité** : « Session perdue au démarrage » = régression à traiter tout de suite.
- `contexts/AuthContext.tsx` — une session « nulle » non sollicitée n'est jamais crue sur parole :
  on redemande un rafraîchissement au serveur, et on ne déconnecte que s'il refuse (hors-ligne : on
  garde la session).
