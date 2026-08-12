# Plan — filet de tests puis découpage des gros fichiers

> ## AVANCEMENT — toutes les phases sont faites
>
> | Phase | État | Résultat |
> |---|---|---|
> | **A1** moteur du Pilotage | ✅ | `lib/pilotageEngine.ts` extrait ; `usePilotageData.ts` **1404 → 258 lignes** ; horloge injectable |
> | **A2** doublon de récurrence | ✅ | Équivalence prouvée sur **3 456 comparaisons**, puis regroupée dans `lib/recurrence.ts` |
> | **A3** utilitaires purs | ✅ | `lib/recurrence.ts`, `lib/treasuryTable.ts`, `lib/colorMix.ts`, `isoDay` dans `dateUtils` |
> | **B1/B2** infra composants | ✅ | Jest multi-projets ; `jest.setup.tsx` ; le projet « lib » reste à **~2 s** |
> | **B3** preuve du harnais | ✅ | `__tests__/register.test.tsx` — 7 tests sur le vrai écran |
> | **C1** modales du Pilotage | ✅ | 2 coquilles + **8 modales sur 8**, `DetailModal` comprise |
> | **C2** view model | ✅ | `lib/pilotageView.ts` (pur, 45 tests) + `hooks/usePilotageViewModel.ts` |
> | **D** Trésorerie / clôture | ✅ | 5 modales sur 5 + `lib/closureForm.ts` (26 tests) + `lib/monthKeys.ts` |
> | **E** accessibilité | ✅ | **0 commande icône-seule sans nom dans TOUT le dépôt** (admin compris) |
>
> **Tests : 36 suites / 429 → 46 suites / 621.** `tsc` propre à chaque étape.
>
> | Fichier | Départ | Arrivée |
> |---|---:|---:|
> | `app/(tabs)/pilotage.tsx` | 2422 | **1066** |
> | `app/(tabs)/tresorerie.tsx` | 2050 | **1730** |
> | `hooks/usePilotageData.ts` | 1404 | **258** |
> | `components/MonthlyClosure.tsx` | 827 | **752** |
> | Icônes sans nom | 165 | **0** |
>
> ### Ce que C2 a réellement changé
> Les ~400 lignes de calculs dérivés du Pilotage sont devenues **pures** (`lib/pilotageView.ts`,
> horloge injectable) et le hook ne fait plus que les mémoïser. Effet de bord recherché : la
> soustraction à huit termes du Relyka avait une **copie** dans l'annonce de changement de mode
> d'enveloppe — ajouter un terme d'un côté aurait fait annoncer une variation que la carte
> n'affichait pas. Il n'en reste qu'une définition, `computeRelykaBreakdown`.
>
> ### Ce que la refonte de `DetailModal` a changé
> 675 lignes, **65 identifiants externes**, 47 règles de style. Découpée en quatre sous-blocs
> (`components/pilotage/detail/`) plutôt qu'en un composant à 65 props, qui n'aurait fait que
> déménager le couplage. Les **filtres sont descendus dans les vues qu'ils pilotent** : leur remise à
> zéro, qui demandait un `useEffect` dédié dans l'écran, découle maintenant du simple démontage du
> sous-bloc.
>
> ⚠️ Rien, dans `tsc` ni dans les tests de calcul, n'aurait rattrapé une donnée mal recâblée dans ce
> déplacement — un montant branché sur la mauvaise prop reste parfaitement typé. D'où
> `__tests__/detailModal.test.tsx` (**36 tests de rendu**), écrit pour ça.
>
> `renderWithProviders` monte désormais **`AuthProvider`** : `useAppColors` en dépend, donc tout
> composant qui lit une couleur le traverse — une puce d'aide au fond d'une modale a suffi à faire
> échouer neuf tests.
>
> ⚠️ `PilotageInputModal.canCancel` porte une règle MÉTIER, pas une préférence : à `false`, les
> étapes 3 et 4 du parcours de démarrage ne peuvent plus être contournées (ni « Annuler », ni tap à
> côté, ni retour matériel). Le perdre rendrait le profil financier incalculable. À vérifier à la
> main sur web **et** mobile, avec `scrollToRow`.
>
> ### SDK 57 ✅ — et ce n'était pas un bump
> Expo **54 → 57**, donc React Native **0.81.5 → 0.86.2** et React **19.1 → 19.2.3**.
>
> ⚠️ **La Legacy Architecture a été supprimée dans RN 0.82.** `newArchEnabled: false` n'est plus une
> option — la propriété n'existe même plus dans le schéma de `app.json` (confirmé par `expo-doctor`).
> Cette migration est donc un passage à la **New Architecture**, pas une montée de version.
>
> Conséquence directe : l'épinglage de `react-native-reanimated` en v3 (`expo.install.exclude`),
> posé précisément *parce que* « Reanimated v4 EXIGE la New Architecture », n'avait plus d'objet.
> Levé → **Reanimated 4.5.1 + `react-native-worklets`**. Surface de code minuscule (un seul écran,
> trois hooks), donc sans douleur.
>
> Ruptures rencontrées et traitées :
>
> | Rupture | Traitement |
> |---|---|
> | `StyleSheet.absoluteFillObject` retiré de RN 0.86 | `absoluteFill` (désormais un objet simple, donc *spreadable*) — 20 occurrences, 17 fichiers |
> | **expo-router n'est plus compatible avec react-navigation depuis SDK 56** | `useIsFocused` ← `expo-router` ; `useBottomTabBarHeight` ← copie vendorisée d'expo-router |
> | TypeScript 6 : `baseUrl` déprécié | retiré (les `paths` se résolvent relativement au tsconfig) |
> | TypeScript 6 : plus d'inclusion auto de `node_modules/@types` | `"types": ["jest", "node"]` explicite |
> | TypeScript 6 : `rootDir` exigé par ts-jest (TS5011) | `"rootDir": "."` |
> | `@expo/config-plugins` n'est plus remonté à la racine | le plugin maison importe `expo/config-plugins` |
> | `@react-native/jest-preset` ≠ version de RN | épinglé sur `0.86.2` |
>
> **La leçon de l'étape** : `tsc` était propre AVANT que la migration expo-router ne soit faite —
> c'est le **bundler** qui a levé l'incompatibilité react-navigation, pas le typage. Un
> `npx expo export` sur les deux plateformes fait donc partie du portillon, au même titre que `tsc`
> et `jest`. Les deux passent.
>
> **Versions** : `runtimeVersion` **1.0.4 → 1.1.0** — obligatoire. Le natif change : laisser 1.0.4
> permettrait à une OTA compilée pour SDK 57 d'atterrir sur les binaires SDK 54 encore installés, et
> de les faire planter au lancement sans recours. Les anciens binaires restent ainsi sur leur bundle
> et continuent d'afficher le bandeau de mise à jour (piloté par `app_config.features`, donc côté
> serveur : aucune OTA n'est nécessaire pour qu'ils le voient).
>
> ### Ce que le nettoyage final a donné
> **98 spécificateurs d'import morts** retirés dans 88 fichiers (surtout des `import React` devenus
> inutiles avec le transform JSX automatique). Vérifié par `tsc`, `jest` **et** un nouveau bundle des
> deux plateformes — le typage seul ne prouve pas qu'un bundle se construit encore.
>
> **Fichiers jamais référencés** (constat, aucune suppression faite) : `ProjectsListCard`,
> `RelykaGauge`, `SafeToSpendCard`, `SavingsGaugeCard`, `VariableTrendCard`, `TransactionAmountCell`,
> `useAccountTransactionsByYear`, `useFinancialHealth`. Les `.legacy.tsx` sont gardés
> **délibérément** (revert du splash), et les fichiers à suffixe de plateforme (`.native.ts`,
> `.web.ts`) ne sont jamais importés explicitement — Metro les résout. Ne pas les confondre.
>
> ### Rangement de l'arborescence ✅
> `components/` **92 fichiers à la racine → 0** (21 dossiers) · `hooks/` **75 → 0** (8 dossiers) ·
> `lib/` **86 → 2** (7 dossiers ; `dateUtils` reste à la racine, il n'appartient à aucun domaine).
>
> Groupé par **domaine**, pas par nature technique : on cherche « l'écran des comptes », pas « les
> modales ». `lib/finance/` (40 fichiers) rassemble tout ce qui décide d'un montant — le cœur testé,
> et le seul endroit où une erreur coûte de l'argent.
>
> **Déplacement PUR** : 1 924 imports réécrits, aucune autre modification. Se relit en diff de
> position, se révoque par `git revert`.
>
> ⚠️ **Trois pièges rencontrés, à connaître avant de refaire ce genre d'opération :**
> 1. Exclure les dossiers par leur NOM emporte les homonymes en profondeur : filtrer `admin` a sauté
>    `app/(tabs)/(secondary)/admin/` et `components/admin/` → 75 imports non réécrits. Filtrer sur le
>    CHEMIN, à la racine seulement.
> 2. `git mv` échoue sur un fichier **non suivi** (créé et jamais commité) → repli sur un renommage.
> 3. Les chemins de `jest.mock('…')` ne sont **pas** des imports : aucun réécriveur ne les voit.
>    C'est `jest` qui les a signalés, pas `tsc` — deux suites composants au rouge alors que la
>    compilation était propre.
>
> Portillon tenu : `tsc`, **621 tests**, `expo-doctor` 20/20, bundles web **et** Android.
>
> ### Découpage restant — le chantier SUIVANT, pas la fin de celui-ci
> Le plan d'origine ne visait que 4 fichiers. Huit autres portent la même dette :
>
> | Fichier | Lignes | Priorité |
> |---|---:|---|
> | `app/(tabs)/comptes/[id].tsx` | 1 799 | **1** — le plus gros de l'app, touche l'argent |
> | `app/(tabs)/tresorerie.tsx` | 1 730 | 2 — déjà entamé (5 modales sorties) |
> | `app/(tabs)/transactions/index.tsx` | 1 518 | 3 |
> | `hooks/data/useTransactions.ts` | 1 317 | **3 bis** — logique métier, donc testable en premier |
> | `components/project/AddProjectModal.tsx` | 1 470 | 4 |
> | `app/(tabs)/projection.tsx` | 1 299 | 5 |
> | `app/(tabs)/projects/index.tsx` | 1 278 | 6 |
> | `app/(tabs)/transactions/edit/[id].tsx` | 1 224 | 7 |
>
> **Méthode, éprouvée trois fois maintenant** : extraire d'abord le CALCUL pur (horloge injectable)
> et le tester, puis seulement découper le rendu. L'inverse déplace le couplage au lieu de le
> supprimer — c'est ce qu'a montré `DetailModal`.
>
> ### Reste à faire — recette MANUELLE uniquement
> Aucun test ne couvre le rendu réel sur appareil. Voir « Recette manuelle » en fin de document :
> ouvrir chaque modale déplacée et comparer les montants à la version précédente, sur web **et**
> mobile. C'est le seul contrôle qui attrape une donnée mal câblée.


Objectif : réduire la dette des fichiers de 2 000+ lignes **sans jamais casser un comportement
existant**. Ces fichiers encodent des dizaines de cas limites durement acquis (leurs commentaires en
témoignent) : la seule façon sûre de les découper est de les **couvrir d'abord**.

État de départ (mesuré) :

| Fichier | Lignes | Nature |
|---|---:|---|
| `app/(tabs)/pilotage.tsx` | 2422 | 1 composant de 2125 lignes + styles |
| `app/(tabs)/tresorerie.tsx` | 2050 | `TreasuryPlanBody` (220→1770) + styles |
| `hooks/usePilotageData.ts` | 1404 | **dont 810 lignes déjà pures** |
| `components/MonthlyClosure.tsx` | ~800 | bannière + modale + bilan |

---

## Principes non négociables

1. **Jamais déplacer et modifier dans le même commit.** Un commit « déplacement pur » doit pouvoir se
   relire en diff de position uniquement. S'il faut corriger quelque chose, c'est un commit d'après.
2. **Le test vient avant le déplacement**, jamais après. Un test écrit après coup valide le code
   déplacé, pas l'ancien : il ne prouve aucune équivalence.
3. **Une phase = un lot livrable et réversible.** Chaque étape se termine sur un dépôt vert, publiable
   en l'état. Aucune étape ne dépend d'une étape suivante pour être cohérente.
4. **Portillon de vérification après CHAQUE étape** : `npx tsc --noEmit`, `npx jest`, puis passage
   manuel sur l'écran touché (voir « Recette manuelle » en fin de document).
5. **Rien de tout ceci ne part avant le lancement, sauf la phase A** (aucun déplacement de code).

---

## Phase A — Couvrir le calcul, sans déplacer une ligne

**Risque : quasi nul.** Aucun code n'est déplacé, aucune signature publique ne change.
**Gain : le plus élevé de tout le plan.** C'est la phase à faire même si on s'arrête là.

### A1. Rendre testable `computePilotageData` — 810 lignes de logique financière

`hooks/usePilotageData.ts:563` est **déjà une fonction pure** de ses entrées… à une ligne près :
`const now = new Date()` (ligne 564). C'est la seule dépendance à l'horloge de tout le bloc.

Deux modifications, minuscules :

```ts
// 1) horloge injectable — le défaut préserve exactement le comportement actuel
export function computePilotageData(
  data: Awaited<ReturnType<typeof fetchPilotageData>>,
  now: Date = new Date(),
): PilotageData {
```

L'appelant (ligne 1380) n'est pas touché : il continue d'appeler sans second argument.

Puis `__tests__/pilotageData.test.ts` : on fige une **date de référence** et on construit des jeux
d'entrée représentatifs. À couvrir en priorité, parce que ce sont les endroits où une régression
coûte cher et où le dépôt garde déjà trace d'incidents passés :

- Relyka à 0 € sur un compte neuf (doit dire *pourquoi*, pas afficher un zéro muet).
- Point bas de projection : c'est une info **à une date**, pas un état permanent.
- Régularisations exclues des agrégats (`category_id` NULL — cf. note `regul-category-null`).
- Échéances de crédit matérialisées comptées **une seule fois** (cf. `credit-materialization`).
- Enveloppe variable : questionnaire (< 2 mois) vs historique (≤ 6 mois).
- Bascule de mois : le 1er du mois à 00 h 01, et le dernier jour à 23 h 59 (la date injectable
  rend ces deux cas triviaux à écrire — aujourd'hui ils ne sont testables qu'en voyageant dans le temps).

> **Méthode fixtures.** Ne pas inventer les entrées à la main : instrumenter temporairement
> `fetchPilotageData` en développement pour vider un `JSON.stringify` d'un compte réel de test, puis
> **anonymiser** (montants arrondis, noms remplacés). On obtient des cas réalistes plutôt que des cas
> théoriques — c'est là que se cachent les régressions.

### A2. Supprimer la double définition de `addRecurrenceToMonth`

**Défaut réel, indépendant du refactor.** La fonction existe en **deux exemplaires divergents** :

- `app/(tabs)/tresorerie.tsx:51-82` — porte un commentaire « Limite à 24 mois maximum » ;
- `hooks/usePilotageData.ts:377-405` — écriture condensée, sans ce commentaire.

Deux sources de vérité pour « combien cette récurrence pèse-t-elle sur ce mois » : la Trésorerie et
le Pilotage peuvent afficher des montants différents pour la même récurrence, et toute correction
appliquée d'un côté seulement les fait diverger davantage.

Ordre impératif :

1. `__tests__/recurrenceAmount.test.ts` qui exécute **les deux implémentations** sur la même matrice
   de cas (mensuel, trimestriel, annuel, hebdomadaire ; début en cours de mois ; date de fin ;
   horizon 24 mois) et **affirme qu'elles donnent le même résultat**.
2. Si elles divergent : **s'arrêter**. C'est un bug de production à trancher et à corriger seul, avant
   tout regroupement.
3. Si elles concordent : créer `lib/recurrenceAmount.ts`, y déplacer l'implémentation **à l'identique**,
   faire importer les deux fichiers, garder les tests.

### A3. Les autres fonctions pures déjà présentes

Même traitement, même ordre (test puis déplacement) — elles sont déjà isolées, donc bon marché :

| Fonction | Emplacement | Destination |
|---|---|---|
| `recurrenceOccurrencesBetween` | `usePilotageData.ts:464` | `lib/recurrence.ts` |
| `recurrencePastInMonth` | `usePilotageData.ts:406` | `lib/recurrence.ts` |
| `detectExpectedIncome` | `usePilotageData.ts:496` | `lib/expectedIncome.ts` |
| `getMonthsFromOffset`, `createOverridesMap`, `groupCategories` | `tresorerie.tsx:41-105` | `lib/treasuryTable.ts` |
| `parseColor`, `compositeOver` | `tresorerie.tsx:158-189` | `lib/colorMix.ts` |

**Sortie de phase A** : ~1 000 lignes de logique métier sous test, `usePilotageData.ts` et
`tresorerie.tsx` allégés de leurs utilitaires, **et un doublon dangereux supprimé** — sans avoir
touché à un seul composant.

---

## Phase B — Infrastructure de test des composants

**Risque : nul pour l'app** (rien n'est ajouté au bundle : dépendances de développement uniquement).
Le risque est celui d'un chantier qui s'enlise — d'où l'étape B3, qui sert de preuve d'arrêt.

