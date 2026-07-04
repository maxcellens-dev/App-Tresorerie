// StaggerIn — apparition en cascade (fade + léger slide-up) des éléments d'une liste.
// Joué UNE fois par session d'app et par groupe (`groupKey`) : revenir sur la page ne rejoue pas
// l'animation ; relancer l'app la rejoue. Zéro coût ensuite (rend les enfants tels quels).
import React, { useRef, useEffect } from 'react';
import { Animated } from 'react-native';

const playedGroups = new Set<string>();

export default function StaggerIn({ children, index, groupKey }: {
  children: React.ReactNode;
  /** Position dans la liste → délai de cascade (55 ms par élément, plafonné). */
  index: number;
  /** Identifiant du groupe animé (ex. 'comptes'). */
  groupKey: string;
}) {
  const alreadyPlayed = playedGroups.has(groupKey);
  const anim = useRef(new Animated.Value(alreadyPlayed ? 1 : 0)).current;

  useEffect(() => {
    if (alreadyPlayed) return;
    playedGroups.add(groupKey);
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      delay: Math.min(index, 8) * 55,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
