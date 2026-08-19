/**
 * Le côté React de la file d'attente des sollicitations (lib/interruptQueue).
 *
 * Chaque écran qui veut interrompre déclare son besoin et reçoit en retour le droit — ou non — de
 * s'afficher maintenant. Il continue de gérer son propre contenu : on n'arbitre que le TOUR.
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  setInterruptPending, canShowInterrupt, subscribeInterrupts, currentInterrupt,
  type InterruptId,
} from '../../lib/engagement/interruptQueue';
import { useAppLocked } from '../../lib/auth/appLockState';

/**
 * @param id      qui demande la parole
 * @param wants   ce candidat a-t-il quelque chose à montrer, là, maintenant ?
 * @returns       true seulement si c'est son tour (personne de plus prioritaire n'attend)
 */
export function useInterruptSlot(id: InterruptId, wants: boolean): boolean {
  /* APP VERROUILLÉE = PERSONNE NE PARLE.
     Le voile de verrouillage (AppLockGate) cache l'app, il ne l'arrête pas : les sollicitations
     continuaient de s'ouvrir derrière lui — et de se CONSOMMER, l'état des lieux se marquant « vu »
     et archivant son bilan à la fermeture. D'où un bilan mensuel aperçu, ou perdu, sans avoir
     déverrouillé. On retient donc la file entière à la source : dès le déverrouillage, chacun
     reprend son tour dans l'ordre habituel, rien n'est sauté. */
  const appLocked = useAppLocked();
  const effectiveWants = wants && !appLocked;

  // Déclaré pendant l'effet, pas pendant le rendu : muter un module partagé en plein rendu
  // provoquerait des mises à jour croisées entre composants.
  useEffect(() => {
    setInterruptPending(id, effectiveWants);
  }, [id, effectiveWants]);

  // Libère la place au démontage — sinon un écran disparu garderait la main pour toujours.
  useEffect(() => () => { setInterruptPending(id, false); }, [id]);

  const active = useSyncExternalStore(
    subscribeInterrupts,
    () => currentInterrupt(),
    () => null,
  );
  return effectiveWants && active === id && canShowInterrupt(id);
}