### B1. Dépendances et configuration

Versions du projet : Expo **54**, React Native **0.81.5**, React **19.1.0**, Jest **29**.

```
npm i -D jest-expo @testing-library/react-native react-test-renderer@19.1.0 @types/react-test-renderer
```

> À confirmer au moment de l'installation : `@testing-library/react-native` doit être en **v13 ou
> plus** (première ligne compatible React 19). Si `npm` propose une v12, ne pas forcer avec
> `--legacy-peer-deps` : c'est le signe d'une incompatibilité réelle.

La config actuelle ne prend que les `.test.ts` en environnement `node` — c'est ce qui rend la suite
actuelle rapide (2 s). **Il ne faut pas la sacrifier.** On passe donc en multi-projets :

```js
// jest.config.js
module.exports = {
  projects: [
    {
      // INCHANGÉ : moteurs purs, environnement node, aucune dépendance native. Reste à ~2 s.
      displayName: 'lib',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/**/*.test.ts'],
      transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
    },
    {
      // NOUVEAU : composants. Plus lent, isolé — un échec ici n'aveugle pas la suite rapide.
      displayName: 'components',
      preset: 'jest-expo',
      testMatch: ['**/__tests__/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
    },
  ],
};
```

`npm test` continue de tout lancer ; `npx jest --selectProjects lib` garde la boucle rapide.

