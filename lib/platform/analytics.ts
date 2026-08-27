/**
 * Analytics d'usage — enregistre les évènements (ouverture d'app, vue de page, actions)
 * dans la table analytics_events. Utilisé par le Stats Hub admin.
 *
 * Léger et silencieux : n'enregistre que pour les utilisateurs connectés, sans jamais
 * bloquer l'UI (erreurs avalées). Un session_id est généré à chaque chargement de l'app.
 *
 * Chaque évènement porte aussi la VERSION exécutée (migration 215) : c'est ce qui permet de
 * répondre à « combien de monde est encore sur l'ancienne version, et combien ne fait que du web »
 * avant de publier une version minimale requise qui bloquerait tout le monde.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { APP_VERSION } from './appVersion';

const _rv = (Constants.expoConfig as any)?.runtimeVersion;
/** Génération native : ne bouge qu'à une vraie build store (une OTA ne la change pas). */
const RUNTIME_VERSION = typeof _rv === 'string' ? _rv : '';

let sessionId = makeSessionId();
let currentUserId: string | null = null;
let lastScreen: string | null = null;

/** Les colonnes de version existent-elles ? Voir `logEvent` — une OTA peut précéder la migration. */
let hasVersionColumns = true;

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

/** La colonne n'existe pas encore côté base (migration 215 pas jouée) ? */
function isMissingVersionColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42703 = undefined_column (Postgres) ; PGRST204 = colonne absente du cache de schéma (PostgREST).
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /app_version|runtime_version/i.test(error.message ?? '');
}

/** Enregistre un évènement quelconque. */
export async function logEvent(event: string, screen?: string | null, meta?: Record<string, unknown>) {
  if (!supabase || !currentUserId) return;
  const row = {
    profile_id: currentUserId,
    event,
    screen: screen ?? null,
    platform: Platform.OS,
    session_id: sessionId,
    meta: meta ?? null,
  };
  try {
    if (hasVersionColumns) {
      const { error } = await supabase.from('analytics_events').insert({
        ...row,
        app_version: APP_VERSION,
        runtime_version: RUNTIME_VERSION || null,
      });
      if (!error) return;
      /* Une OTA peut arriver AVANT la migration : sans ce repli, l'insertion échouerait sur une
         colonne inconnue et on perdrait TOUTE l'analytique jusqu'à ce que quelqu'un s'en aperçoive.
         On retombe donc sur l'ancien format pour le reste de la session. */
      if (!isMissingVersionColumn(error)) return;
      hasVersionColumns = false;
    }
    await supabase.from('analytics_events').insert(row);
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
