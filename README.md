# Trésorerie

Application de gestion de trésorerie personnelle, **Offline-First** avec contrôle admin du thème via Supabase (Remote Config).

## 🚀 Quick Start

```bash
# Lancer la dev (web)
npm run dev

# Lancer sur Android
npm run android

# Lancer sur iOS
npm run ios

# (Optionnel) Corriger les versions des packages
npm run fix-packages
```

## Stack

- **Frontend:** React Native (Expo SDK 50+), Expo Router
- **Stockage local:** react-native-mmkv
- **Backend:** Supabase (PostgreSQL)
- **State / Sync:** TanStack Query v5 (à brancher sur les écrans données)

## Structure du projet (Expo Router)

```
TRESORERIE App/
├── app/
│   ├── _layout.tsx              # Root layout (ThemeProvider + ConfigSync)
│   ├── index.tsx                # Redirect → (tabs)/home
│   ├── theme/
│   │   └── defaultTheme.ts      # Fallback thème (couleurs, fonts, texts)
│   ├── contexts/
│   │   └── ThemeContext.tsx     # ThemeProvider + useTheme / useThemeSafe
│   ├── services/
│   │   └── config/
│   │       ├── configStorage.ts # MMKV read/write app_config
│   │       └── ConfigService.ts # Hydration + sync API + merge
│   ├── hooks/
│   │   ├── useConfigSync.ts     # Sync silencieuse app_config (Supabase)
│   │   └── useFinancialHealth.ts # Safe-to-Spend, status, Future Impact
│   ├── lib/
│   │   └── supabase.ts          # Client Supabase (optionnel)
│   └── (tabs)/
│       ├── _layout.tsx          # Tabs (couleurs depuis theme)
│       ├── home.tsx             # Safe-to-Spend badge + Future Impact
│       ├── transactions.tsx
│       ├── accounts.tsx
│       └── settings.tsx
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # app_config, profiles, accounts, categories, transactions, admin_logs
├── admin/                         # Panneau admin Next.js
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Liens admin
│   │   └── style-editor/
│   │       └── page.tsx          # Éditeur couleurs + textes SEO → app_config
│   ├── package.json
│   └── next.config.js
├── package.json
├── app.json
└── tsconfig.json
```

## Offline-First – Thème

1. **Fallback:** `defaultTheme.ts` définit couleurs/fonts/textes par défaut.
2. **Hydration:** Au lancement, chargement depuis MMKV ; si vide → `defaultTheme`.
3. **Sync en arrière-plan:** Récupération de `app_config` depuis Supabase ; si différent → mise à jour MMKV + application (immédiate ou au prochain redémarrage).
4. **Context:** `ThemeContext` fournit toujours un thème valide (`useTheme` / `useThemeSafe`).

## Financial Runway

- **Safe-to-Spend** = Liquidités actuelles − somme des dépenses futures « engagées ».
- Comportement : ne pas bloquer ; afficher un **Future Impact Warning** si la dépense fait passer le solde projeté sous le seuil (badge Vert → Orange → Rouge).

## Admin (Next.js)

- Lancer : `cd admin && npm i && npm run dev` (port 3001).
- Page **Style Editor** : couleurs (hex), textes et SEO ; **Enregistrer** met à jour la table `app_config` dans Supabase.

## Variables d’environnement

**App Expo**

- `EXPO_PUBLIC_SUPABASE_URL` – URL du projet Supabase
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` – Clé anon

**Admin**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Supabase

1. Créer un projet Supabase.
2. Exécuter la migration `supabase/migrations/001_initial_schema.sql`.
3. RLS : lecture publique de `app_config` ; mise à jour réservée aux utilisateurs authentifiés (ou service role pour l’admin si besoin).
