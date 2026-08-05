/**
 * Envoi de notifications push — CÔTÉ CLIENT.
 *
 * ⚠️ Les envois ADMIN ne partent plus du navigateur. Ils passent par l'Edge Function `admin-push`
 * (rôle service). Trois raisons, dans l'ordre d'importance :
 *
 *   1. On ne savait JAMAIS si un envoi était parti. L'ancien code faisait `try { await fetch(expo) }
 *      catch {}` et renvoyait le nombre de jetons lus en base : l'écran admin annonçait « envoyé à
 *      N appareils » même quand Expo avait tout refusé, ou quand la requête n'était jamais partie.
 *      C'est précisément ce qui rendait une panne de push indétectable.
 *   2. Les jetons morts (`DeviceNotRegistered`) ne peuvent pas être purgés depuis le client :
 *      `push_tokens` n'a pas de policy DELETE pour les admins (migration 063).
 *   3. Un POST vers exp.host depuis un navigateur dépend du CORS et du réseau du poste admin.
 *
 * Le ciblage (Tous / Premium / Normal / groupe) est refait côté serveur : le client ne fait que
 * décrire la cible, il ne lit plus les jetons des autres.
 */
import { supabase } from './supabase';

export type NotifTargetKind = 'all' | 'premium' | 'normal' | 'group';
export interface NotifTarget { kind: NotifTargetKind; groupId?: string | null }

/** Ce qu'un envoi a RÉELLEMENT produit — à afficher tel quel dans l'écran admin. */
export interface PushSendResult {
  /** Appareils visés (jetons valides trouvés pour la cible). */
  targeted: number;
  /** Envois acceptés par Expo. C'est LE chiffre à annoncer. */
  accepted: number;
  /** Envois refusés. */
  failed: number;
  /** Détail des refus, code Expo par code Expo. */
  errors: Array<{ token: string; code: string; message: string }>;
  /** Jetons morts supprimés au passage. */
  pruned: number;
  /** Expo a tout refusé pour une raison de configuration → panne globale, pas un appareil isolé. */
  configFailure: boolean;
  /** Résumé lisible (« 9 accepté(s) — 2 en échec — DeviceNotRegistered ×2 »). */
  summary: string;
  /** Envoi de test : à qui il est parti (« ton compte », une adresse e-mail…). */
  recipient?: string;
  /** Envoi de test : le destinataire a coupé ses notifications → il ne verra rien, même accepté. */
  notificationsOff?: boolean;
}

async function invokeAdminPush(payload: Record<string, unknown>): Promise<any> {
  if (!supabase) throw new Error('Backend indisponible');
  const { data, error } = await supabase.functions.invoke('admin-push', { body: payload });
  if (error) {
    /* Le corps d'erreur d'une Edge Function porte le vrai message (403 forbidden, 500…) ; sans lui
       on n'aurait qu'un « FunctionsHttpError » qui n'aide personne. */
    let detail = '';
    try { detail = await (error as any).context?.text?.(); } catch { /* le message brut suffira */ }
    throw new Error(detail ? `${error.message} — ${detail.slice(0, 300)}` : error.message);
  }
  if (data?.error) throw new Error(String(data.error));
  return data ?? {};
}

function toResult(d: any): PushSendResult {
  return {
    targeted: Number(d.targeted ?? 0),
    accepted: Number(d.accepted ?? 0),
    failed: Number(d.failed ?? 0),
    errors: Array.isArray(d.errors) ? d.errors : [],
    pruned: Number(d.pruned ?? 0),
    configFailure: Boolean(d.config_failure),
    summary: String(d.summary ?? ''),
    recipient: d.recipient ? String(d.recipient) : undefined,
    notificationsOff: Boolean(d.notifications_off),
  };
}

/**
 * Push ADMIN vers une CIBLE (Tous / Premium / Normal / groupe).
 * L'Edge Function inscrit elle-même la ligne d'historique (`admin_notifications`) avec le nombre
 * d'envois ACCEPTÉS — l'appelant n'a plus à le faire, et ne peut plus y écrire un chiffre optimiste.
 */
export async function sendPushToTarget(target: NotifTarget, title: string, body: string): Promise<PushSendResult> {
  return toResult(await invokeAdminPush({ action: 'send', target, title, body }));
}

/**
 * Push de TEST vers les appareils d'UN utilisateur — soi-même par défaut (`profileId` omis).
 * Se l'envoyer à soi teste la chaîne d'envoi ; l'envoyer à quelqu'un d'autre teste CE téléphone-là,
 * seul moyen de distinguer « plus rien ne part » de « cet appareil précis ne reçoit pas ».
 */
export async function sendTestPush(opts?: { profileId?: string; title?: string; body?: string }): Promise<PushSendResult> {
  return toResult(await invokeAdminPush({
    action: 'test', profile_id: opts?.profileId, title: opts?.title, body: opts?.body,
  }));
}

/** État de joignabilité de la base (panneaux admin de diagnostic push et e-mail). */
export async function fetchReachability(): Promise<any> {
  return invokeAdminPush({ action: 'diagnose' });
}

/**
 * Push vers un utilisateur précis (s'il a activé les notifications).
 * Reste côté client : c'est l'app elle-même qui prévient un utilisateur de SA propre réponse IA,
 * et la policy SELECT de `push_tokens` autorise déjà chacun à lire ses jetons. Best-effort.
 */
export async function sendPushToProfile(profileId: string, title: string, body: string): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, profiles!inner(notifications_enabled)')
    .eq('profile_id', profileId)
    .eq('profiles.notifications_enabled', true);
  if (error || !data?.length) return 0;
  const tokens = [...new Set(data.map((r: any) => r.token))]
    .filter((t): t is string => typeof t === 'string' && t.startsWith('Expo'));
  if (!tokens.length) return 0;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default' }))),
    });
    // Même ici on LIT la réponse : un échec silencieux est ce qu'on cherche à éliminer partout.
    if (!res.ok) { console.warn('[pushSend] Expo a répondu', res.status, (await res.text()).slice(0, 200)); return 0; }
    const payload = await res.json().catch(() => null);
    const tickets: any[] = Array.isArray(payload?.data) ? payload.data : [];
    return tickets.filter((t) => t?.status === 'ok').length;
  } catch (e) {
    console.warn('[pushSend] envoi Expo échoué:', e);
    return 0;
  }
}

export type AdminNotifKind = 'support' | 'suggestion' | 'ai_ticket';

/**
 * Notifie les ADMINS qu'un utilisateur vient de générer quelque chose (assistance, suggestion…).
 * Événementiel (à l'INSERT), pas de cron. Passe par l'Edge Function `notify-admins` (rôle service)
 * car un utilisateur normal n'a pas le droit RLS de lire les jetons/préférences des admins.
 * Best-effort : on n'échoue jamais l'action utilisateur si la notif ne part pas.
 */
export async function notifyAdminsEvent(kind: AdminNotifKind, title: string, body: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.functions.invoke('notify-admins', { body: { kind, title, body } });
  } catch (e) {
    console.warn('[pushSend] notifyAdminsEvent échoué (ignoré):', e);
  }
}