### B2. Les doublures

Dans `jest.setup.tsx`. L'objectif n'est pas de simuler l'app, c'est de **neutraliser tout ce qui
touche au natif ou au réseau** pour qu'un rendu ne dépende que de ses props.

| À doubler | Pourquoi |
|---|---|
| `lib/supabase` | aucun test ne doit atteindre le réseau ; exposer un client où chaque requête est programmable |
| `expo-router` | `useRouter`, `usePathname`, `useSegments`, `useIsFocused` — presque tout écran en dépend |
| `react-native-reanimated` | mock officiel fourni par la bibliothèque |
| `react-native-safe-area-context` | insets fixes, sinon `useSafeAreaInsets` rend `0` et fausse les mises en page |
| `@react-native-async-storage/async-storage` | mock officiel ; sert au thème, au cache, au report de clôture |
| `@react-native-community/netinfo` | sinon `onlineManager` met les requêtes en pause dans les tests |
| `expo-font` / `expo-splash-screen` / `expo-linear-gradient` | modules natifs sans équivalent JS |
| `lib/pushNotifications`, `lib/purchases` | jamais de demande d'autorisation ni d'achat en test |

Prévoir un utilitaire `__tests__/utils/renderWithProviders.tsx` montant `QueryClientProvider`
(avec `retry: false`), `ThemeProvider` et `AuthProvider` — sinon chaque test réinvente le décor.

