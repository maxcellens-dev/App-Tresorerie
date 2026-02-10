/**
 * Trésorerie - Default Theme (Fallback when offline or no config)
 * Used when MMKV is empty and before any remote config is loaded.
 */

export interface ThemeColors {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  success: string;
  warning: string;
  danger: string;
}

export interface ThemeFonts {
  heading: string;
  body: string;
}

export interface AppTheme {
  colors: ThemeColors;
  fonts: ThemeFonts;
}

export interface NavigationConfig {
  tabs: string[];
  labels: Record<string, string>;
}

export interface AppTexts {
  appName: string;
  tagline: string;
  seo: Record<string, string>;
}

export interface AppConfigPayload {
  theme: AppTheme;
  navigation: NavigationConfig;
  texts: AppTexts;
}

export const defaultTheme: AppTheme = {
  colors: {
    primary: '#2563eb',
    secondary: '#64748b',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    textMuted: '#64748b',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
  },
  fonts: {
    heading: 'System',
    body: 'System',
  },
};

export const defaultNavigation: NavigationConfig = {
  tabs: ['home', 'transactions', 'accounts', 'parametres'],
  labels: {
    home: 'Accueil',
    transactions: 'Transactions',
    accounts: 'Comptes',
    settings: 'Paramètres',
  },
};

export const defaultTexts: AppTexts = {
  appName: 'Trésorerie',
  tagline: 'Laissez-vous guider pour faire les meilleurs choix pour vos économies.',
  seo: {},
};

export const defaultAppConfig: AppConfigPayload = {
  theme: defaultTheme,
  navigation: defaultNavigation,
  texts: defaultTexts,
};
