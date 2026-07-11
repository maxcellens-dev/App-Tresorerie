/**
 * GuideOverlay — guide interactif en "bulles" dynamiques.
 * Pour chaque étape :
 *   1. scrolle automatiquement pour amener la zone cible à l'écran
 *   2. assombrit le reste de l'écran (spotlight sur la cible)
 *   3. affiche une bulle (tooltip) qui pointe vers la zone
 *
 * Chaque étape fournit `getRef()` → ref de la View cible.
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  findNodeHandle, Platform, ScrollView, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from '../hooks/useAppColors';
import { RootPortal } from '../lib/rootPortal';
import { setGuideHighlight, type GuideHighlightKey } from '../lib/guideHighlight';

const { width: SW, height: SH } = Dimensions.get('window');

export interface BubbleStep {
  /** Retourne la ref de la View à mettre en avant (MESURÉE au moment de l'affichage). */
  getRef?: () => React.RefObject<any>;
  /** Plusieurs cibles : chacune est mesurée et reçoit SON cadre ; le trou de l'overlay les couvre toutes. */
  getRefs?: () => React.RefObject<any>[];
  /** Alternative : rectangle calculé — prioritaire sur getRef. À éviter (fragile selon l'appareil) :
      préférer une ref réelle, au besoin via lib/guideAnchors pour les composants partagés. */
  getRect?: () => { x: number; y: number; w: number; h: number };
  /** Cadre circulaire (ex. avatar) au lieu d'arrondi. */
  circle?: boolean;
  /** Méthode privilégiée : NOMME l'élément à surligner. C'est le bouton qui trace sa bordure
      (<GuideRing>), donc AUCUNE mesure. Ni spotlight sombre : la cible ressort d'elle-même. */
  highlightKey?: GuideHighlightKey;
  /** Place la bulle en haut ou en bas de l'écran (ne recouvre jamais la cible). */
  placement?: 'top' | 'bottom';
  /** Mode auto-bordure : réf. d'un élément près duquel poser la bulle. Mesuré UNIQUEMENT pour la
      hauteur de la bulle (tolérant à un petit écart) — la mise en avant, elle, reste auto-tracée. */
  anchorRef?: () => React.RefObject<any>;
  /** Côté où poser la bulle par rapport à l'ancre (défaut 'below'). */
  anchorPlacement?: 'above' | 'below';
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
}

interface Rect { x: number; y: number; w: number; h: number; }


const PAD = 8;             // marge autour du spotlight
const BUBBLE_H = 230;      // hauteur estimée de la bulle (pour décider au-dessus/en-dessous)

