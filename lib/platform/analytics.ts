/**
 * Analytics d'usage — enregistre les évènements (ouverture d'app, vue de page, actions)
 * dans la table analytics_events. Utilisé par le Stats Hub admin.
 *
 * Léger et silencieux : n'enregistre que pour les utilisateurs connectés, sans jamais
 * bloquer l'UI (erreurs avalées). Un session_id est généré à chaque chargement de l'app.
 */
import { Platform } from 'react-native';
import { supabase } from './supabase';

let sessionId = makeSessionId();
let currentUserId: string | null = null;
let lastScreen: string | null = null;

function makeSessionId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Définit l'utilisateur courant (appelé quand l'auth change). */
export function setAnalyticsUser(id: string | null) {
  currentUserId = id;
}

/** Démarre une nouvelle session (nouvelle ouverture d'app). */
export function newAnalyticsSession() {
  sessionId = makeSessionId();
  lastScreen = null;
}

/** Enregistre un évènement quelconque. */
export async function logEvent(event: string, screen?: string | null, meta?: Record<string, unknown>) {
  if (!supabase || !currentUserId) return;
  try {
    await supabase.from('analytics_events').insert({
      profile_id: currentUserId,
      event,
      screen: screen ?? null,
      platform: Platform.OS,
      session_id: sessionId,
      meta: meta ?? null,
    });
  } catch {
    // Silencieux : l'analytics ne doit jamais casser l'app.
  }
}

/** Vue de page (déduplique les répétitions consécutives du même écran). */
export function trackScreen(screen: string) {
  if (!screen || screen === lastScreen) return;
  lastScreen = screen;
  logEvent('screen_view', screen);
}