### B3. Preuve que le harnais tient

Un premier test sur un écran **feuille et à fort enjeu** : `app/register.tsx`.

- l'écran s'affiche ;
- un mot de passe trop faible affiche l'erreur en ligne, sans appeler `signUp` ;
- une adresse déjà inscrite (réponse `identities: []`) affiche « un compte existe déjà » et **jamais**
  « vérifie ton mail » ;
- une inscription réussie sans session affiche l'écran de confirmation.

Ces quatre cas verrouillent la régression qui a produit des comptes introuvables. **Si B3 ne passe pas
au vert en une demi-journée, arrêter B et rester en phase A** : le harnais ne vaut que s'il est fiable.

---

## Phase C — Découper le Pilotage

**Uniquement après A et B.** Structure mesurée de `pilotage.tsx` :

- `105 → 898` : mise en place et calculs dérivés (**76 appels de hooks**)
- `899` : `return (`
- `1125 → 2225` : **~1 100 lignes de modales**
- `2230 → 2422` : styles

### C1. Les modales d'abord (~1 100 lignes)

Ce sont des **feuilles de rendu** : elles reçoivent des données et rendent du JSX. Aucune ne pilote
l'état global. C'est le déplacement le moins risqué du fichier.

Vers `components/pilotage/` : `ReservedModal` (1125), `DetailModal` (1246, la plus grosse),
`SuiviTxModal` (1924), `TroughInfoModal` (1993), `RelykaShiftModal` (2029), `VariableInputModal` (2053),
`MarginInputModal` (2123), `ConserveModal` (2185).

