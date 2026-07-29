/**
 * GuideRing — bordure de mise en avant du guide, tracée DIRECTEMENT sur le bouton.
 *
 * À placer comme ENFANT du bouton/élément à entourer (le parent doit être `position: relative`, cas
 * par défaut d'une View RN, et ne pas masquer le débordement). La bordure épouse alors exactement
 * la boîte du parent, décalée de `inset` — donc parfaitement alignée sur n'importe quel appareil,
 * puisqu'il n'y a AUCUNE position à mesurer. Ne s'affiche que lorsque le guide cible cet élément.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Easing } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';
import { useGuideHighlight, type GuideHighlightKey } from '../lib/guideHighlight';

export default function GuideRing({
  target,
  circle = false,
  radius = 16,
  inset = -6,
}: {
  target: GuideHighlightKey;
  circle?: boolean;
  radius?: number;
  inset?: number;
}) {
  const c = useAppColors();
  const active = useGuideHighlight(target);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) return null;

  /* Pulsation VERS L'INTÉRIEUR (1 → 0.96), jamais vers l'extérieur.
   *
   * En grossissant (1 → 1.05), l'anneau d'un élément qui occupe toute la largeur utile dépassait
   * la marge de l'écran et se faisait rogner à gauche et à droite — le cadre paraissait coupé, et
   * d'autant plus sur les écrans étroits. En rétrécissant, il reste TOUJOURS dans la boîte de son
   * élément : impossible de le rogner, quel que soit l'écran ou l'élément entouré.
   * (Toujours pas de variation d'opacité ni de couleur : seule la taille bouge.) */
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });

  // PAS d'ombre ni d'elevation : sur Android l'ombre portée (verte, décalée) faisait paraître les
  // cercles décentrés et « coupait » la barre du bas d'un liseré qui bougeait avec le scale.
  // Juste une bordure nette, parfaitement concentrique à l'élément parent.
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          top: inset, left: inset, right: inset, bottom: inset,
          borderWidth: 3, borderColor: c.emerald,
          borderRadius: circle ? 999 : radius,
          transform: [{ scale }],
        },
      ]}
    />
  );
}
