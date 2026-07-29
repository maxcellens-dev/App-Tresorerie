/**
 * ÉCRANS DE PRÉSENTATION — la toute première ouverture de l'app.
 *
 * Six écrans pleine page qui MONTRENT l'app avant de demander quoi que ce soit : à quoi ressemble
 * un Relyka, une liste de comptes, une saisie, le suivi du mois, un projet, les conseils. Les
 * textes reprennent (condensés) les présentations de page qui s'ouvraient jusqu'ici à la 1ʳᵉ visite
 * de chaque onglet — d'où la mise en sommeil de ces modaux à la fin du carrousel : tout a déjà été
 * dit, au bon moment, sans couper l'utilisateur en pleine action.
 *
 * ⚠️ Les illustrations sont CONSTRUITES en composants, pas des captures d'écran. Trois raisons :
 * elles suivent le thème (clair/sombre) et la couleur d'accent choisie par l'utilisateur, elles ne
 * périment pas quand l'interface bouge, et elles ne pèsent rien dans le bundle. Les chiffres qu'on
 * y lit sont des EXEMPLES — jamais les données de l'utilisateur, qui n'en a pas encore.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Easing, ScrollView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/useAppColors';
import { useAppNameFontStyle, APP_NAME_TEXT_PROPS } from '../../hooks/useBrandFont';
import { useGuide } from '../../contexts/GuideContext';
import ScreenGradient from '../ScreenGradient';
import GrowthChart from '../GrowthChart';

interface Slide {
  key: string;
  eyebrow: string;
  title: string;
  /** Accepte `**gras**` et `==surligné==` (cf. RichText), et les retours à la ligne. */
  text: string;
  render: (c: any, s: any) => React.ReactNode;
}

/**
 * Petit balisage inline pour les textes de présentation : `**gras**` et `==surligné==`.
 *
 * Ces écrans portent la promesse de l'app : un pavé gris uniforme la rend illisible. Le surlignage
 * (fond d'accent, façon feutre) sert à poser LE mot qui doit rester — un seul par écran, sinon plus
 * rien ne ressort. Le gras, lui, marque les repères de lecture.
 */
function RichText({ value, style, c }: { value: string; style: any; c: any }) {
  const parts = value.split(/(\*\*[^*]+\*\*|==[^=]+==)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <Text key={i} style={{ fontWeight: '800', color: c.text }}>{p.slice(2, -2)}</Text>;
        }
        if (p.startsWith('==') && p.endsWith('==')) {
          // Espaces insécables : elles font la « marge » du surlignage — Android ignore le
          // borderRadius et le padding sur un Text imbriqué, mais respecte le fond.
          return (
            <Text key={i} style={{ backgroundColor: c.emerald + '33', color: c.text, fontWeight: '800' }}>
              {' ' + p.slice(2, -2) + ' '}
            </Text>
          );
        }
        return <Text key={i}>{p}</Text>;
      })}
    </Text>
  );
}

/**
 * Monté à la RACINE de l'app : le carrousel ne doit pas dépendre du chargement du tableau de bord
 * (l'écran d'arrivée). Rendu depuis le Pilotage, il n'apparaissait qu'une fois les données là —
 * l'utilisateur voyait d'abord un tableau de bord vide, ce qui est exactement ce qu'on veut éviter.
 */
export function AppIntroGate() {
  const guide = useGuide();
  return (
    <AppIntroCarousel
      visible={guide.is('intro') || guide.booting}
      // `booting` : le parcours est en jeu mais l'étape n'est pas encore connue (comptes et
      // transactions en cours de lecture). On tient l'écran avec le MÊME fond et le MÊME logo que
      // le carrousel → le passage au 1er écran est invisible, au lieu de laisser apparaître une
      // seconde d'app derrière.
      booting={guide.booting}
      onDone={() => guide.done('g2_intro')}
    />
  );
}

