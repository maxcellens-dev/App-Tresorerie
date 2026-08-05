// ============================================================================
// expoPush — envoi Expo Push PARTAGÉ par toutes les Edge Functions qui notifient.
//
// Pourquoi ce module existe
// -------------------------
// Les trois chemins d'envoi historiques faisaient tous la même chose :
//
//     await fetch('https://exp.host/--/api/v2/push/send', { ... });   // et rien d'autre
//
// La réponse n'était JAMAIS lue. Or l'API Expo répond `200 OK` même quand chaque message est
// refusé : le détail est dans le corps, un « ticket » par destinataire, avec `status: 'error'` et
// un code (`DeviceNotRegistered`, `MismatchSenderId`, `InvalidCredentials`…). Résultat : une panne
// totale — credentials FCM périmés, jetons morts — restait strictement invisible, et l'écran admin
// annonçait « envoyé à N appareils » alors que rien n'était parti. C'est très exactement le
// « les notifs s'arrêtent sans raison » : elles ne s'arrêtaient pas sans raison, la raison n'était
// simplement écrite nulle part.
//
// Ce module lit la réponse, rend les erreurs exploitables, et distingue les deux cas qui comptent :
//   • jeton MORT (`DeviceNotRegistered`) → à purger, l'appareil ne reviendra pas ;
//   • panne de CONFIGURATION (`MismatchSenderId`, `InvalidCredentials`) → à corriger côté projet,
//     elle touche TOUT LE MONDE d'un coup et c'est le scénario « plus rien ne part ».
// ============================================================================

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepte 100 messages par requête. */
const BATCH_SIZE = 100;

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushTicketError {
  token: string;
  /** Code Expo (`DeviceNotRegistered`, `MismatchSenderId`, `InvalidCredentials`, `MessageTooBig`…). */
  code: string;
  message: string;
}

export interface PushResult {
  /** Jetons pour lesquels Expo a accepté le message (ticket `ok`). */
  accepted: number;
  /** Jetons refusés (ticket `error`) ou perdus (lot en échec HTTP). */
  failed: number;
  /** Détail des refus — c'est CE QUE l'admin doit pouvoir lire. */
  errors: PushTicketError[];
  /** Jetons `DeviceNotRegistered` : l'appli a été désinstallée / le jeton révoqué → à supprimer. */
  deadTokens: string[];
  /** Vrai si TOUS les envois ont échoué pour une raison de configuration (panne globale). */
  configFailure: boolean;
}

/** Codes qui signalent une panne de projet, pas un appareil isolé. */
const CONFIG_ERROR_CODES = new Set(['MismatchSenderId', 'InvalidCredentials']);

/** Ne garde que les jetons Expo plausibles, dédupliqués. */
export function normalizeTokens(raw: unknown[]): string[] {
  return [...new Set(raw)].filter(
    (t): t is string => typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken')),
  );
}

/**
 * Envoie `msg` à tous les `tokens`, par lots de 100, et RAPPORTE ce qui s'est passé.
 * Ne lève jamais : un envoi de notification ne doit pas faire tomber l'action qui l'a déclenché.
 */
export async function sendExpoPush(tokens: string[], msg: PushMessage): Promise<PushResult> {
  const unique = normalizeTokens(tokens);
  const res: PushResult = { accepted: 0, failed: 0, errors: [], deadTokens: [], configFailure: false };
  if (unique.length === 0) return res;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const payload = batch.map((to) => ({
      to, title: msg.title, body: msg.body, sound: 'default',
      ...(msg.data ? { data: msg.data } : {}),
    }));
    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      if (!r.ok) {
        // Échec HTTP : tout le lot est perdu, et on garde le corps — c'est là qu'Expo explique.
        res.failed += batch.length;
        res.errors.push({ token: `(lot de ${batch.length})`, code: `HTTP ${r.status}`, message: text.slice(0, 400) });
        continue;
      }
      let parsed: any;
      try { parsed = JSON.parse(text); } catch {
        res.failed += batch.length;
        res.errors.push({ token: `(lot de ${batch.length})`, code: 'BadResponse', message: text.slice(0, 400) });
        continue;
      }
      // Erreur GLOBALE de requête (`{ errors: [...] }` sans `data`) — ex. payload invalide.
      if (!parsed?.data && Array.isArray(parsed?.errors)) {
        res.failed += batch.length;
        for (const e of parsed.errors) {
          res.errors.push({ token: `(lot de ${batch.length})`, code: String(e?.code ?? 'RequestError'), message: String(e?.message ?? '') });
        }
        continue;
      }
      const tickets: any[] = Array.isArray(parsed?.data) ? parsed.data : [];
      tickets.forEach((ticket, idx) => {
        const token = batch[idx] ?? '(inconnu)';
        if (ticket?.status === 'ok') { res.accepted++; return; }
        res.failed++;
        const code = String(ticket?.details?.error ?? ticket?.details?.fault ?? 'Unknown');
        res.errors.push({ token, code, message: String(ticket?.message ?? '') });
        if (code === 'DeviceNotRegistered') res.deadTokens.push(token);
      });
      // Moins de tickets que de messages : le reste est considéré perdu plutôt que réussi.
      if (tickets.length < batch.length) res.failed += batch.length - tickets.length;
    } catch (e) {
      // Réseau : le lot n'est jamais parti.
      res.failed += batch.length;
      res.errors.push({ token: `(lot de ${batch.length})`, code: 'NetworkError', message: String(e).slice(0, 400) });
    }
  }

  res.configFailure = res.accepted === 0 && res.errors.some((e) => CONFIG_ERROR_CODES.has(e.code));
  return res;
}

/**
 * Supprime les jetons morts. Un jeton `DeviceNotRegistered` restera refusé pour toujours : le
 * garder gonfle indéfiniment le compteur « appareils ciblés » et fait croire à une audience qui
 * n'existe plus.
 */
export async function pruneDeadTokens(admin: any, deadTokens: string[]): Promise<number> {
  if (!deadTokens.length) return 0;
  try {
    const { error } = await admin.from('push_tokens').delete().in('token', deadTokens);
    if (error) { console.warn('[expoPush] purge des jetons morts échouée:', error.message); return 0; }
    return deadTokens.length;
  } catch (e) {
    console.warn('[expoPush] purge des jetons morts échouée:', e);
    return 0;
  }
}

/** Résumé court et lisible d'un envoi — pour un log ou un message d'écran admin. */
export function summarizePush(r: PushResult): string {
  if (r.accepted === 0 && r.failed === 0) return 'Aucun appareil ciblé.';
  const parts = [`${r.accepted} accepté(s)`, `${r.failed} en échec`];
  if (r.errors.length) {
    const byCode = new Map<string, number>();
    for (const e of r.errors) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
    parts.push([...byCode.entries()].map(([c, n]) => `${c} ×${n}`).join(', '));
  }
  return parts.join(' — ');
}
