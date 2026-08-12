/**
 * usePushPermission — l'autorisation SYSTÈME de notifier, relue quand l'app revient au premier plan.
 *
 * Pourquoi ce hook existe : l'interrupteur « Notifications sur le téléphone » se basait uniquement
 * sur `profiles.notifications_enabled`, qui n'exprime qu'un SOUHAIT. Un utilisateur ayant refusé
 * l'autorisation au niveau d'Android voyait donc un interrupteur allumé et n'en recevait aucune —
 * sans le moindre indice. L'état affiché doit être celui du téléphone, pas celui de la base.
 *
 * La relecture au retour en avant-plan est indispensable : la seule façon de débloquer une
 * autorisation refusée est de passer par les réglages de l'OS, donc de QUITTER l'app. Sans ce
 * rafraîchissement, on reviendrait sur un écran qui affiche encore l'ancien état.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getPushPermissionAsync, requestPushPermissionAsync, PUSH_SUPPORTED, type PushPermission } from '../../lib/platform/pushNotifications';

export interface PushPermissionState {
  /** `unsupported` sur le web et en simulateur : il n'y a rien à autoriser. */
  status: PushPermission;
  /** Le téléphone laissera-t-il passer une notification ? */
  granted: boolean;
  /** Refusé au niveau de l'OS → seuls les réglages système peuvent débloquer. */
  blocked: boolean;
  /** Relit l'état (après un retour des réglages, ou à la demande). */
  refresh: () => Promise<PushPermission>;
  /** Demande l'autorisation et met l'état à jour. Renvoie l'état obtenu. */
  request: () => Promise<PushPermission>;
}

export function usePushPermission(): PushPermissionState {
  const [status, setStatus] = useState<PushPermission>(PUSH_SUPPORTED ? 'undetermined' : 'unsupported');

  const refresh = useCallback(async () => {
    const s = await getPushPermissionAsync();
    setStatus(s);
    return s;
  }, []);

  const request = useCallback(async () => {
    const s = await requestPushPermissionAsync();
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    refresh();
    // Retour en avant-plan = l'utilisateur revient peut-être des réglages système.
    const onChange = (next: AppStateStatus) => { if (next === 'active') refresh(); };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refresh]);

  return {
    status,
    granted: status === 'granted',
    blocked: status === 'denied',
    refresh,
    request,
  };
}
