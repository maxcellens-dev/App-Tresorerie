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
  /** Retourne la ref de la View à mettre en avant (MESURÉE au moment de l'affichage). */
  getRef?: () => React.RefObject<any>;
  /** Plusieurs cibles : chacune est mesurée et reçoit SON cadre ; le trou de l'overlay les couvre toutes. */
  getRefs?: () => React.RefObject<any>[];
  /** Alternative : rectangle calculé — prioritaire sur getRef. À éviter (fragile selon l'appareil) :
      préférer une ref réelle, au besoin via lib/guideAnchors pour les composants partagés. */
  getRect?: () => { x: number; y: number; w: number; h: number };
  /** Cadre circulaire (ex. avatar) au lieu d'arrondi. */
  circle?: boolean;
  /** Méthode privilégiée : NOMME le ou les éléments à surligner. C'est le bouton qui trace sa
      bordure (<GuideRing>), donc AUCUNE mesure. Ni spotlight sombre : la cible ressort d'elle-même. */
  highlightKey?: GuideHighlightKey | GuideHighlightKey[];
  /** Place la bulle en haut ou en bas de l'écran (ne recouvre jamais la cible). */
  placement?: 'top' | 'bottom';
  /** Mode auto-bordure : réf. d'un élément près duquel poser la bulle. Mesuré UNIQUEMENT pour la
      hauteur de la bulle (tolérant à un petit écart) — la mise en avant, elle, reste auto-tracée. */
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

interface Rect { x: number; y: number; w: number; h: number; }


const PAD = 8;             // marge autour du spotlight
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
  // Cibles mesurées : chacune reçoit son cadre ; le trou de l'overlay = leur enveloppe commune.
  const [frames, setFrames] = useState<Rect[] | null>(null);
  const [measuring, setMeasuring] = useState(true);
  // Rect de l'ancre (mode auto-bordure) : bornes verticales pour poser la bulle juste au-dessus /
  // dessous, et centre horizontal pour la caler sur la cible (utile dès que la fenêtre est large).
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; centerX: number } | null>(null);
  // Hauteur RÉELLE de la bulle (mesurée) → positionnement fiable quel que soit le texte/écran.
  const [bubbleH, setBubbleH] = useState(BUBBLE_H);
  const attemptRef = useRef(0);

  const step = steps[currentStep];
  const selfMode = !!step?.highlightKey; // le bouton trace sa propre bordure → aucune mesure

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
        const m = () => aref.measureInWindow((x: number, y: number, w: number, h: number) => {
          if (h > 0) setAnchor({ top: y, bottom: y + h, centerX: x + w / 2 });
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

    // 1) Scroller pour rendre la (première) cible visible.
    //
    // WEB : `findNodeHandle` LÈVE une exception sur react-native-web (« not supported on web ») —
    // elle remontait jusqu'au GlobalErrorBoundary, donc écran « Oups, un souci est survenu » dès
    // qu'une bulle visait un élément de la page. On passe donc par le DOM : position de la cible
    // dans la fenêtre (measureInWindow) + défilement courant du conteneur = offset absolu visé.
    if (Platform.OS === 'web') {
      const el: any = (scrollRef?.current as any)?.getScrollableNode?.();
      if (el && typeof nodes[0].measureInWindow === 'function') {
        const currentY = Number(el.scrollTop) || 0;
        nodes[0].measureInWindow((_x: number, y: number) => {
          if (cancelled || myAttempt !== attemptRef.current) return;
          scrollRef?.current?.scrollTo({ y: Math.max(0, currentY + y - SH * 0.28), animated: true });
          setTimeout(() => measureAll(), 380);
        });
      } else {
        measureAll();
      }
      return () => { cancelled = true; };
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentStep, selfMode]);

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
      const extra = step.anchorOffset ?? 0;
      const raw = step.anchorPlacement === 'above'
        ? anchor.top - bubbleH - 18 - extra
        : anchor.bottom + 30 + extra;
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

  /* Position HORIZONTALE : la bulle est une carte bornée, centrée sur ce qu'elle commente.
     Sur téléphone elle occupe toute la largeur utile (comme avant) ; sur écran large elle se cale
     sur sa cible au lieu de s'étirer d'un bord à l'autre. Toujours clampée dans la fenêtre. */
  const bubbleW = Math.min(SW - 32, BUBBLE_MAX_W);
  const targetCenterX = spot ? spot.x + spot.w / 2 : anchor?.centerX ?? null;
  const bubbleLeft = targetCenterX == null
    ? (SW - bubbleW) / 2
    : Math.min(Math.max(targetCenterX - bubbleW / 2, 16), Math.max(16, SW - 16 - bubbleW));

  // Position horizontale de la flèche (centrée sur la cible, sans déborder de la bulle)
  const arrowLeft = spot
    ? Math.min(bubbleLeft + bubbleW - 32, Math.max(bubbleLeft + 16, spot.x + spot.w / 2 - 8))
    : bubbleLeft + bubbleW / 2 - 8;

  return (
    // RootPortal (pas Modal) : rendu dans la MÊME fenêtre que les boutons ciblés → measureInWindow
    // et le dessin partagent le même repère, les cadres tombent PILE sur les boutons. Voir lib/rootPortal.
    <RootPortal>
    <View style={styles.fill} pointerEvents="box-none">
      {/* Mode auto-bordure : AUCUN voile sombre — la cible ressort d'elle-même via sa bordure. Un
          calque transparent capte le tap (bloquant) et permet de sortir en touchant à côté. */}
      {/* Étape OBLIGATOIRE (hideSkip) : aucun calque bloquant — la cible entourée doit rester
          appuyable, c'est justement le geste qu'on demande. Sinon, calque transparent qui capte le
          tap « à côté » pour sortir du guide. */}
      {selfMode && !hideSkip && (
        <TouchableOpacity activeOpacity={1} onPress={dismiss} style={StyleSheet.absoluteFill} />
      )}
      {/* Modes hérités (autres écrans) : voile sombre avec trou (spotlight) mesuré. */}
      {!selfMode && spot && !measuring ? (
        <>
          {/* Haut */}
          <TouchableOpacity activeOpacity={1} onPress={dismiss}
            style={[styles.mask, { top: 0, left: 0, right: 0, height: spot.y }]} />
          {/* Bas */}
          <TouchableOpacity activeOpacity={1} onPress={dismiss}
            style={[styles.mask, { top: spot.y + spot.h, left: 0, right: 0, bottom: 0 }]} />
          {/* Gauche */}
          <TouchableOpacity activeOpacity={1} onPress={dismiss}
            style={[styles.mask, { top: spot.y, left: 0, width: spot.x, height: spot.h }]} />
          {/* Droite */}
          <TouchableOpacity activeOpacity={1} onPress={dismiss}
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
        <TouchableOpacity activeOpacity={1} onPress={dismiss} style={[styles.mask, StyleSheet.absoluteFillObject]} />
      ) : null}

      {/* ── Flèche pointeur ── */}
      {spot && !measuring && pointer && (
        <View
          pointerEvents="none"
          style={[
            styles.arrow,
            pointer === 'up'
              ? { top: bubbleTop - 8, left: arrowLeft, borderBottomColor: b.cardSolid }
              : { top: bubbleTop + bubbleH - 2, left: arrowLeft, borderTopColor: b.cardSolid },
            pointer === 'up' ? styles.arrowUp : styles.arrowDown,
          ]}
        />
      )}

      {/* ── Bulle ── */}
      {!measuring && (
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
