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
 * l'amener à l'écran si elle est dans une zone défilante). Et là encore, la bulle ne peut PAS
 * recouvrir sa cible : on ne calcule pas « où elle commence », on fixe le bord qui l'en sépare et on
 * borne la place qu'elle a le droit d'occuper (cf. `place` plus bas). Sa hauteur n'entre jamais dans
 * le calcul, donc aucune estimation ne peut être fausse.
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Animated, Easing,
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

/* Largeur MAXIMALE de la bulle. Sans elle, `left:16 / right:16` étirait la bulle sur toute la
   fenêtre : sur un écran d'ordinateur, l'explication d'un bouton devenait un bandeau de 2 000 px
   de large, sans aucun lien visuel avec la petite zone qu'elle commente. Bornée, elle redevient
   une carte — et on la CENTRE sur sa cible pour dire de quoi elle parle. */
const BUBBLE_MAX_W = 460;
/** Respiration entre la cible encadrée et la bulle. */
const GAP = 16;
/** En dessous, une bulle n'est plus lisible (en-tête + deux lignes + bouton). */
const MIN_USABLE_H = 190;
/* Où amener la cible dans l'écran avant de poser la bulle : assez HAUT pour qu'il reste de la
   place en dessous, y compris pour une grande carte. À 28 % (l'ancienne valeur), une carte qui
   fait la moitié de l'écran ne laissait plus rien sous elle et la bulle devait passer au-dessus,
   voire se serrer. */
