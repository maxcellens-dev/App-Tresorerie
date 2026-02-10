/**
 * Supabase client (optional - for config sync and data).
 * Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

console.log('🔍 Supabase Debug:', { 
  url_value: url || 'EMPTY',
  url_length: url?.length,
  anonKey: anonKey ? 'OK' : 'MISSING' 
});

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
