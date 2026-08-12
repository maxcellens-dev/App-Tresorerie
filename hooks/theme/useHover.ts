/**
 * useHover — état de survol souris, WEB uniquement.
 *
 * React Native Web transmet `onMouseEnter`/`onMouseLeave` aux View/Pressable ; sur natif ces
 * props sont ignorées (et `hovered` reste `false`), donc le composant se comporte exactement
 * comme avant. À étaler sur l'élément : `<View {...bind} />`.
 */
import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';

export function useHover() {
  const [hovered, setHovered] = useState(false);
  const onIn = useCallback(() => setHovered(true), []);
  const onOut = useCallback(() => setHovered(false), []);
  const bind = useMemo(
    () => (Platform.OS === 'web' ? ({ onMouseEnter: onIn, onMouseLeave: onOut } as any) : ({} as any)),
    [onIn, onOut],
  );
  return { hovered: Platform.OS === 'web' ? hovered : false, bind };
}