**Une modale par commit.** Procédure invariable :

1. déplacer le JSX **tel quel**, sans une reformulation ;
2. remonter les variables utilisées en **props explicites** (c'est ici qu'on voit les dépendances
   cachées — ne pas les contourner en passant un objet fourre-tout) ;
3. déplacer les styles correspondants ;
4. portillon : `tsc` + `jest` + ouverture réelle de la modale dans l'app.

⚠️ **Deux pièges déjà payés dans ce dépôt**, à ne pas réintroduire :
`VariableInputModal` et `MarginInputModal` portent les étapes 3 et 4 du parcours de démarrage
(`requireVariable` / `requireMargin`) : elles perdent leur bouton « Annuler » et leur fermeture au tap
à côté. Et leur ouverture fait défiler la page jusqu'à la ligne concernée (`scrollToRow`, qui passe par
le DOM sur web — `findNodeHandle` **lève** sur react-native-web). Ces deux comportements doivent
survivre au déplacement, et sont à vérifier à la main, sur web **et** sur mobile.

### C2. Puis les calculs dérivés (~790 lignes)

Extraire vers `hooks/usePilotageViewModel.ts` les blocs déjà délimités par les commentaires du
fichier : reste disponible (394), point bas (433), compte vide (473), confiance (555), budget de
recommandation (561), listes de détail (683).