export default function AppIntroCarousel({ visible, booting, onDone }: {
  visible: boolean; booting?: boolean; onDone: () => void;
}) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const appNameFontStyle = useAppNameFontStyle();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const rise = useRef(new Animated.Value(1)).current;

  /* ── ENTRÉE DANS L'APP ────────────────────────────────────────────────────────────────────────
     Jusqu'ici, « Commencer » faisait disparaître le carrousel d'un coup : on se retrouvait sur le
     tableau de bord sans avoir rien franchi. Il manquait le moment de bascule.
     La sortie se joue donc en trois temps, sur une seule valeur (0 → 1) :
       1. le CONTENU part vers le haut en s'effaçant — la présentation se retire ;
       2. le logo de marque grossit un instant au centre — le repère qu'on garde entre les deux ;
       3. tout l'écran s'écarte vers l'avant (zoom + fondu) — on passe DANS l'app, qui est déjà
          montée dessous et se découvre en grand.
     `useNativeDriver` partout (opacité + transformations uniquement) : fluide même sur un appareil
     modeste. Court (≈ 620 ms) : une transition, pas une attente. */
  const [leaving, setLeaving] = useState(false);
  const exit = useRef(new Animated.Value(0)).current;
  /* Apparition : le Modal n'a plus d'animation native (elle écrasait la sortie), on la refait donc
     ici. Courte et sans mouvement : les écrans de présentation doivent être là tout de suite. */
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) { enter.setValue(0); return; }
    Animated.timing(enter, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [visible, enter]);

  const enterApp = () => {
    if (leaving) return;                     // double tap : une seule sortie
    setLeaving(true);
    Animated.timing(exit, {
      toValue: 1,
      duration: 620,
      easing: Easing.bezier(0.4, 0, 0.2, 1), // départ franc, arrivée douce
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) onDone(); });
  };

  const SLIDES: Slide[] = useMemo(() => [
    {
      key: 'relyka',
      eyebrow: 'Bienvenue',
      title: 'Combien va-t-il\nvraiment te rester ?',
      // C'est LA première phrase lue : elle doit répondre à la question que tout le monde se pose en
      // ouvrant une app de budget — pas définir un concept maison. On dit donc ce que le chiffre EST
      // (ce qui restera à la fin du mois), ce qu'il n'est PAS (le solde du jour), et à quoi il sert.
      text: '**Ton Relyka**, c’est ce qui devrait te rester **à la fin du mois**, une fois ton loyer, tes factures et tes dépenses habituelles déjà couverts.\n\nPas ton solde du jour : ==ton vrai surplus==.\nCelui que tu peux épargner, investir ou dépenser sans mauvaise surprise.',
      render: (c, s) => <MockRelyka c={c} s={s} />,
    },
    {
      key: 'comptes',
      eyebrow: 'Tes comptes',
      title: 'Tout ton argent\nau même endroit',
      text: 'Courants, épargne, investissement, crédits.\n\nTu recopies simplement le solde affiché par ta banque : c’est lui qui rend ==tous tes chiffres justes==.',
      render: (c, s) => <MockComptes c={c} s={s} />,
    },
    {
      key: 'transactions',
      eyebrow: 'Tes transactions',
      title: 'Saisis une fois,\nc’est réglé',
      text: 'Salaire, loyer, abonnements : coche **« Récurrent »** une fois.\n\nIls se rejouent tout seuls chaque mois — et ton mois est ==anticipé, pas subi==.',
      render: (c, s) => <MockTransactions c={c} s={s} />,
    },
    {
      key: 'pilotage',
      eyebrow: 'Ton pilotage',
      title: 'Décide\nen un coup d’œil',
      text: 'Le suivi du mois te dit **où passe ton argent**.\n\nEt pour ce qu’il reste, Relyka te fais\n ==des recommandations== : \népargner, investir, mettre de côté, \nou en profiter.',
      render: (c, s) => <MockPilotage c={c} s={s} />,
    },
    {
      key: 'projets',
      eyebrow: 'Projets & projection',
      title: 'Vise plus loin\nque la fin du mois',
      text: 'Un voyage, une voiture : tu fixes le montant, Relyka s’occupe de **mettre de côté** chaque mois.\n\nEt tu vois ==où tu en seras dans un an==.',
      render: (c, s) => <MockProjets c={c} s={s} />,
    },
    {
      key: 'ia',
      eyebrow: 'Conseils intelligents',
      title: 'Une analyse\nrien que pour toi',
      text: 'Relyka transmet **tes chiffres anonymisés** \n— Une IA te répond — \net t’explique où tu en es, en français.\n\nDes conseils ==adaptés à ta situation==.',
      render: (c, s) => <MockAi c={c} s={s} />,
    },
  ], []);

  const last = index === SLIDES.length - 1;

  const goTo = (next: number) => {
    Animated.timing(fade, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setIndex(next);
      // L'illustration remonte légèrement APRÈS le texte : le regard se pose sur le titre, puis
      // l'exemple arrive. C'est ce petit décalage qui donne le côté « présentation » plutôt que
      // « diaporama ».
      rise.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      Animated.spring(rise, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10, delay: 70 }).start();
    });
  };

  if (!visible) return null;
  const slide = SLIDES[index];

  // Écran de TRANSITION : même fond, même logo, mais rien d'autre — on ne montre pas des étapes
  // avant de savoir laquelle s'applique. Il cède la place au 1er écran sans aucune rupture visuelle.
  if (booting) {
    return (
      <Modal visible transparent={false} animationType="none" statusBarTranslucent onRequestClose={() => {}}>
        <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
          <ScreenGradient />
          <Image source={require('../../assets/logo.png')} style={styles.bootLogo} resizeMode="contain" fadeDuration={0} />
        </View>
      </Modal>
    );
  }

  /* ── Étapes de la sortie, découpées sur la même valeur 0 → 1 ──────────────────────────────────
     Chaque élément a sa fenêtre : le contenu s'en va d'abord (0 → 0.45), le logo prend le relais
     au milieu (0.15 → 0.75), et l'écran entier ne s'ouvre qu'à la fin (0.55 → 1). C'est ce
     décalage qui fait lire une SÉQUENCE (« je sors, puis j'entre ») au lieu d'un simple fondu. */
  const contentOut = {
    opacity: exit.interpolate({ inputRange: [0, 0.45], outputRange: [1, 0], extrapolate: 'clamp' }),
    transform: [
      { translateY: exit.interpolate({ inputRange: [0, 0.45], outputRange: [0, -40], extrapolate: 'clamp' }) },
      { scale: exit.interpolate({ inputRange: [0, 0.45], outputRange: [1, 0.94], extrapolate: 'clamp' }) },
    ],
  };
  // Le logo grossit doucement puis s'efface avec l'écran : c'est le seul repère qui traverse la
  // transition, celui qu'on retrouve ensuite dans l'en-tête de l'app.
  const markStyle = {
    opacity: exit.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0, 1, 0], extrapolate: 'clamp' }),
    transform: [
      { scale: exit.interpolate({ inputRange: [0.15, 0.75, 1], outputRange: [0.5, 1, 1.6], extrapolate: 'clamp' }) },
    ],
  };
  // L'écran s'écarte vers l'avant : on ne le voit pas « disparaître », on le TRAVERSE.
  const screenOut = {
    // Apparition ET sortie sur la même opacité : elles ne se chevauchent jamais (l'une finit avant
    // que l'autre ne démarre), le produit vaut donc toujours celle qui est en cours.
    opacity: Animated.multiply(
      enter,
      exit.interpolate({ inputRange: [0.55, 1], outputRange: [1, 0], extrapolate: 'clamp' }),
    ),
    transform: [
      { scale: exit.interpolate({ inputRange: [0.55, 1], outputRange: [1, 1.12], extrapolate: 'clamp' }) },
    ],
  };

  return (
    /* `animationType="none"` : la sortie est ENTIÈREMENT la nôtre — le fondu natif du Modal se
       superposait à elle et écrasait la séquence en un simple évanouissement.
       `transparent` : INDISPENSABLE ici. Avec une fenêtre opaque, s'effacer ne découvrait que le
       fond du Modal, pas l'app — la transition ne pouvait pas se lire comme « j'entre ». L'écran
       reste visuellement plein : c'est `styles.root` (couleur de fond) qui le couvre, et c'est LUI
       qu'on écarte pour laisser paraître le tableau de bord déjà monté dessous. */
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <Animated.View style={[styles.root, screenOut]}>
        <ScreenGradient />
        {/* Logo de bascule : présent seulement pendant la sortie, au centre exact de l'écran. */}
        {leaving && (
          <Animated.View style={[styles.exitMark, markStyle]} pointerEvents="none">
            <Image source={require('../../assets/logo.png')} style={styles.bootLogo} resizeMode="contain" fadeDuration={0} />
          </Animated.View>
        )}
        <Animated.View style={[{ flex: 1 }, contentOut]}>
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>

          <View style={styles.topBar}>
            {index > 0 ? (
              <TouchableOpacity onPress={() => goTo(index - 1)} hitSlop={10} style={{ padding: 4 }} accessibilityLabel="Écran précédent">
                <Ionicons name="arrow-back" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ) : <View style={{ width: 30 }} />}
            {/* Logo + nom : sans lui le haut de l'écran sonnait vide, et on perdait la signature de
                marque sur les six écrans les plus regardés de l'app. */}
            <View style={styles.brandRow}>
              <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" fadeDuration={0} />
              <Text {...APP_NAME_TEXT_PROPS} style={[styles.brand, appNameFontStyle]}>Relyka</Text>
            </View>
            <View style={{ width: 30 }} />
          </View>

          <Animated.View style={{ flex: 1, opacity: fade }}>
            {/* Défilable : sur un petit écran, titre + illustration + texte peuvent dépasser.
                `flexGrow` occupe tout l'espace quand il y en a, et on défile sinon. */}
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {/* Le GRAND TITRE seul en tête, précédé d'un peu d'air : c'est la place des titres
                  dans l'app, et il n'a rien au-dessus de lui qui vienne le concurrencer. */}
              <View style={styles.head}>
                <Text style={styles.title}>{slide.title}</Text>
              </View>

              {/* L'illustration et SON étiquette : l'étiquette annonce ce qu'on regarde, elle est
                  donc collée à l'image plutôt que perdue en haut d'écran. Le halo d'accent la
                  détache du fond — elle devient le sujet de l'écran, pas un encart. */}
              <Animated.View
                style={[
                  styles.artWrap,
                  { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
                ]}
              >
                <View style={styles.glowOuter} pointerEvents="none" />
                <View style={styles.glowInner} pointerEvents="none" />
                <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
                {slide.render(COLORS, styles)}
              </Animated.View>

              <RichText value={slide.text} style={styles.text} c={COLORS} />
            </ScrollView>
          </Animated.View>

          <View style={styles.footer}>
            <View style={styles.dots}>
              {SLIDES.map((s, i) => (
                <View key={s.key} style={[styles.dot, i === index && styles.dotActive]} />
              ))}
            </View>
            <TouchableOpacity
              style={styles.cta}
              onPress={() => (last ? enterApp() : goTo(index + 1))}
              disabled={leaving}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {/* Dernier écran : il rend la main sur le TABLEAU DE BORD, pas sur la création de
                  comptes — le libellé ne doit donc pas promettre un formulaire (c'est le bouton du
                  tableau de bord qui y emmène). */}
              <Text style={styles.ctaLabel}>{last ? 'Commencer' : 'Continuer'}</Text>
              <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/* ── Illustrations ────────────────────────────────────────────────────────────────────────────────
   Des maquettes, pas des captures : mêmes formes et mêmes couleurs que l'app réelle, avec des
   montants d'exemple. Elles restent volontairement légères (aucune donnée, aucun calcul). */

const eur = (n: number) => n.toLocaleString('fr-FR') + ' €';

function MockRelyka({ c, s }: any) {
  const tiles = [
    { label: 'Épargner', amount: 400, color: c.green ?? c.emerald, icon: 'shield' },
    { label: 'Investir', amount: 300, color: c.violet, icon: 'trending-up' },
    { label: 'Confort', amount: 240, color: c.orange, icon: 'sparkles' },
    { label: 'Conserver', amount: 300, color: c.blue, icon: 'hourglass' },
  ];
  return (
    <View style={s.mockCard}>
      <View style={s.mockRowBetween}>
        <Text style={s.mockLabel}>TON RELYKA</Text>
        <View style={[s.mockBadge, { backgroundColor: (c.green ?? c.emerald) + '1F', borderColor: (c.green ?? c.emerald) + '55' }]}>
          <Ionicons name="checkmark-circle" size={10} color={c.green ?? c.emerald} />
          <Text style={[s.mockBadgeText, { color: c.green ?? c.emerald }]}>À jour</Text>
        </View>
      </View>
      <Text style={[s.mockBig, { color: c.emerald }]}>1 240 €</Text>
      <View style={s.mockGrid}>
        {tiles.map((t) => (
          <View key={t.label} style={[s.mockTile, { backgroundColor: t.color + '12', borderColor: t.color + '3D' }]}>
            <View style={s.mockTileHead}>
              <Ionicons name={t.icon as any} size={12} color={t.color} />
              <Text style={s.mockTileLabel}>{t.label}</Text>
            </View>
            <Text style={[s.mockTileValue, { color: t.color }]}>{eur(t.amount)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MockComptes({ c, s }: any) {
  const totals = [
    { label: 'Courant', value: 1850, color: c.checking },
    { label: 'Épargne', value: 4200, color: c.savings },
    { label: 'Investi', value: 2300, color: c.investment },
  ];
  const rows = [
    { name: 'Compte courant', type: 'Courant · Principal', value: 1850, icon: 'wallet', color: c.checking },
    { name: 'Livret A', type: 'Épargne', value: 4200, icon: 'leaf', color: c.savings },
    { name: 'PEA', type: 'Investissement', value: 2300, icon: 'trending-up', color: c.investment },
  ];
  return (
    <View style={{ width: '100%', gap: 10 }}>
      <View style={s.mockTotals}>
        {totals.map((t) => (
          <View key={t.label} style={[s.mockTotal, { borderLeftColor: t.color }]}>
            <Text style={s.mockTotalLabel}>{t.label}</Text>
            <Text style={[s.mockTotalValue, { color: t.color }]}>{eur(t.value)}</Text>
          </View>
        ))}
      </View>
      <View style={s.mockList}>
        {rows.map((r, i) => (
          <View key={r.name} style={[s.mockRow, i < rows.length - 1 && s.mockRowBorder]}>
            <View style={[s.mockIcon, { backgroundColor: r.color + '1A' }]}>
              <Ionicons name={r.icon as any} size={15} color={r.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.mockRowTitle}>{r.name}</Text>
              <Text style={s.mockRowSub}>{r.type}</Text>
            </View>
            <Text style={s.mockRowValue}>{eur(r.value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MockTransactions({ c, s }: any) {
  const rows = [
    { name: 'Salaire', sub: 'Mensuel', value: 2100, recurring: true, icon: 'cash', color: c.green ?? c.emerald },
    { name: 'Loyer', sub: 'Mensuel', value: -780, recurring: true, icon: 'home', color: c.danger },
    { name: 'Courses', sub: '12 juin', value: -54, recurring: false, icon: 'cart', color: c.danger },
  ];
  return (
    <View style={s.mockList}>
      {rows.map((r, i) => (
        <View key={r.name} style={[s.mockRow, i < rows.length - 1 && s.mockRowBorder]}>
          <View style={[s.mockIcon, { backgroundColor: r.color + '1A' }]}>
            <Ionicons name={r.icon as any} size={15} color={r.color} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.mockRowTitleLine}>
              <Text style={s.mockRowTitle}>{r.name}</Text>
              {r.recurring && (
                <View style={[s.mockPill, { backgroundColor: c.orange + '1F', borderColor: c.orange + '55' }]}>
                  <Ionicons name="repeat" size={9} color={c.orange} />
                  <Text style={[s.mockPillText, { color: c.orange }]}>Récurrent</Text>
                </View>
              )}
            </View>
            <Text style={s.mockRowSub}>{r.sub}</Text>
          </View>
          <Text style={[s.mockRowValue, { color: r.value > 0 ? (c.green ?? c.emerald) : c.text }]}>
            {r.value > 0 ? '+' : ''}{eur(r.value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MockPilotage({ c, s }: any) {
  const lines = [
    { label: 'Tu as sur tes comptes', value: '1 850 €', color: c.text },
    { label: 'Tu as dépensé', value: '640 €', color: c.danger },
    { label: 'Tu devrais encore dépenser', value: '410 €', color: c.yellow },
    { label: 'Tu veux garder au moins', value: '300 €', color: c.teal },
  ];
  return (
    <View style={s.mockCard}>
      <Text style={s.mockCardTitle}>Ce mois-ci</Text>
      {lines.map((l, i) => (
        <View key={l.label} style={[s.mockLine, i > 0 && s.mockLineBorder]}>
          <Text style={s.mockLineLabel}>{l.label}</Text>
          <Text style={[s.mockLineValue, { color: l.color }]}>{l.value}</Text>
          <Ionicons name="chevron-forward" size={13} color={c.textSecondary} />
        </View>
      ))}
    </View>
  );
}

/* Courbe d'exemple : mêmes règles que la vraie projection (un versement mensuel, capitalisé au
   taux mensuel), pour que la ligne « capital investi » et l'écart qu'elle laisse sous la valeur
   soient plausibles plutôt que dessinés à la main. */
const PROJ_START = 2300, PROJ_MONTHLY = 600, PROJ_RATE = 0.005;
const PROJ_POINTS = Array.from({ length: 13 }, (_, i) => {
  let value = PROJ_START;
  for (let m = 0; m < i; m++) value = (value + PROJ_MONTHLY) * (1 + PROJ_RATE);
  return {
    label: i === 0 ? 'Auj.' : `${i} mois`,
    value,
    contributed: PROJ_START + PROJ_MONTHLY * i,
  };
});
const PROJ_GAIN = PROJ_POINTS[PROJ_POINTS.length - 1].value - PROJ_START;

function MockProjets({ c, s }: any) {
  /* Le graphique n'est PAS redessiné ici : c'est le composant de l'écran Projection
     (components/GrowthChart), avec des chiffres d'exemple. Une maquette « inspirée de » avait fini
     par diverger — plus d'axes, plus de capital investi, épaisseurs et opacités différentes — et
     promettait un écran qui n'existe pas. */
  const [w, setW] = useState(0);

  return (
    <View style={{ width: '100%', gap: 12 }}>
      <View style={s.mockCard}>
        <View style={s.mockRowBetween}>
          <Text style={s.mockCardTitle}>Voyage au Japon</Text>
          <Text style={[s.mockTileValue, { color: c.teal }]}>62 %</Text>
        </View>
        <View style={s.mockBarTrack}>
          <View style={[s.mockBarFill, { width: '62%', backgroundColor: c.teal }]} />
        </View>
        <Text style={s.mockRowSub}>2 480 € mis de côté sur 4 000 € · 180 €/mois</Text>
      </View>

      <View style={[s.mockCard, { gap: 6 }]}>
        <View style={s.mockRowBetween}>
          <Text style={s.mockCardTitle}>Dans 12 mois</Text>
          <Text style={[s.mockTileValue, { color: c.investment }]}>+ {eur(Math.round(PROJ_GAIN))}</Text>
        </View>
        {/* Largeur mesurée : le graphique de la Projection travaille en pixels (axes, libellés),
            il ne peut pas être étiré en pourcentage sans déformer traits et points. */}
        <View style={{ width: '100%' }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
          {w > 0 && (
            <GrowthChart
              points={PROJ_POINTS}
              width={w}
              color={c.investment}
              height={168}
              gradientId="introGrowthGrad"
            />
          )}
        </View>
        <View style={s.mockLegendRow}>
          <View style={s.mockLegendItem}>
            <View style={[s.mockLegendLine, { backgroundColor: c.investment }]} />
            <Text style={s.mockLegendText}>Valeur du portefeuille</Text>
          </View>
          <View style={s.mockLegendItem}>
            <View style={[s.mockLegendDash, { borderColor: c.textSecondary }]} />
            <Text style={s.mockLegendText}>Capital investi</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function MockAi({ c, s }: any) {
  const lines = [
    { icon: 'shield-checkmark', color: c.green ?? c.emerald, label: 'Ton épargne', text: 'Solide : 4,2 mois de dépenses couverts.' },
    { icon: 'alert-circle', color: c.orange, label: 'Tes variables', text: 'En hausse de 18 % ce mois — surveille les sorties.' },
    { icon: 'trending-up', color: c.violet, label: 'Ta marge', text: 'Tu peux investir 150 €/mois sans tension.' },
  ];
  return (
    <View style={s.mockCard}>
      <View style={s.mockRowBetween}>
        <View style={s.mockRowTitleLine}>
          <View style={[s.mockIcon, { width: 28, height: 28, borderRadius: 9, backgroundColor: c.emerald + '22' }]}>
            <Ionicons name="sparkles" size={14} color={c.emerald} />
          </View>
          <Text style={s.mockCardTitle}>Analyse globale</Text>
        </View>
        <View style={[s.mockPill, { backgroundColor: c.amber + '1F', borderColor: c.amber + '55' }]}>
          <Ionicons name="star" size={9} color={c.amber} />
          <Text style={[s.mockPillText, { color: c.amber }]}>Premium</Text>
        </View>
      </View>
      {lines.map((l, i) => (
        <View key={l.label} style={[s.mockAiLine, i > 0 && s.mockLineBorder]}>
          <View style={[s.mockAiDot, { backgroundColor: l.color + '22' }]}>
            <Ionicons name={l.icon as any} size={13} color={l.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.mockRowTitle}>{l.label}</Text>
            <Text style={s.mockRowSub}>{l.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, maxWidth: 520, width: '100%', alignSelf: 'center' },

    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    logo: { width: 30, height: 30, borderRadius: 9 },
    // Même taille et même centrage que le splash : la transition ne se voit pas.
    bootLogo: { width: 96, height: 96, borderRadius: 26 },
    // Logo de la transition de sortie : centré sur l'ÉCRAN entier (pas dans la mise en page, qui
    // est en train de s'en aller au même moment).
    exitMark: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    brand: { fontSize: 18, fontWeight: '800', color: c.text },

    /* Titre + illustration + texte : UN SEUL bloc, ALIGNÉ EN HAUT, avec le MÊME écart partout.
       Aligné en haut et jamais centré : les six écrans n'ont pas la même hauteur de contenu, donc
       un centrage vertical ferait sauter le titre d'une position à l'autre à chaque « Continuer ».
       En haut, le titre ne bouge pas d'un pixel d'un écran à l'autre — c'est ce qui fait tenir la
       série. Le contenu défile s'il dépasse.
       ⚠️ Surtout pas de `flex: 1` sur l'illustration : c'est ce qui créait un vide énorme entre le
       titre et l'image sur grand écran, et des écarts différents d'un appareil à l'autre. */
    // `paddingTop` : l'air laissé par l'étiquette, partie rejoindre son illustration. Le grand titre
    // respire au lieu de coller au logo.
    body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 18, gap: 28 },
    head: { alignItems: 'center' },
    artWrap: { alignItems: 'center', justifyContent: 'center', gap: 14 },
    // Deux cercles d'accent très dilués : ils décollent la maquette du fond sans rien masquer.
    glowOuter: {
      position: 'absolute', width: 380, height: 380, borderRadius: 190,
      backgroundColor: c.emerald + '10',
    },
    glowInner: {
      position: 'absolute', width: 240, height: 240, borderRadius: 120,
      backgroundColor: c.emerald + '14',
    },
    eyebrow: { fontSize: 12, fontWeight: '800', color: c.emerald, textTransform: 'uppercase', letterSpacing: 1.4, textAlign: 'center' },
    title: { fontSize: 32, fontWeight: '800', color: c.text, letterSpacing: -1, lineHeight: 38, textAlign: 'center' },
    text: { fontSize: 16, color: c.textSecondary, lineHeight: 24, textAlign: 'center' },

    footer: { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, gap: 16 },
    dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
    dot: { width: 18, height: 4, borderRadius: 2, backgroundColor: c.cardBorder },
    dotActive: { backgroundColor: c.emerald, width: 26 },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      backgroundColor: c.emerald, borderRadius: 16, paddingVertical: 16,
    },
    ctaLabel: { fontSize: 16, fontWeight: '800', color: c.bg },

    /* ── Maquettes ── */
    mockCard: {
      width: '100%', backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder,
      padding: 16, gap: 10,
      ...(Platform.OS === 'web' ? { boxShadow: '0 10px 30px rgba(0,0,0,0.18)' } as any : {}),
    },
    mockRowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    mockLabel: { fontSize: 10.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.9 },
    mockBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
    mockBadgeText: { fontSize: 9.5, fontWeight: '800' },
    mockBig: { fontSize: 38, fontWeight: '800', letterSpacing: -1.2 },
    mockCardTitle: { fontSize: 14.5, fontWeight: '800', color: c.text },

    mockGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
    mockTile: { width: '48%', borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9, gap: 4 },
    mockTileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    mockTileLabel: { fontSize: 11.5, fontWeight: '800', color: c.text },
    mockTileValue: { fontSize: 16, fontWeight: '800' },

    mockTotals: { flexDirection: 'row', gap: 8 },
    mockTotal: { flex: 1, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, borderLeftWidth: 3, padding: 9 },
    mockTotalLabel: { fontSize: 9.5, fontWeight: '700', color: c.textSecondary },
    mockTotalValue: { fontSize: 12.5, fontWeight: '800', marginTop: 2 },

    mockList: { width: '100%', backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.cardBorder, overflow: 'hidden' },
    mockRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 12 },
    mockRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.cardBorder },
    mockIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    mockRowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    mockRowTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
    mockRowSub: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
    mockRowValue: { fontSize: 13.5, fontWeight: '800', color: c.text },
    mockPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
    mockPillText: { fontSize: 9, fontWeight: '800' },

    mockLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
    mockLineBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder },
    mockLineLabel: { flex: 1, fontSize: 13, color: c.text },
    mockLineValue: { fontSize: 14, fontWeight: '800' },

    mockBarTrack: { height: 8, borderRadius: 999, backgroundColor: c.cardBorder, overflow: 'hidden' },
    mockBarFill: { height: 8, borderRadius: 999 },

    // Légende du graphique de projection : reprise à l'identique de l'écran Projection.
    mockLegendRow: { flexDirection: 'row', gap: 16, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
    mockLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    mockLegendLine: { width: 16, height: 3, borderRadius: 2 },
    mockLegendDash: { width: 16, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed' },
    mockLegendText: { fontSize: 11, color: c.textSecondary },

    mockAiLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9 },
    mockAiDot: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  });
}
