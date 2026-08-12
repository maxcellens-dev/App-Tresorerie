/**
 * RecoMessagesCarousel — les messages des recommandations, UN À LA FOIS, sous les quatre décisions.
 *
 * Les décisions se réduisent à quatre tuiles « libellé + montant ». Tout ce qui EXPLIQUE ces
 * montants (pourquoi épargner ça, ce que ça donne dans 6 mois) vivait dans les slides de l'ancienne
 * vue complète. Ce bandeau les rend, sans reprendre la place que le tableau de bord cherche à
 * économiser : un message visible, les autres à un swipe.
 *
 * Deux usages, deux listes DISTINCTES (cf. lib/recoMessages) : les messages du chiffre principal
 * sous le Relyka, ceux des décisions sous les quatre tuiles. Les mélanger revenait à faire défiler
 * une mise en garde globale entre deux phrases sur l'épargne.
 *
 * Comportement :
 *  • défilement AUTOMATIQUE toutes les 5 s ;
 *  • survol (souris) ou appui (tactile) → PAUSE, pour avoir le temps de lire ;
 *  • swipe horizontal et pastilles cliquables pour naviguer à la main.
 *
 * La COULEUR porte l'appartenance : c'est celle de la décision concernée, la même que sa tuile
 * juste au-dessus. L'étiquette la nomme, pour ne pas dépendre que de la couleur.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { semanticText } from '../../theme/palette';
import RichAmounts from '../transaction/RichAmounts';
import type { RecoMessage } from '../../lib/finance/recoMessages';

/** Durée d'affichage d'un message avant de passer au suivant. */
const ROTATE_MS = 5000;

export default function RecoMessagesCarousel({ messages, onPressMessage }: {
  messages: RecoMessage[];
  /** Tap long / clic sur l'étiquette → ouvrir la décision concernée (facultatif). */
  onPressMessage?: (m: RecoMessage) => void;
}) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const count = messages.length;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // L'index doit rester valide quand la liste change (une reco traitée disparaît).
  useEffect(() => { if (index >= count && count > 0) setIndex(0); }, [count, index]);

  /* Rotation, relancée à chaque message ET à chaque reprise. En pause, on ne fait rien : le
     minuteur est annulé au nettoyage, et repart à zéro sur le message courant à la reprise. */
  useEffect(() => {
    if (paused || count < 2) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearTimeout(t);
  }, [index, paused, count]);

  // Swipe : mêmes seuils que les autres carrousels de l'app, pour un geste identique partout.
  const countRef = useRef(count);
  countRef.current = count;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        const n = countRef.current;
        if (n < 2) return;
        if (g.dx < -40) setIndex((i) => (i + 1) % n);
        else if (g.dx > 40) setIndex((i) => (i - 1 + n) % n);
      },
    }),
  ).current;

  if (count === 0) return null;
  const m = messages[Math.min(index, count - 1)];
  // Couleur LISIBLE sur le fond courant (clair/sombre) : c'est déjà la règle des montants ailleurs.
  const accent = semanticText(m.color, COLORS);
  // Une mise en garde est tenue plus fermement : cadre et fond plus francs, texte à sa couleur.
  const warn = m.tone === 'warn';

  return (
    // Le geste de swipe est porté par la View EXTÉRIEURE, la pression/le survol par le Pressable
    // intérieur : mêlés sur le même nœud, la négociation de responder entre les deux rend le swipe
    // capricieux (le Pressable réclame le toucher dès le doigt posé).
    <View
      style={[
        styles.wrap,
        { borderColor: m.color + (warn ? '55' : '3D'), backgroundColor: m.color + (warn ? '14' : '0D') },
      ]}
      {...panResponder.panHandlers}
    >
    <Pressable
      // Tactile : un appui met en pause / relance. Souris : le survol suffit, on ne demande pas
      // de cliquer pour lire.
      onPress={() => (onPressMessage && m.recoType ? onPressMessage(m) : setPaused((v) => !v))}
      onHoverIn={() => setPaused(true)}
      onHoverOut={() => setPaused(false)}
      accessibilityRole="button"
      accessibilityLabel={`${m.label} : ${m.text}`}
      style={styles.inner}
    >
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: m.color + '22' }]}>
          <Ionicons name={m.icon as any} size={12} color={accent} />
        </View>
        <Text style={[styles.label, { color: accent }]} numberOfLines={1}>{m.label}</Text>
        {count > 1 && (
          <View style={styles.dots}>
            {messages.map((mm, i) => (
              <Pressable
                key={mm.key}
                onPress={() => setIndex(i)}
                hitSlop={6}
                style={[styles.dot, i === index && { backgroundColor: accent, width: 14 }]}
              />
            ))}
          </View>
        )}
        {count > 1 && (
          <Ionicons
            name={paused ? 'pause' : 'play'}
            size={10}
            color={COLORS.textSecondary}
            style={{ opacity: paused ? 0.9 : 0.4 }}
          />
        )}
      </View>

      <RichAmounts text={m.text} style={[styles.text, warn && { color: accent }]} />
    </Pressable>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: {
      borderWidth: 1, borderRadius: 14, overflow: 'hidden',
      // Hauteur plancher : sans elle, la carte se contracte sur un message court puis se déplie sur
      // le suivant, et toute la page tressaute toutes les 5 secondes.
      minHeight: 92,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
    },
    inner: { flex: 1, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 10, gap: 7 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    icon: { width: 20, height: 20, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    label: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 1 },
    dots: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
    dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.cardBorder },
    text: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
  });
}
