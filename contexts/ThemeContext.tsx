/**
 * ThemeContext - Safe access to theme for all components
 * Guarantees a value always exists (defaultTheme fallback).
 * Uses useState + subscribe (not useSyncExternalStore) so getSnapshot is not called every render.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigService, type ConfigState } from '../services/config/ConfigService';
import type { AppConfigPayload, AppTheme } from '../theme/defaultTheme';

type ThemeContextValue = {
  theme: AppTheme;
  config: AppConfigPayload;
  state: ConfigState;
  refreshFromServer: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  onHydrated,
}: {
  children: React.ReactNode;
  onHydrated?: () => void;
}) {
  const [state, setState] = useState<ConfigState>(() => {
    ConfigService.hydrate();
    return ConfigService.getState();
  });

  useEffect(() => {
    const unsubscribe = ConfigService.subscribe(() => {
      setState(ConfigService.getState());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (state.isHydrated && onHydrated) onHydrated();
  }, [state.isHydrated, onHydrated]);

  const refreshFromServer = useCallback(async () => {
    await ConfigService.syncFromApi();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: state.config.theme,
      config: state.config,
      state,
      refreshFromServer,
    }),
    [state, refreshFromServer]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Safe hook that never throws: returns default theme if outside provider (e.g. tests). */
export function useThemeSafe(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const fallback = useMemo(
    () => ({
      theme: ConfigService.getConfig().theme,
      config: ConfigService.getConfig(),
      state: ConfigService.getState(),
      refreshFromServer: async () => {},
    }),
    []
  );
  return ctx ?? fallback;
}