const SCROLL_TARGET_RATIO = 0.16;

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
  // Rect de l'ancre : bornes verticales pour poser la bulle au-dessus / en dessous, et centre
  // horizontal pour la caler sur la cible. `undefined` = pas encore mesuré, `null` = pas d'ancre.
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; centerX: number } | null | undefined>(undefined);
  /* Apparition de la bulle. La bulle n'est JAMAIS rendue tant que sa place n'est pas connue :
     c'est ce qui produisait le saut « la pop-up part du bas puis remonte » — elle s'affichait
     d'abord au repli (bas d'écran) le temps de la mesure, puis se replaçait d'un coup. */
  const appear = useRef(new Animated.Value(0)).current;

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
    // Nouvelle étape → on repart d'une bulle INVISIBLE, le temps de connaître sa place.
    setAnchor(undefined);
    appear.setValue(0);
    const aref = step.anchorRef?.().current;
    if (!aref?.measureInWindow) { setAnchor(null); return; }

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
            scrollRef.current?.scrollTo({ y: Math.max(0, currentY + y - SH * SCROLL_TARGET_RATIO), animated: true });
          });
        }
      } else {
        const scrollNode = findNodeHandle(scrollRef.current);
        if (scrollNode && typeof aref.measureLayout === 'function') {
          aref.measureLayout(scrollNode, (_lx: number, ly: number) => {
            if (cancelled) return;
            scrollRef.current?.scrollTo({ y: Math.max(0, ly - SH * SCROLL_TARGET_RATIO), animated: true });
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
        else setAnchor(null); // cible introuvable → bulle en bord d'écran plutôt que rien
      });
    };
    // Le défilement est ANIMÉ : mesurer avant qu'il ne se pose donnerait une position périmée, et
    // la bulle se retrouverait à côté de sa cible. On attend donc qu'il ait fini.
    const t = setTimeout(measure, scrollRef?.current ? 420 : 80);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentStep]);

  /* Entrée en douceur, une fois la place connue : la bulle monte/descend LÉGÈREMENT depuis sa
     cible, en fondu. Le petit retard laisse le défilement et le cadre se poser — sans lui, la
     bulle apparaît pendant que la page bouge encore, ce qui donne l'impression d'un à-coup. */
  useEffect(() => {
    if (anchor === undefined) return;
    const a = Animated.timing(appear, {
      toValue: 1, duration: 240, delay: 90,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [anchor, appear]);

  if (!visible || !step) return null;

  const isLast = currentStep === steps.length - 1;

  /* ══ PLACEMENT DE LA BULLE ═══════════════════════════════════════════════════════════════════
   *
   * RÈGLE : la bulle ne peut PAS recouvrir ce qu'elle désigne. Pas « on essaie de l'éviter » —
   * c'est impossible par construction, et c'est tout l'objet de ce calcul.
   *
   * Ce qui ne marchait pas, et pourquoi :
   *   • on posait la bulle à `top = bas de la cible + marge`, puis on la CLAMPAIT dans l'écran.
   *     Sur une grande carte, ce `top` tombait hors écran et le clamp la ramenait PAR-DESSUS la
   *     cible. Le clamp, censé protéger, était la cause du chevauchement ;
   *   • le choix du côté se faisait avec une hauteur DEVINÉE (230 px), corrigée seulement après le
   *     premier rendu : la décision était donc prise sur une valeur fausse dès que le texte était
   *     long — exactement les étapes où la place manque.
   *
   * Ce qu'on fait à la place — on ne calcule plus « où commence la bulle », on FIXE LE BORD QUI LA
   * SÉPARE DE LA CIBLE et on borne la place qu'elle a le droit d'occuper :
   *   • en dessous → `top` = bas de la cible + marge, `maxHeight` = ce qui reste jusqu'au bas ;
   *   • au-dessus → `bottom` = (écran − haut de la cible) + marge, `maxHeight` = ce qui reste
   *     jusqu'en haut. La bulle grandit alors VERS LE HAUT depuis une ligne fixe.
   * Dans les deux cas la hauteur de la bulle n'entre plus dans le calcul : quelle qu'elle soit,
   * elle ne peut ni franchir ce bord (le contenu défile à l'intérieur), ni sortir de l'écran.
   * Aucune estimation, aucun clamp, donc aucun chevauchement possible. */
  const bubbleW = Math.min(SW - 32, BUBBLE_MAX_W);
  const extra = step.anchorOffset ?? 0;

  const place = (() => {
    if (!anchor) {
      // Pas d'ancre : on se range en bord d'écran (jamais au milieu, où l'on masquerait le contenu
      // le plus probable). Rien à recouvrir ici, puisqu'il n'y a pas de cible désignée.
      const side = step.placement === 'top' ? 'top' : 'bottom';
      return {
        arrow: null as null | 'up' | 'down',
        left: (SW - bubbleW) / 2,
        ...(side === 'top'
          ? { top: TOP_SAFE, maxHeight: SH - TOP_SAFE - BOTTOM_SAFE }
          : { bottom: BOTTOM_SAFE, maxHeight: SH - TOP_SAFE - BOTTOM_SAFE }),
      };
    }

    const spaceAbove = anchor.top - TOP_SAFE - GAP - extra;
    const spaceBelow = SH - BOTTOM_SAFE - anchor.bottom - GAP - extra;
    const wantsAbove = step.anchorPlacement === 'above';
    // Le côté demandé s'il est utilisable, sinon celui qui offre le plus de place.
    const preferred = wantsAbove ? spaceAbove : spaceBelow;
    const above = preferred >= MIN_USABLE_H ? wantsAbove : spaceAbove > spaceBelow;
    /* Cible plus haute que l'écran moins une bulle lisible : les deux côtés sont trop étroits.
       On garde alors la bulle lisible (plancher) — le HAUT de la cible, celui qui porte son titre,
       reste visible, et c'est le seul cas où un recouvrement partiel subsiste. Il est inévitable :
       il n'existe pas de place pour les deux. */
    const room = Math.max(above ? spaceAbove : spaceBelow, MIN_USABLE_H);
    const left = Math.min(Math.max(anchor.centerX - bubbleW / 2, 16), Math.max(16, SW - 16 - bubbleW));

    return above
      ? { arrow: 'down' as const, left, bottom: SH - anchor.top + GAP + extra, maxHeight: room }
      : { arrow: 'up' as const, left, top: anchor.bottom + GAP + extra, maxHeight: room };
  })();

  /* Petite flèche vers la cible : maintenant qu'on sait de quel côté est la bulle ET où est le
     centre de la cible, elle est fiable — elle relie visuellement l'explication à ce qu'elle
     désigne, ce que le simple voisinage ne suffisait pas à dire. */
  const arrowLeft = anchor
    ? Math.min(Math.max(anchor.centerX - 8, place.left + 18), place.left + bubbleW - 34)
    : 0;

  // Glissement d'entrée : la bulle vient DEPUIS sa cible (elle descend si elle est en dessous,
  // elle monte si elle est au-dessus). Le mouvement dit d'où vient l'information.
  const enterShift = appear.interpolate({
    inputRange: [0, 1],
    outputRange: [place.arrow === 'down' ? 14 : -14, 0],
  });

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

      {/* ── Bulle ──
          RENDUE UNIQUEMENT une fois sa place connue (`anchor !== undefined`). C'est ce qui
          supprime le saut « elle apparaît en bas, puis remonte » : avant, elle s'affichait au repli
          le temps de la mesure, puis se replaçait d'un coup sous les yeux de l'utilisateur. */}
      {anchor !== undefined && (
        <Animated.View
          style={[
            bubbleStyles.bubble,
            {
              left: place.left, width: bubbleW, maxHeight: place.maxHeight,
              ...('top' in place ? { top: place.top } : { bottom: place.bottom }),
              opacity: appear,
              transform: [
                { translateY: enterShift },
                { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
              ],
            },
          ]}
          pointerEvents="auto"
        >
          {/* Flèche vers la cible, collée au bord qui lui fait face. */}
          {place.arrow && (
            <View
              pointerEvents="none"
              style={[
                styles.arrow,
                { left: arrowLeft - place.left },
                place.arrow === 'up'
                  ? [styles.arrowUp, { top: -8, borderBottomColor: b.cardSolid }]
                  : [styles.arrowDown, { bottom: -8, borderTopColor: b.cardSolid }],
              ]}
            />
          )}

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

          {/* Contenu — DÉFILANT : quand la place est comptée, c'est le texte qui défile, jamais le
              bouton « Suivant » qui se fait couper. `flexShrink` pour qu'il cède avant le pied. */}
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={styles.bubbleBody}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={[styles.iconBox, { backgroundColor: step.iconColor + '22', borderColor: step.iconColor + '44' }]}>
              <Ionicons name={step.icon as any} size={26} color={step.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={bubbleStyles.title}>{step.title}</Text>
              <Text style={bubbleStyles.desc}>{step.description}</Text>
            </View>
          </ScrollView>

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
            <TouchableOpacity style={bubbleStyles.nextBtn} onPress={onNext} activeOpacity={0.85}>
              <Text style={bubbleStyles.nextLabel}>{nextLabel ?? (isLast ? 'Terminer' : 'Suivant')}</Text>
              <Ionicons name={nextLabel ? 'arrow-forward' : isLast ? 'checkmark' : 'arrow-forward'} size={16} color={b.bg} />
            </TouchableOpacity>
          </View>
        </Animated.View>
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
    // `left`, `width`, `top`/`bottom` et `maxHeight` sont calculés au rendu (cf. `place`).
    position: 'absolute',
    backgroundColor: c.cardSolid, borderRadius: 20,
    borderWidth: 1, borderColor: c.emerald + '3D',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, gap: 14,
    // Ombre franche : la bulle doit se DÉTACHER de la page, pas s'y fondre — c'est ce qui la fait
    // lire comme une voix par-dessus l'app.
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 18px 48px rgba(0,0,0,0.42), 0 2px 8px rgba(0,0,0,0.22)' } as any
      : { shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 26, shadowOffset: { width: 0, height: 12 }, elevation: 16 }),
  },
  screenTitle: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  skip: { fontSize: 13, color: c.textSecondary },
  title: { fontSize: 17, fontWeight: '800', color: c.text, marginBottom: 5, letterSpacing: -0.2 },
  desc: { fontSize: 14, color: c.textSecondary, lineHeight: 20.5 },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.emerald, borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 18,
  },
  nextLabel: { fontSize: 14, fontWeight: '700', color: c.bg },
});
}
