/**
 * useKeyboardOverlap — padding à appliquer à une barre de saisie ÉPINGLÉE EN BAS pour la garder
 * au-dessus du clavier.
 *
 * Pourquoi ce hook existe : l'app cible le SDK 35 (expo-build-properties), et depuis Android 15 un
 * app ciblant 35 est FORCÉE en edge-to-edge — `softwareKeyboardLayoutMode: "resize"` (app.json) y est
 * ignoré, la fenêtre ne se redimensionne JAMAIS à l'ouverture du clavier. L'écran d'ajout de
 * transaction ne survit pas grâce au redimensionnement mais grâce à `useKeyboardAwareScroll`, qui
 * FAIT DÉFILER le champ au-dessus du clavier. Une barre épinglée hors du scroll ne peut pas être
 * défilée : il faut la remonter du chevauchement réel.
 *
 * Méthode — mesurer, jamais prédire :
 *   chevauchement = bas de la barre (measureInWindow) + marge − haut du clavier (Keyboard.metrics)
 * puis padding += chevauchement, et on re-mesure (plusieurs passes). Chaque passe corrige ce qui
 * manque ou dépasse ENCORE, donc le résultat converge vers « barre posée sur le clavier + marge »,
 * quel que soit le contexte : écran normal, `Modal` statusBarTranslucent (fenêtre à part), animation
 * d'ouverture en cours, bandeau de suggestions/outils qui agrandit l'IME après coup.
 *
 * Ce couple d'API est le MÊME que `useKeyboardAwareScroll` (validé sur l'appareil) : les deux valeurs
 * sont comparables telles quelles. Ne PAS réintroduire :
 *   – `KeyboardAvoidingView` : son `onLayout` est relatif au parent, il calcule un chevauchement
 *     négatif ici et ne fait rien ;
 *   – un padding = hauteur du clavier : juste seulement si la barre touche le bas de l'écran ;
 *   – une correction `StatusBar.currentHeight` entre repères : les fenêtres principale et de Modal
 *     n'ont pas le même décalage → trop haut ici, trop bas là.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

/** Passes de re-mesure : layout à stabiliser, modal qui glisse (~300 ms), bandeaux IME tardifs. */
const PASSES_MS = [50, 150, 350, 700];

export function useKeyboardOverlap(barRef: React.RefObject<View | null>, margin = 16): number {
  const [pad, setPad] = useState(0);
  const padRef = useRef(0);

  useEffect(() => {
    if (Platform.OS === 'web') return; // le clavier virtuel web ne masque pas la page
    const timers: ReturnType<typeof setTimeout>[] = [];

    const apply = (n: number) => {
      const v = Math.max(0, Math.round(n));
      if (v === padRef.current) return;
      padRef.current = v;
      setPad(v);
    };

    /** Une passe : mesure le chevauchement ACTUEL et ajuste le padding d'autant (dans les 2 sens). */
    const settle = () => {
      const kb = Keyboard.metrics?.();
      if (!kb || kb.height <= 0) return; // refermé entre-temps → le handler hide a déjà remis 0
      barRef.current?.measureInWindow((_x, y, _w, h) => {
        if (y == null || h == null || h <= 0) return;
        const overlap = y + h + margin - kb.screenY;
        if (Math.abs(overlap) < 2) return; // en place (à l'arrondi près) : ne pas osciller
        apply(Math.min(padRef.current + overlap, kb.height + margin));
      });
    };

    const schedule = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
      PASSES_MS.forEach((d) => timers.push(setTimeout(settle, d)));
    };

    const subs = [
      // Android ré-émet keyboardDidShow quand l'IME change de taille → schedule() re-converge.
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', schedule),
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
        timers.forEach(clearTimeout);
        timers.length = 0;
        apply(0);
      }),
    ];
    if (Platform.OS === 'ios') subs.push(Keyboard.addListener('keyboardDidChangeFrame', schedule));

    return () => {
      timers.forEach(clearTimeout);
      subs.forEach((s) => s.remove());
    };
  }, [barRef, margin]);

  return pad;
}
