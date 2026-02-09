/**
 * ConfigService - Offline-First config loader
 * Flow: Memory -> MMKV (Local) -> API (Background) -> Merge
 * Guarantees a valid config is always available (fallback to defaultTheme).
 */

import { defaultAppConfig, type AppConfigPayload } from '../../theme/defaultTheme';
import { getStoredConfig, setStoredConfig } from './configStorage';

export type ConfigSource = 'memory' | 'storage' | 'api';

export interface ConfigState {
  config: AppConfigPayload;
  source: ConfigSource;
  isHydrated: boolean;
  lastFetchedAt: number | null;
}

type Listener = (state: ConfigState) => void;

class ConfigServiceClass {
  private state: ConfigState = {
    config: defaultAppConfig,
    source: 'memory',
    isHydrated: false,
    lastFetchedAt: null,
  };

  private listeners = new Set<Listener>();
  private supabaseClient: { from: (table: string) => { select: (cols?: string) => { single: () => Promise<{ data: unknown; error: unknown }> } } } | null = null;

  /** Register Supabase client for background sync (optional, can be set later) */
  setSupabase(client: ConfigServiceClass['supabaseClient']) {
    this.supabaseClient = client;
  }

  /** Hydration: load from MMKV on app launch. If empty -> use defaultTheme. */
  hydrate(): AppConfigPayload {
    const stored = getStoredConfig();
    if (stored) {
      this.state = {
        config: this.mergeWithDefaults(stored),
        source: 'storage',
        isHydrated: true,
        lastFetchedAt: null,
      };
    } else {
      this.state = {
        config: defaultAppConfig,
        source: 'memory',
        isHydrated: true,
        lastFetchedAt: null,
      };
    }
    this.notify();
    return this.state.config;
  }

  /** Get current config (always defined). */
  getConfig(): AppConfigPayload {
    return this.state.config;
  }

  /** Get current state (source, isHydrated, etc.). */
  getState(): ConfigState {
    return { ...this.state };
  }

  /** Apply config from API and persist to MMKV. */
  applyRemoteConfig(payload: Partial<AppConfigPayload>): AppConfigPayload {
    const merged = this.mergeWithDefaults({ ...this.state.config, ...payload });
    this.state = {
      config: merged,
      source: 'api',
      isHydrated: true,
      lastFetchedAt: Date.now(),
    };
    setStoredConfig(merged);
    this.notify();
    return merged;
  }

  /** Background sync: fetch from Supabase, update if different. */
  async syncFromApi(): Promise<{ updated: boolean; config: AppConfigPayload }> {
    if (!this.supabaseClient) {
      return { updated: false, config: this.state.config };
    }
    try {
      const { data, error } = await this.supabaseClient
        .from('app_config')
        .select('theme, navigation, texts')
        .single();

      if (error || !data) return { updated: false, config: this.state.config };

      const remote: AppConfigPayload = {
        theme: (data as { theme?: AppConfigPayload['theme'] }).theme ?? this.state.config.theme,
        navigation: (data as { navigation?: AppConfigPayload['navigation'] }).navigation ?? this.state.config.navigation,
        texts: (data as { texts?: AppConfigPayload['texts'] }).texts ?? this.state.config.texts,
      };

      const merged = this.mergeWithDefaults(remote);
      const changed =
        JSON.stringify(merged) !== JSON.stringify(this.state.config);

      if (changed) {
        this.applyRemoteConfig(merged);
        return { updated: true, config: merged };
      }
      return { updated: false, config: this.state.config };
    } catch {
      return { updated: false, config: this.state.config };
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private mergeWithDefaults(partial: Partial<AppConfigPayload>): AppConfigPayload {
    return {
      theme: {
        ...defaultAppConfig.theme,
        ...partial.theme,
        colors: { ...defaultAppConfig.theme.colors, ...partial.theme?.colors },
        fonts: { ...defaultAppConfig.theme.fonts, ...partial.theme?.fonts },
      },
      navigation: {
        ...defaultAppConfig.navigation,
        ...partial.navigation,
        labels: { ...defaultAppConfig.navigation.labels, ...partial.navigation?.labels },
      },
      texts: {
        ...defaultAppConfig.texts,
        ...partial.texts,
        seo: { ...defaultAppConfig.texts.seo, ...partial.texts?.seo },
      },
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((l) => l(state));
  }
}

export const ConfigService = new ConfigServiceClass();