Ce hook devient testable via `renderHook` — et une partie de son contenu se révélera **purement
calculatoire**, donc redescendable en phase A (test sans React).

**Cible réaliste : `pilotage.tsx` sous 600 lignes**, sans avoir changé un seul comportement.

---

## Phase D — Trésorerie et clôture mensuelle ✅

**Trésorerie — 5 modales sur 5.** `TreasuryHelpModal` ; une coquille `TreasuryMenuModal`
(+ `TreasuryMenuOption`) pour le gabarit commun des menus, où sont passées les deux modales de
CHOIX ; et `TreasuryDraftModal` pour les deux **formulaires** de brouillon.

Ces deux derniers ne pouvaient pas passer par `TreasuryMenuModal`, et c'est structurel : un menu
d'options (carte étroite, une liste de choix) et un formulaire (carte large bordée d'orange, des
champs de saisie) ne portent pas la même intention. Ils étaient en revanche jumeaux **entre eux** —
seuls changeaient les libellés, le filtre de comptes et l'action de validation : **une** coquille
paramétrée, donc, et non deux composants.

**Clôture mensuelle — les trois responsabilités sont séparées :**
1. bannière → `ClosureBannerCard` (l'était déjà) ;
2. pop-up de bilan → `components/closure/ClosureBilanModal.tsx` ;
3. formulaire de clôture → son **calcul** est sorti dans `lib/closureForm.ts` (**26 tests**,
   horloge injectable).

Le JSX du formulaire (319 lignes) est resté dans `MonthlyClosure`, **délibérément**. Son état est
réellement partagé — `confirm()` lit `mode`, `flash`, `balances`, `unknownShare`, `unknownDate` — il
n'existe donc aucune frontière de sous-bloc qui garderait l'état local, comme on a pu le faire pour
`DetailModal` avec ses filtres. L'extraire en composant présentatif à ~30 props n'aurait pas réduit
le couplage, seulement changé son adresse. Ce qui méritait d'en sortir, c'est le calcul : ce sont
ces fonctions qui décident de montants écrits en base sous forme de régularisation, et une erreur y
est invisible à la relecture.

Au passage : `ym`, `addMonthKey`, `lastDayOfMonthKey` et `monthLabel` sont descendues dans
`lib/monthKeys.ts`. Elles sont pures, mais vivaient dans `hooks/useMonthlyClosure` qui tire
react-query et Supabase — en dépendre rendait tout module de calcul intestable en Node. Le hook les
réexporte : aucun des neuf fichiers qui les importent n'a changé de chemin.

---

## Phase E — Accessibilité ✅ (dépôt entier)

**Terminée partout, admin compris.** Plus aucune commande icône-seule sans nom accessible dans le
dépôt (audit automatisé : 165 → 0).

Deux temps, et la différence entre eux est la leçon à retenir :

1. **49 boutons « Fermer »** — motif uniforme, traité en masse par script.
2. **40 commandes variées** — nommées **d'après leur GESTIONNAIRE, jamais d'après leur icône**.

Le second point n'est pas de la coquetterie. Sur les trois `chevron-back` du code, **aucun n'était
un bouton « Retour »** : c'étaient une navigation entre mois, une navigation entre périodes et un
carrousel de recommandations. Un script naïf par nom d'icône aurait posé trois libellés faux — et
un libellé faux est pire qu'absent, parce qu'il inspire confiance. Chaque libellé posé a donc été
audité contre son `onPress`.

Cas particuliers résolus au passage :
- deux boutons calendrier voisins portaient le même nom (début / fin) : indiscernables au lecteur
  d'écran, désormais distingués ;
- les grilles d'icônes reçoivent un libellé **dynamique** (le nom de l'icône) plus
  `accessibilityState={{ selected }}` — rien d'autre ne sépare une cellule de sa voisine.

