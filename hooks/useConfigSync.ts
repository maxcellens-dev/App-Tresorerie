/**
 * Background sync: fetch app_config from Supabase when online.
 * Updates MMKV and notifies ThemeContext. Non-blocking.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { ConfigService } from '../services/config/ConfigService';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export function useConfigSync(supabaseClient: { from: (t: string) => unknown } | null) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (supabaseClient) ConfigService.setSupabase(supabaseClient as never);
  }, [supabaseClient]);

  useEffect(() => {
    if (!supabaseClient) return;

    const sync = () => {
      ConfigService.syncFromApi().catch(() => {});
    };

    const onAppStateChange = (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        sync();
      }
      appStateRef.current = nextState;
    };

    sync(); // initial silent sync
    intervalRef.current = setInterval(sync, SYNC_INTERVAL_MS);
    const sub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, [supabaseClient]);
}
