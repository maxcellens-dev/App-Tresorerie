/**
 * GuideOverlay — guide interactif en « bulles ».
 *
 * RÈGLE ABSOLUE : on ne vise JAMAIS une zone par ses coordonnées.
 * Chaque étape NOMME l'élément à mettre en avant (`highlightKey`) ; c'est cet élément qui trace sa
 * propre bordure, à l'intérieur de sa boîte de layout (<GuideRing>, cf. lib/guideHighlight). Il n'y
 * a donc rien à mesurer et rien à deviner : le surlignage épouse le bouton ou la carte au pixel
 * près, sur n'importe quel téléphone, quelles que soient la densité, l'encoche ou la barre système.
 *
 * Les rectangles calculés (`getRect`, largeur ÷ 5 pour un onglet, `hauteur − 76`…) et les cadres
 * dessinés par-dessus une position mesurée ont été RETIRÉS : ils tombaient à côté dès que l'écran
 * changeait. Il n'existe plus aucun chemin de code capable de les réintroduire.
 *
 * La seule mesure restante concerne la BULLE : `anchorRef` sert à la poser près de son sujet (et à
 * l'amener à l'écran si elle est dans une zone défilante). Le résultat est clampé dans l'écran —
 * une mesure imprécise décale la bulle de quelques pixels, jamais le surlignage.
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, useWindowDimensions,
  findNodeHandle, Platform, ScrollView, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from '../hooks/useAppColors';
import { useInvertedColors } from '../hooks/useInvertedColors';
import { RootPortal } from '../lib/rootPortal';
import { setGuideHighlight, type GuideHighlightKey } from '../lib/guideHighlight';

export interface BubbleStep {
  /** SEULE façon de mettre en avant : NOMMER le ou les éléments concernés. C'est l'élément qui
      trace sa bordure (<GuideRing>) dans sa propre boîte → aucune mesure, aucun décalage possible. */
  highlightKey?: GuideHighlightKey | GuideHighlightKey[];
  /** Place la bulle en haut ou en bas de l'écran (ne recouvre jamais la cible). */
  placement?: 'top' | 'bottom';
  /** Élément près duquel poser la bulle. Mesuré UNIQUEMENT pour ça (et pour l'amener à l'écran) —
      la mise en avant, elle, n'est jamais mesurée. */
  anchorRef?: () => React.RefObject<any>;
  /** Côté où poser la bulle par rapport à l'ancre (défaut 'below'). */
  anchorPlacement?: 'above' | 'below';
  /** Décalage supplémentaire (px) depuis l'ancre — pour dégager une zone occupée (menu déployé…). */
  anchorOffset?: number;
  icon: string;
  iconColor: string;
  title: string;
  description: string;
}

interface Props {
  visible: boolean;
  steps: BubbleStep[];
  currentStep: number;
  onNext: () => void;
  onSkip: () => void;
  scrollRef?: React.RefObject<ScrollView | null>;
  screenTitle?: string;
  /** Bulle aux couleurs INVERSÉES (guide utilisateur) : elle doit trancher sur la page. */
  inverted?: boolean;
  /** Masque « Passer » et neutralise la fermeture au tap à côté : on avance bulle par bulle. */
  hideSkip?: boolean;
  /** Libellé du bouton d'avancement (défaut « Suivant » / « Terminer »). Sert aux étapes qui
      demandent un GESTE : le bouton fait alors la même chose que la cible entourée. */
  nextLabel?: string;
}

const BUBBLE_H = 230;      // hauteur estimée de la bulle (pour décider au-dessus/en-dessous)
/* Largeur MAXIMALE de la bulle. Sans elle, `left:16 / right:16` étirait la bulle sur toute la
   fenêtre : sur un écran d'ordinateur, l'explication d'un bouton devenait un bandeau de 2 000 px
   de large, sans aucun lien visuel avec la petite zone qu'elle commente. Bornée, elle redevient
   une carte — et on la CENTRE sur sa cible (cf. bubbleLeft) pour dire de quoi elle parle. */