Les **68 dernières** (écrans d'administration) ont été traitées en dernier, un seul utilisateur
interne étant concerné. Même règle qu'au premier lot, et elle a resservi : nommer d'après le
GESTIONNAIRE. Les quatre `refresh-outline` de l'éditeur de style ne sont pas des « Actualiser » mais
quatre remises à zéro de champs différents ; `close-circle` y supprime tantôt une teinte, tantôt une
question, tantôt une sélection d'utilisateur.

Deux commandes ont reçu un `accessibilityState={{ selected }}` en plus de leur nom : sans lui, rien
ne distingue l'option active dans un sélecteur de mode ou une grille de pastilles de couleur.

Un audit automatisé (`Touchable` sans `<Text>`, avec icône, sans `accessibilityLabel`) sert de
contrôle : il doit rendre **0**.

---

## Ordonnancement recommandé

| Quand | Quoi | Risque |
|---|---|---|
| **Avant lancement** | Phase A (A1, A2 surtout) | quasi nul — aucun déplacement |
| Avant lancement, si le temps le permet | B1 → B3 | nul pour l'app (dépendances de dev) |
| **Après lancement** | C1 (modale par modale) | faible, si le portillon est tenu |
| Après lancement | C2, D, E | moyen — à faire hors période de sortie |

A2 mérite d'être traitée **maintenant** : ce n'est pas de la dette, c'est un défaut latent — deux
sources de vérité pour un même montant.

---

## Recette manuelle après chaque étape

Les tests ne couvrent pas le rendu réel. Après chaque étape touchant un écran :

1. Pilotage : ouvrir chaque modale déplacée, vérifier les montants **contre la version précédente**
   (capture d'écran avant/après — c'est le seul contrôle qui attrape une donnée mal câblée).
2. Parcours de démarrage : un compte neuf doit toujours voir les 4 étapes **dans l'ordre**
   (couvert par `__tests__/guideStages.test.ts`, mais le rendu, lui, ne l'est pas).
3. Web **et** mobile : les deux plateformes divergent sur le clavier, les insets et le défilement —
   trois sujets sur lesquels ce dépôt a déjà payé (cf. notes `keyboard-overlap`,
   `findnodehandle-web-crash`, `screen-header-no-top-inset`).

## Retour arrière

Un commit par étape, message préfixé `refactor(pilotage): déplace …`. Un déplacement pur se révoque
par `git revert` sans conflit, tant qu'aucune modification ne s'y est glissée — c'est très exactement
la raison du principe n° 1.
