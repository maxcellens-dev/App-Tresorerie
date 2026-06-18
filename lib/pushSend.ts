/**
 * Envoi de notifications push via l'API Expo Push (https://exp.host/--/api/v2/push/send).
 * Fonctionne depuis n'importe quelle plateforme (l'admin envoie souvent depuis le web) :
 * on lit les jetons en base (push_tokens) puis on POSTe à l'API Expo par lots de 100.
 * Seuls les utilisateurs avec profiles.notifications_enabled = true sont ciblés.
 */
import { supabase } from './supabase';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

async function postBatches(tokens: string[], title: string, body: string): Promise<number> {
  const unique = [...new Set(tokens)].filter((t) => t && t.startsWith('ExponentPushToken'));
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE).map((to) => ({ to, title, body, sound: 'default' }));
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch (e) {
      console.warn('[pushSend] envoi Expo échoué (lot ignoré):', e);
    }
  }
  return unique.length;
}

/** Push vers un utilisateur précis (s'il a activé les notifications). Renvoie le nb d'appareils ciblés. */
export async function sendPushToProfile(profileId: string, title: string, body: string): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, profiles!inner(notifications_enabled)')
    .eq('profile_id', profileId)
    .eq('profiles.notifications_enabled', true);
  if (error || !data?.length) return 0;
  return postBatches(data.map((r: any) => r.token), title, body);
}

/** Push vers TOUS les utilisateurs ayant activé les notifications (envoi manuel admin). */
export async function sendPushToAll(title: string, body: string): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, profiles!inner(notifications_enabled)')
    .eq('profiles.notifications_enabled', true);
  if (error || !data?.length) return 0;
  return postBatches(data.map((r: any) => r.token), title, body);
}
