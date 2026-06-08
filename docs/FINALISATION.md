# Relyka — Procédure de finalisation (paiement, connexions, mise en production)

Document de référence pour finaliser les briques qui nécessitent des comptes/clés externes.
Tout le reste (UI, logique, flags, gamification, boutique, pubs maison) est déjà en place.

---

## 0. Migrations à appliquer (Supabase)
Exécuter dans l'ordre les migrations présentes dans `supabase/migrations/` non encore appliquées :
- `044` solde « à date » + reconcile · `045` seuil Conserver · `046` conseils vague 2
- `047` bucket polices · `048` gamification (tables + bucket + `app_config.gamification`)
- `049` `profiles.projection_assumptions` · `050` catégorie Restaurants
- `051` `profiles.is_premium` + `app_config.ads` · `052` policies admin sur `profiles` (`is_admin()`)

Vérifier que les buckets Storage `fonts` et `gamification` sont **publics**.

---

## 1. Paiement Premium

L'entitlement est `profiles.is_premium` (lu par `usePlan()`). Aujourd'hui il se met :
- manuellement en **Admin → Utilisateurs** (recherche + bouton) ou **Admin → Fonctionnalités** (mon compte) ;
- à terme automatiquement par un **webhook** du fournisseur de paiement.

Point d'intégration unique : `app/lib/purchases.ts` (`purchasePremium`, `isPurchaseConfigured`).

### 1.a Web (déploiement Vercel) → Stripe Checkout
1. Créer un compte **Stripe**, un **produit** abonnement (prix 4,99 €/mois solo, 7,99 € famille) → récupérer les **price IDs** et la **clé publishable** + **clé secrète**.
2. Créer une **Edge Function Supabase** `create-checkout-session` :
   - reçoit `priceId` + `userId`, crée une `checkout.session` Stripe (mode subscription, `client_reference_id = userId`), renvoie l'URL.
3. Dans `purchases.ts` (web) : appeler la fonction puis `window.location = session.url`.
4. **Webhook Stripe** (Edge Function `stripe-webhook`) :
   - `checkout.session.completed` / `customer.subscription.updated` → `UPDATE profiles SET is_premium = true WHERE id = client_reference_id`.
   - `customer.subscription.deleted` / impayé → `is_premium = false`.
5. Stocker `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` dans les secrets Supabase ; la clé publishable dans `EXPO_PUBLIC_STRIPE_PK`.
6. Passer `isPurchaseConfigured()` à `true`.

### 1.b iOS / Android (Expo natif) → RevenueCat
1. Compte **RevenueCat** + produits sur **App Store Connect** et **Google Play Console** (abonnements).
2. `npx expo install react-native-purchases` + config plugin → **build natif** (ne marche pas en Expo Go / web).
3. Init `Purchases.configure({ apiKey })` au démarrage (clés iOS/Android distinctes).
4. `purchases.ts` (natif) : `Purchases.getOfferings()` puis `Purchases.purchasePackage(pkg)`.
5. **Webhook RevenueCat** → Edge Function → `UPDATE profiles SET is_premium = ...` (mapping app_user_id = userId : appeler `Purchases.logIn(userId)`).

> Flux commun : achat → webhook → `profiles.is_premium` → `usePlan()` reflète Premium partout (remise boutique, zéro pub).

---

## 2. Publicités
- **Activation** : Admin → Fonctionnalités → « Publicités » (flag `ads_enabled`).
- **Contenu** : Admin → Publicités → ajouter ≥ 1 bannière (texte/image/lien) puis Enregistrer.
- **Zone d'affichage** : composant `AdSlot` (actuellement sur le Pilotage, sous les conseils). En ajouter ailleurs : `<AdSlot index={n} />`.
- **Visible si** : `ads_enabled` **ET** utilisateur **non Premium** **ET** au moins une bannière configurée.
- **Régie tierce (AdMob…) plus tard** : nécessite un **CMP/consentement (TCF v2)** en Europe + SDK natif. Les bannières maison ne nécessitent aucun consentement.

---

## 3. Conseiller IA (Premium)
- Edge Function Supabase appelant l'API Anthropic/OpenAI avec le profil financier en contexte.
- Cadence : 1 message/semaine ou à l'ouverture (mise en cache, pas d'appel par message libre).
- Disclaimers : suggestions pédagogiques, **pas** du conseil en investissement réglementé.
- Clé API dans les secrets Supabase (jamais côté client).

---

## 4. Open Banking (Phase 3)
- Agrégateur (Powens / Bridge / Tink) : coût par connexion + statut AISP.
- Badge « Vérifié » + déblocage gamification/réductions réservé aux données réelles.

## 5. Gestion de patrimoine (CGP) — leads
- ⚠️ **Juridique d'abord** : statut d'apporteur (ORIAS selon montage) + **consentement RGPD explicite** pour partager des données.
- Technique : encart conditionnel (ex. > 10 000 € dormants) + webhook CRM.

---

## 6. Checklist pré-lancement
- [ ] Migrations 044→052 appliquées, buckets publics OK
- [ ] Flags par défaut : Clôture OFF (si non désirée), Premium OFF, Pubs OFF
- [ ] `is_admin` positionné sur les comptes admin
- [ ] Renommage « Relyka » partout (fait) ; slug/scheme techniques inchangés
- [ ] Gamification : vérifier badges/identité en Admin → Gamification
- [ ] Stripe/RevenueCat branchés + webhooks testés (mode test) avant d'activer Premium
- [ ] Mentions légales / confidentialité à jour (RGPD)