const BUBBLE_MAX_W = 460;

export default function GuideOverlay({
  visible, steps, currentStep, onNext, onSkip, scrollRef, screenTitle, inverted, hideSkip, nextLabel,
}: Props) {
  const COLORS = useAppColors();
  const INVERTED = useInvertedColors();
  // Mesures de la fenêtre LUES À CHAQUE RENDU : sur le web, la fenêtre se redimensionne (et
  // `Dimensions.get` figé au chargement du module renvoyait alors des valeurs fausses — bulle
  // posée hors écran après un redimensionnement).
  const { width: SW, height: SH } = useWindowDimensions();
  // Palette de la BULLE seule (le voile et les cadres restent ceux de l'app).
  const b = inverted ? INVERTED : COLORS;
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const bubbleStyles = useMemo(() => makeBubbleStyles(b), [b]);
  // Étape obligatoire : le tap à côté ne ferme rien (on ne peut avancer que par « Suivant »).
  const dismiss = hideSkip ? () => {} : onSkip;
  const insets = useSafeAreaInsets();
  // Zones sûres haut/bas. Robuste sur tous les téléphones : à l'intérieur d'un Modal, les insets
  // peuvent être à 0 → on retombe sur StatusBar.currentHeight (Android) pour ne jamais passer la
  // bulle sous l'encoche / la barre de statut.
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const TOP_SAFE = topInset + 12;
  const BOTTOM_SAFE = Math.max(insets.bottom, 16) + 12;
  // Rect de l'ancre (mode auto-bordure) : bornes verticales pour poser la bulle juste au-dessus /
  // dessous, et centre horizontal pour la caler sur la cible (utile dès que la fenêtre est large).
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; centerX: number } | null>(null);
  // Hauteur RÉELLE de la bulle (mesurée) → positionnement fiable quel que soit le texte/écran.
  const [bubbleH, setBubbleH] = useState(BUBBLE_H);

  const step = steps[currentStep];

  // ⚠️ Les effets ci-dessous NE dépendent JAMAIS de l'objet `step`. Les écrans construisent leur
  // tableau d'étapes dans le corps du composant : il est recréé à chaque rendu, donc `step` change
  // d'identité en permanence. En dépendance d'effet, cela relançait mesure et `setState` à chaque
  // rendu — boucle infinie (« Maximum update depth exceeded ») dès qu'une bulle était visible.
  // L'étape est identifiée par son INDEX (+ sa clé de surlignage, une chaîne stable).
  const highlightKey = step?.highlightKey ?? null;
  // Signature STABLE des clés : une étape peut en désigner plusieurs, et un tableau littéral
  // change d'identité à chaque rendu — en dépendance d'effet, c'est la boucle infinie décrite
  // ci-dessus. On dépend donc de la chaîne, pas du tableau.
  const highlightSig = Array.isArray(highlightKey) ? highlightKey.join('|') : (highlightKey ?? '');

  // Pilote le registre de mise en avant : la/les clé(s) de l'étape courante (ou rien) → chaque
  // élément concerné affiche/retire son <GuideRing>. Nettoyé à la fermeture / au démontage.
  useEffect(() => {
    setGuideHighlight(visible ? highlightKey : null);
    return () => setGuideHighlight(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, highlightSig]);

  /* Placement de la BULLE (et rien d'autre).
     La mise en avant, elle, n'est jamais calculée ici : c'est l'élément ciblé qui trace sa propre
     bordure dans sa boîte de layout (<GuideRing>, cf. lib/guideHighlight). Il n'y a donc plus aucun
     rectangle deviné — c'était la cause des encadrés à côté de la cible selon le téléphone.
     Ce qu'on mesure ici sert UNIQUEMENT à poser la bulle près de son sujet, et le résultat est
     clampé dans l'écran : une mesure imprécise décale la bulle de quelques pixels, jamais plus. */
  useEffect(() => {
    if (!visible || !step) return;
    setAnchor(null);
    const aref = step.anchorRef?.().current;
    if (!aref?.measureInWindow) return;

    let cancelled = false;
    // 1) Amener la cible à l'écran si elle est dans une zone défilante.
    //    WEB : `findNodeHandle` LÈVE sur react-native-web → on passe par le DOM.
    if (scrollRef?.current) {
      if (Platform.OS === 'web') {
        const el: any = (scrollRef.current as any)?.getScrollableNode?.();
        if (el) {
          const currentY = Number(el.scrollTop) || 0;
          aref.measureInWindow((_x: number, y: number) => {
            if (cancelled) return;
            scrollRef.current?.scrollTo({ y: Math.max(0, currentY + y - SH * 0.28), animated: true });
          });
        }
      } else {
        const scrollNode = findNodeHandle(scrollRef.current);
        if (scrollNode && typeof aref.measureLayout === 'function') {
          aref.measureLayout(scrollNode, (_lx: number, ly: number) => {
            if (cancelled) return;
            scrollRef.current?.scrollTo({ y: Math.max(0, ly - SH * 0.28), animated: true });
          }, () => {});
        }
      }
    }

    // 2) Mesurer l'ancre une fois le défilement posé (et retenter tant que le layout n'est pas fini).
    let tries = 0;
    const measure = () => {
      if (cancelled) return;
      aref.measureInWindow((x: number, y: number, w: number, h: number) => {
        if (cancelled) return;
        if (h > 0) setAnchor({ top: y, bottom: y + h, centerX: x + w / 2 });
        else if (tries++ < 5) setTimeout(measure, 120);
      });
    };
    const t = setTimeout(measure, scrollRef?.current ? 380 : 60);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentStep]);

  if (!visible || !step) return null;

  const isLast = currentStep === steps.length - 1;

  /* Position VERTICALE de la bulle : juste sous l'ancre, ou juste au-dessus quand l'élément vit en
     bas d'écran (barre d'onglets). Toujours CLAMPÉE dans la zone visible → jamais coupée, jamais
     sous l'encoche. Sans ancre mesurable, repli en haut ou en bas selon . */
  const maxTop = SH - BOTTOM_SAFE - bubbleH;
  let bubbleTop: number;
  if (anchor) {
    const extra = step.anchorOffset ?? 0;
    const raw = step.anchorPlacement === 'above'
      ? anchor.top - bubbleH - 18 - extra
      : anchor.bottom + 30 + extra;
    bubbleTop = Math.min(Math.max(raw, TOP_SAFE), Math.max(TOP_SAFE, maxTop));
  } else {
    bubbleTop = step.placement === 'top' ? TOP_SAFE + 56 : Math.max(TOP_SAFE, maxTop);
  }

  /* Position HORIZONTALE : carte bornée, centrée sur ce qu'elle commente. Sur téléphone elle occupe
     toute la largeur utile ; sur écran large elle se cale sur sa cible au lieu de s'étirer d'un bord
     à l'autre. Toujours clampée dans la fenêtre. */
  const bubbleW = Math.min(SW - 32, BUBBLE_MAX_W);
  const bubbleLeft = anchor == null
    ? (SW - bubbleW) / 2
    : Math.min(Math.max(anchor.centerX - bubbleW / 2, 16), Math.max(16, SW - 16 - bubbleW));

  return (
    // RootPortal (pas Modal) : rendu dans la MÊME fenêtre que les boutons ciblés → measureInWindow
    // et le dessin partagent le même repère, les cadres tombent PILE sur les boutons. Voir lib/rootPortal.
    <RootPortal>
    <View style={styles.fill} pointerEvents="box-none">
      {/* AUCUN voile sombre, AUCUN découpage : la cible ressort d'elle-même, en traçant sa propre
          bordure (<GuideRing>). C'est ce qui rend le surlignage juste sur tous les écrans.
          Étape OBLIGATOIRE (hideSkip) : aucun calque bloquant — la cible entourée doit rester
          appuyable, c'est justement le geste qu'on demande. Sinon, calque transparent qui capte le
          tap « à côté » pour sortir du guide. */}
      {!hideSkip && (
        <TouchableOpacity activeOpacity={1} onPress={dismiss} style={StyleSheet.absoluteFill} />
      )}

      {/* ── Bulle ── */}
      {(
        <View
          style={[bubbleStyles.bubble, { top: bubbleTop, left: bubbleLeft, width: bubbleW }]}
          pointerEvents="auto"
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && Math.abs(h - bubbleH) > 1) setBubbleH(h);
          }}
        >
          {/* Header */}
          {(!!screenTitle || !hideSkip) && (
            <View style={styles.bubbleHeader}>
              {screenTitle ? <Text style={bubbleStyles.screenTitle}>Guide — {screenTitle}</Text> : <View />}
              {!hideSkip && (
                <TouchableOpacity onPress={onSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={bubbleStyles.skip}>Passer</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Contenu */}
          <View style={styles.bubbleBody}>
            <View style={[styles.iconBox, { backgroundColor: step.iconColor + '22', borderColor: step.iconColor + '44' }]}>
              <Ionicons name={step.icon as any} size={26} color={step.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={bubbleStyles.title}>{step.title}</Text>
              <Text style={bubbleStyles.desc}>{step.description}</Text>
            </View>
          </View>

          {/* Dots + bouton */}
          <View style={styles.bubbleFooter}>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View key={i} style={[
                  styles.dot,
                  i === currentStep && styles.dotActive,
                  i < currentStep && styles.dotDone,
                ]} />
              ))}
            </View>
            <TouchableOpacity style={bubbleStyles.nextBtn} onPress={onNext}>
              <Text style={bubbleStyles.nextLabel}>{nextLabel ?? (isLast ? 'Terminer' : 'Suivant')}</Text>
              <Ionicons name={nextLabel ? 'arrow-forward' : isLast ? 'checkmark' : 'arrow-forward'} size={16} color={b.bg} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
    </RootPortal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  mask: { position: 'absolute', backgroundColor: 'rgba(2, 6, 23, 0.55)' },
  highlight: {
    position: 'absolute', borderRadius: 14,
    borderWidth: 3, borderColor: c.emerald,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 0 0 9999px rgba(2,6,23,0.0), 0 0 24px rgba(52,211,153,0.5)' } as any
      : {}),
  },
  arrow: {
    position: 'absolute', width: 0, height: 0,
    borderLeftWidth: 8, borderRightWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  arrowUp: { borderBottomWidth: 8 },
  arrowDown: { borderTopWidth: 8 },
  bubbleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bubbleBody: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  iconBox: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  bubbleFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: c.cardBorder, borderWidth: 1, borderColor: c.cardBorder,
  },
  dotActive: { backgroundColor: c.emerald, borderColor: c.emerald, width: 18 },
  dotDone: { backgroundColor: '#1a3a2a', borderColor: c.emerald },
});
}

/** Styles portés par la palette de la BULLE (celle de l'app, ou son inverse en mode guide). */
function makeBubbleStyles(c: any) {
  return StyleSheet.create({
  bubble: {
    // `left` et `width` sont calculés au rendu (centrage sur la cible + largeur bornée).
    position: 'absolute',
    backgroundColor: c.cardSolid, borderRadius: 18,
    borderWidth: 1, borderColor: c.emerald + '44',
    padding: 18, gap: 14,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 12px 40px rgba(0,0,0,0.5)' } as any
      : { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 }),
  },
  screenTitle: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  skip: { fontSize: 13, color: c.textSecondary },
  title: { fontSize: 17, fontWeight: '800', color: c.text, marginBottom: 4 },
  desc: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.emerald, borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 18,
  },
  nextLabel: { fontSize: 14, fontWeight: '700', color: c.bg },
});
}
