/**
 * Supabase client (optional - for config sync and data).
 * Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env
 *
 * Persistance de session :
 * - Natif (iOS/Android) : AsyncStorage → la session survit à la fermeture de l'app.
 * - Web : stockage par défaut (localStorage) + détection de session dans l'URL (OAuth).
 */
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const isWeb = Platform.OS === 'web';

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        // Sur natif : persiste la session via AsyncStorage. Sur web : défaut (localStorage).
        storage: isWeb ? undefined : (AsyncStorage as any),
        autoRefreshToken: true,
        persistSession: true,
        // Détection des tokens dans l'URL : uniquement sur web (retour OAuth via redirection page).
        detectSessionInUrl: isWeb,
      },
    })
  : null;
