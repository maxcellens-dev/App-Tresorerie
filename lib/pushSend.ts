/**
 * Envoi de notifications push via l'API Expo Push (https://exp.host/--/api/v2/push/send).
 * Fonctionne depuis n'importe quelle plateforme (l'admin envoie souvent depuis le web) :
 * on lit les jetons en base (push_tokens) puis on POSTe à l'API Expo par lots de 100.
 * Seuls les utilisateurs avec profiles.notifications_enabled = true sont ciblés.
 *
 * Ciblage (`NotifTarget`) : Tous, Premium, Normal, ou un groupe custom (user_groups).
 */
import { supabase } from './supabase';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

export type NotifTargetKind = 'all' | 'premium' | 'normal' | 'group';
export interface NotifTarget { kind: NotifTargetKind; groupId?: string | null }

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

/** Les profile_ids correspondant à une cible, ou `null` = pas de filtre (Tous). */
async function profileIdsForTarget(target: NotifTarget): Promise<string[] | null> {
  if (!supabase || target.kind === 'all') return null;
  if (target.kind === 'group') {
    if (!target.groupId) return [];
    const { data } = await supabase.from('user_group_members').select('profile_id').eq('group_id', target.groupId);
    return (data ?? []).map((r: any) => r.profile_id);
  }
  // premium / normal
  const { data } = await supabase.from('profiles').select('id').eq('is_premium', target.kind === 'premium');
  return (data ?? []).map((r: any) => r.id);
}

/** Push vers une CIBLE (Tous / Premium / Normal / groupe). Renvoie le nb d'appareils ciblés. */
export async function sendPushToTarget(target: NotifTarget, title: string, body: string): Promise<number> {
  if (!supabase) return 0;
  const ids = await profileIdsForTarget(target);
  let query = supabase
    .from('push_tokens')
    .select('token, profiles!inner(notifications_enabled)')
    .eq('profiles.notifications_enabled', true);
  if (ids !== null) {
    if (ids.length === 0) return 0;
    query = query.in('profile_id', ids);
  }
  const { data, error } = await query;
  if (error || !data?.length) return 0;
  return postBatches(data.map((r: any) => r.token), title, body);
}

/** Push vers un utilisateur précis (s'il a activé les notifications). */
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

/** Push vers TOUS les utilisateurs ayant activé les notifications. */
export async function sendPushToAll(title: string, body: string): Promise<number> {
  return sendPushToTarget({ kind: 'all' }, title, body);
}
