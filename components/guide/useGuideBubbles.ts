/**
 * useGuideBubbles — pilote une série de mini pop-ups (GuideOverlay) sur un écran du guide.
 *
 * L'écran dit seulement « cette séquence est-elle à mon tour ? » et « combien de bulles ». Le hook
 * gère le compteur, le redémarre si l'utilisateur quitte puis revient (l'étape n'étant pas franchie,
 * elle se rejoue depuis le début), et appelle `onFinish` après la dernière — c'est là que l'écran
 * marque le drapeau du guide.
 */
import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

export function useGuideBubbles(active: boolean, total: number, onFinish: () => void) {
  const focused = useIsFocused();
  const [step, setStep] = useState(0);
  // Petit délai à l'arrivée : les bulles se posent sur des éléments MESURÉS, il faut que l'écran
  // ait fini sa mise en page (sinon la 1ʳᵉ bulle se centre faute de cible).
  const [ready, setReady] = useState(false);

  const on = active && focused;

  useEffect(() => {
    if (!on) { setReady(false); setStep(0); return; }
    const t = setTimeout(() => setReady(true), 420);
    return () => clearTimeout(t);
  }, [on]);

  const next = () => {
    if (step < total - 1) setStep(step + 1);
    else onFinish();
  };

  return { visible: on && ready, step, next };
}
