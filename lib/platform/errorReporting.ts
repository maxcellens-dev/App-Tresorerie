/**
 * Remontée d'erreurs/crashs CLIENT vers le Centre de sécurité (table client_errors via RPC bornée).
 *
 * Capture :
 *  • exceptions non rattrapées (ErrorUtils.setGlobalHandler) — natif ;
 *  • rejets de promesse non gérés (global 'unhandledrejection') — web + Hermes ;
 *  • erreurs rendues par le <GlobalErrorBoundary> (reportError appelé manuellement).
 *
 * Garde-fous : anti-boucle (une erreur pendant la remontée ne doit rien relancer), throttle et
 * dédoublonnage (une même signature n'est envoyée qu'une fois / minute) pour ne pas noyer la base
 * ni la bande passante d'un appareil en difficulté. Fire-and-forget : jamais bloquant.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { APP_VERSION } from './appVersion';
import { getCurrentRoute } from '../ui/navHistory';

type Kind = 'error' | 'fatal' | 'unhandled_rejection';

const _rv = (Constants.expoConfig as any)?.runtimeVersion;
const RUNTIME_VERSION = typeof _rv === 'string' ? _rv : '';

let installed = false;
let reporting = false; // anti-boucle
const recent = new Map<string, number>(); // signature → dernier envoi (ms)
const DEDUP_MS = 60_000;

function signature(kind: Kind, message: string): string {
  return `${kind}:${message.slice(0, 120)}`;
}

/** Envoie une erreur au serveur (bornée, throttlée, jamais bloquante). */
export async function reportError(
  kind: Kind,
  message: string,
  stack?: string | null,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!supabase || reporting) return;
    const msg = (message ?? '').toString().trim();
    if (!msg) return;

    const sig = signature(kind, msg);
    const now = Date.now();
    const last = recent.get(sig);
    if (last && now - last < DEDUP_MS) return; // déjà remontée récemment
    recent.set(sig, now);
    if (recent.size > 100) recent.clear();

    reporting = true;
    await supabase.rpc('log_client_error', {
      p_kind: kind,
      p_message: msg,
      p_stack: stack ?? null,
      p_route: getCurrentRoute(),
      p_platform: Platform.OS,
      p_app_version: APP_VERSION,
      p_runtime_version: RUNTIME_VERSION,
      p_context: context ?? null,
    });
    // Notifie les admins (push + historique), THROTTLÉ côté serveur. Best-effort : ne bloque jamais.
    // (Requiert une session : un crash sur l'écran d'auth ne notifie pas, mais reste dans le journal.)
    supabase.functions
      .invoke('notify-admins', { body: { kind: 'crash', errKind: kind, platform: Platform.OS, version: APP_VERSION } })
      .catch(() => {});
  } catch {
    /* ne jamais faire échouer l'app à cause de la remontée d'erreur */
  } finally {
    reporting = false;
  }
}

/** Installe les capteurs globaux. Idempotent. À appeler une fois au démarrage (root layout). */
export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;

  // 1) Exceptions JS non rattrapées (Hermes/RN). On chaîne le handler existant (LogBox/redbox).
  try {
    const g: any = global as any;
    if (g.ErrorUtils && typeof g.ErrorUtils.getGlobalHandler === 'function') {
      const prev = g.ErrorUtils.getGlobalHandler();
      g.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        reportError(
          isFatal ? 'fatal' : 'error',
          error?.message ?? String(error),
          error?.stack ?? null,
          { isFatal: !!isFatal },
        );
        if (typeof prev === 'function') prev(error, isFatal); // laisse le redbox/dev s'afficher
      });
    }
  } catch { /* noop */ }

  // 2) Rejets de promesse non gérés (web + Hermes quand exposé sur global).
  try {
    const target: any = (global as any) ?? (typeof window !== 'undefined' ? window : null);
    if (target && typeof target.addEventListener === 'function') {
      target.addEventListener('unhandledrejection', (ev: any) => {
        const reason = ev?.reason;
        reportError(
          'unhandled_rejection',
          reason?.message ?? String(reason ?? 'Unhandled promise rejection'),
          reason?.stack ?? null,
        );
      });
    }
  } catch { /* noop */ }
}