export default function GuideOverlay({
  visible, steps, currentStep, onNext, onSkip, scrollRef, screenTitle,
}: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  // Zones sûres haut/bas. Robuste sur tous les téléphones : à l'intérieur d'un Modal, les insets
  // peuvent être à 0 → on retombe sur StatusBar.currentHeight (Android) pour ne jamais passer la
  // bulle sous l'encoche / la barre de statut.
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const TOP_SAFE = topInset + 12;
  const BOTTOM_SAFE = Math.max(insets.bottom, 16) + 12;
  // Cibles mesurées : chacune reçoit son cadre ; le trou de l'overlay = leur enveloppe commune.
  const [frames, setFrames] = useState<Rect[] | null>(null);
  const [measuring, setMeasuring] = useState(true);
  // Rect vertical de l'ancre (mode auto-bordure) : bornes pour poser la bulle juste au-dessus/dessous.
  const [anchor, setAnchor] = useState<{ top: number; bottom: number } | null>(null);
  // Hauteur RÉELLE de la bulle (mesurée) → positionnement fiable quel que soit le texte/écran.
  const [bubbleH, setBubbleH] = useState(BUBBLE_H);
  const attemptRef = useRef(0);

  const step = steps[currentStep];
  const selfMode = !!step?.highlightKey; // le bouton trace sa propre bordure → aucune mesure

  // Pilote le registre de mise en avant : la clé de l'étape courante (ou rien) → le bouton concerné
  // affiche/retire son <GuideRing>. Nettoyé à la fermeture / au démontage.
  useEffect(() => {
    setGuideHighlight(visible && step ? step.highlightKey ?? null : null);
    return () => setGuideHighlight(null);
  }, [visible, step]);

  useEffect(() => {
    if (!visible || !step) return;
    // Mode auto-bordure : la mise en avant est auto-tracée (rien à mesurer). On mesure seulement,
    // le cas échéant, le bas de l'ancre pour poser la bulle juste dessous (tolérant, même fenêtre).
    if (selfMode) {
      setFrames(null);
      setMeasuring(false);
      setAnchor(null);
      const aref = step.anchorRef?.().current;
      if (aref?.measureInWindow) {
        let tries = 0;
        const m = () => aref.measureInWindow((_x: number, y: number, _w: number, h: number) => {
          if (h > 0) setAnchor({ top: y, bottom: y + h });
          else if (tries++ < 5) setTimeout(m, 120);
        });
        const t = setTimeout(m, 60); // laisser le layout se poser
        return () => clearTimeout(t);
      }
      return;
    }
    let cancelled = false;
    attemptRef.current += 1;
    const myAttempt = attemptRef.current;
    setMeasuring(true);
    setFrames(null);

    // Étape à rectangle calculé (héritage) : pas de mesure ni de scroll.
    if (step.getRect) {
      const r = step.getRect();
      if (r) { setFrames([r]); setMeasuring(false); return; }
    }

    // Cibles réelles : une ou plusieurs refs, TOUTES mesurées au moment de l'affichage
    // (measureInWindow) — jamais de position estimée ni mise en cache.
    const nodes = (step.getRefs ? step.getRefs() : step.getRef ? [step.getRef()] : [])
      .map((r) => r?.current)
      .filter((n) => n && typeof n.measureInWindow === 'function');
    if (nodes.length === 0) {
      // Pas de cible → bulle centrée
      setMeasuring(false);
      return;
    }

    const measureAll = (retries = 0) => {
      if (cancelled || myAttempt !== attemptRef.current) return;
      const out: (Rect | null)[] = new Array(nodes.length).fill(null);
      let pending = nodes.length;
      nodes.forEach((node, i) => {
        node.measureInWindow((x: number, y: number, w: number, h: number) => {
          out[i] = { x, y, w, h };
          pending -= 1;
          if (pending > 0) return;
          if (cancelled || myAttempt !== attemptRef.current) return;
          // Une cible pas encore posée (0×0) → retenter, le layout n'est pas fini.
          if (out.some((r) => !r || (r.w === 0 && r.h === 0)) && retries < 5) {
            setTimeout(() => measureAll(retries + 1), 120);
            return;
          }
          const good = out.filter((r): r is Rect => !!r && r.w > 0 && r.h > 0);
          setFrames(good.length > 0 ? good : null);
          setMeasuring(false);
        });
      });
    };

    // 1) Scroller pour rendre la (première) cible visible (via measureLayout vs ScrollView)
    const scrollNode = scrollRef?.current ? findNodeHandle(scrollRef.current) : null;
    if (scrollNode && typeof nodes[0].measureLayout === 'function') {
      nodes[0].measureLayout(
        scrollNode,
        (_lx: number, ly: number) => {
          if (cancelled || myAttempt !== attemptRef.current) return;
          // Positionner la cible vers le tiers haut de l'écran
          const targetY = Math.max(0, ly - SH * 0.28);
          scrollRef?.current?.scrollTo({ y: targetY, animated: true });
          setTimeout(() => measureAll(), 380);
        },
        () => measureAll(),
      );
    } else {
      measureAll();
    }

    return () => { cancelled = true; };
  }, [visible, currentStep, step]);

  if (!visible || !step) return null;

  const isLast = currentStep === steps.length - 1;

  // Spotlight = enveloppe de TOUTES les cibles (clampée à l'écran) : la découpe de l'overlay les
  // laisse toutes en pleine lumière, chacune recevant en plus son propre cadre.
  const union = frames && frames.length > 0
    ? frames.reduce((a, r) => ({
        x1: Math.min(a.x1, r.x), y1: Math.min(a.y1, r.y),
        x2: Math.max(a.x2, r.x + r.w), y2: Math.max(a.y2, r.y + r.h),
      }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity })
    : null;
  const spot = union
    ? {
        x: Math.max(0, union.x1 - PAD),
        y: Math.max(0, union.y1 - PAD),
        w: Math.min(SW, union.x2 - union.x1 + PAD * 2),
        h: union.y2 - union.y1 + PAD * 2,
      }
    : null;

  // Position de la bulle : sous la cible si elle tient entièrement, sinon au-dessus, sinon dans la
  // plus grande zone libre (sans flèche). Toujours CLAMPÉE dans la zone visible → jamais coupée.
  const maxTop = SH - BOTTOM_SAFE - bubbleH; // plus haut possible pour que la bulle tienne en bas
  let bubbleTop: number;
  let pointer: 'up' | 'down' | null = null;
  if (selfMode) {
    // Mode auto-bordure : bulle posée juste sous l'ancre (ex. sous « Créer Compte ») ou juste
    // au-dessus (ex. au-dessus de la barre du bas), avec une marge confortable. Sinon repli haut/bas.
    // Jamais sur la cible, qui s'éclaire via sa propre bordure.
    if (anchor) {
      const raw = step.anchorPlacement === 'above'
        ? anchor.top - bubbleH - 18
        : anchor.bottom + 30;
      bubbleTop = Math.min(Math.max(raw, TOP_SAFE), Math.max(TOP_SAFE, maxTop));
    } else {
      bubbleTop = step.placement === 'top' ? TOP_SAFE + 56 : Math.max(TOP_SAFE, maxTop);
    }
    pointer = null;
  } else if (step.placement === 'bottom') {
    // Épinglée en bas, TOUJOURS : ne recouvre jamais la cible (demandé pour « Commence ici »).
    bubbleTop = Math.max(TOP_SAFE, maxTop);
    pointer = spot && spot.y + spot.h + 14 <= bubbleTop ? 'up' : null;
  } else if (spot) {
    const belowY = spot.y + spot.h + 14;
    const aboveY = spot.y - bubbleH - 14;
    if (belowY <= maxTop) {
      bubbleTop = belowY; pointer = 'up';
    } else if (aboveY >= TOP_SAFE) {
      bubbleTop = aboveY; pointer = 'down';
    } else {
      // Ne tient ni dessous ni dessus en entier → on choisit la plus grande zone, sans flèche.
      const spaceBelow = SH - BOTTOM_SAFE - (spot.y + spot.h);
      const spaceAbove = spot.y - TOP_SAFE;
      bubbleTop = spaceBelow >= spaceAbove ? maxTop : TOP_SAFE;
      pointer = null;
    }
    bubbleTop = Math.min(Math.max(bubbleTop, TOP_SAFE), Math.max(TOP_SAFE, maxTop));
  } else {
    bubbleTop = Math.max(TOP_SAFE, (SH - bubbleH) / 2);
  }

  // Position horizontale de la flèche (centrée sur la cible)
  const arrowLeft = spot
    ? Math.min(SW - 48, Math.max(24, spot.x + spot.w / 2 - 8))
    : SW / 2 - 8;

  return (
    // RootPortal (pas Modal) : rendu dans la MÊME fenêtre que les boutons ciblés → measureInWindow
    // et le dessin partagent le même repère, les cadres tombent PILE sur les boutons. Voir lib/rootPortal.
    <RootPortal>
    <View style={styles.fill} pointerEvents="box-none">
      {/* Mode auto-bordure : AUCUN voile sombre — la cible ressort d'elle-même via sa bordure. Un
          calque transparent capte le tap (bloquant) et permet de sortir en touchant à côté. */}
      {selfMode && (
        <TouchableOpacity activeOpacity={1} onPress={onSkip} style={StyleSheet.absoluteFill} />
      )}
      {/* Modes hérités (autres écrans) : voile sombre avec trou (spotlight) mesuré. */}
      {!selfMode && spot && !measuring ? (
        <>
          {/* Haut */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: 0, left: 0, right: 0, height: spot.y }]} />
          {/* Bas */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: spot.y + spot.h, left: 0, right: 0, bottom: 0 }]} />
          {/* Gauche */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: spot.y, left: 0, width: spot.x, height: spot.h }]} />
          {/* Droite */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: spot.y, left: spot.x + spot.w, right: 0, height: spot.h }]} />
          {/* Cadre lumineux autour de CHAQUE cible (cercle si demandé, ex. avatar) */}
          {frames?.map((f, i) => {
            const inflate = 4;
            const w = f.w + inflate * 2;
            const h = f.h + inflate * 2;
            return (
              <View
                key={i}
                pointerEvents="none"
                style={[styles.highlight, {
                  top: f.y - inflate, left: f.x - inflate, width: w, height: h,
                  borderRadius: step.circle ? Math.min(w, h) / 2 : 14,
                }]}
              />
            );
          })}
        </>
      ) : !selfMode ? (
        // Pas de cible mesurée → overlay plein
        <TouchableOpacity activeOpacity={1} onPress={onSkip} style={[styles.mask, StyleSheet.absoluteFillObject]} />
      ) : null}

      {/* ── Flèche pointeur ── */}
      {spot && !measuring && pointer && (
        <View
          pointerEvents="none"
          style={[
            styles.arrow,
            pointer === 'up'
              ? { top: bubbleTop - 8, left: arrowLeft, borderBottomColor: COLORS.cardSolid }
              : { top: bubbleTop + bubbleH - 2, left: arrowLeft, borderTopColor: COLORS.cardSolid },
            pointer === 'up' ? styles.arrowUp : styles.arrowDown,
          ]}
        />
      )}

      {/* ── Bulle ── */}
      {!measuring && (
        <View
          style={[styles.bubble, { top: bubbleTop }]}
          pointerEvents="auto"
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && Math.abs(h - bubbleH) > 1) setBubbleH(h);
          }}
        >
          {/* Header */}
          <View style={styles.bubbleHeader}>
            {screenTitle && <Text style={styles.screenTitle}>Guide — {screenTitle}</Text>}
            <TouchableOpacity onPress={onSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.skip}>Passer</Text>
            </TouchableOpacity>
          </View>

          {/* Contenu */}
          <View style={styles.bubbleBody}>
            <View style={[styles.iconBox, { backgroundColor: step.iconColor + '22', borderColor: step.iconColor + '44' }]}>
              <Ionicons name={step.icon as any} size={26} color={step.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{step.title}</Text>
              <Text style={styles.desc}>{step.description}</Text>
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
            <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
              <Text style={styles.nextLabel}>{isLast ? 'Terminer' : 'Suivant'}</Text>
              <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={16} color="#020617" />
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
  bubble: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: c.cardSolid, borderRadius: 18,
    borderWidth: 1, borderColor: c.border,
    padding: 18, gap: 14,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 12px 40px rgba(0,0,0,0.5)' } as any
      : { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 }),
  },
  bubbleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  screenTitle: { fontSize: 12, color: c.sub, fontWeight: '600' },
  skip: { fontSize: 13, color: c.sub },
  bubbleBody: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  iconBox: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '800', color: c.text, marginBottom: 4 },
  desc: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },
  bubbleFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: c.cardBorder, borderWidth: 1, borderColor: c.cardBorder,
  },
  dotActive: { backgroundColor: c.emerald, borderColor: c.emerald, width: 18 },
  dotDone: { backgroundColor: '#1a3a2a', borderColor: c.emerald },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.emerald, borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 18,
  },
  nextLabel: { fontSize: 14, fontWeight: '700', color: c.bg },
});
}
