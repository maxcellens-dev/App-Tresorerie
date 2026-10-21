/**
 * Navigation du Jardin sur BUREAU (web ≥ 1024 px) : une colonne à gauche, comme la navigation
 * actuelle de l'app (WebSideNav), à la place de la barre du bas — convention tactile qui n'a pas
 * sa place sur un écran d'ordinateur.
 *
 * Contenu : le bouton « Ajouter », les quatre espaces du Jardin (Mon argent, Projets, Jardin, Pico),
 * puis — comme l'ancienne navigation de bureau — des accès directs : le suivi de ton argent, ton
 * jardin et tes réglages. Sur un grand écran, la place ne manque pas : tout est à un clic.
 * Elle porte aussi la synchro en direct et les badges d'invitations (useGardenNavBadges).
 */
import { useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import GardenText from './GardenText';
import GardenAddSheet from './GardenAddSheet';
import Pico from './Pico';
import { GardenNavIcon, PendingBadge, menuHref, pendingLabel, type GardenTabRoute } from './GardenTabBar';
import { useGardenNavBadges } from '../../hooks/garden/useGardenNavBadges';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { TABS, WORDS } from '../../lib/garden/lexicon';
import { SIDEBAR_WIDTH, pointer, transition } from '../../lib/ui/webLayout';

const MAIN: { route: GardenTabRoute; label: string; icon: 'tree' | 'wallet' | 'pots' | 'pico' }[] = [
  { route: 'argent', label: TABS.money, icon: 'wallet' },
  { route: 'projets', label: TABS.projects, icon: 'pots' },
  { route: 'jardin', label: TABS.garden, icon: 'tree' },
  { route: 'pico', label: TABS.pico, icon: 'pico' },
];
/* Accès directs du bureau, rangés par sujet. `key` = dernier segment du chemin (surbrillance). */
const GROUPS: { title: string; items: { key: string; label: string; icon: string; route: string }[] }[] = [
  { title: 'Ton argent', items: [
    { key: 'month', label: 'Suivi du mois', icon: 'calendar-outline', route: '/(tabs)/jardin?open=can' },
    { key: 'tresorerie', label: WORDS.monthPlan, icon: 'stats-chart-outline', route: '/(tabs)/tresorerie' },
    { key: 'credits', label: 'Mes crédits', icon: 'home-outline', route: '/(tabs)/(secondary)/credits' },
    { key: 'placements', label: 'Mes placements', icon: 'nutrition-outline', route: '/(tabs)/(secondary)/placements' },
    { key: 'projects', label: 'Budgets', icon: 'pie-chart-outline', route: '/(tabs)/projects' },
  ] },
  { title: 'Ton jardin', items: [
    { key: 'parcours', label: WORDS.myJourney, icon: 'leaf-outline', route: '/(tabs)/(secondary)/parcours' },
    { key: 'succes', label: WORDS.successes, icon: 'ribbon-outline', route: '/(tabs)/(secondary)/succes' },
    { key: 'boutique', label: WORDS.shop, icon: 'bag-handle-outline', route: '/(tabs)/(secondary)/boutique' },
  ] },
  { title: 'Toi', items: [
    { key: 'moi', label: 'Mon profil', icon: 'person-circle-outline', route: '/(tabs)/(secondary)/moi' },
    { key: 'parametres', label: WORDS.settings, icon: 'options-outline', route: '/(tabs)/(secondary)/parametres' },
    { key: 'support', label: 'Aide', icon: 'help-buoy-outline', route: '/(tabs)/(secondary)/support' },
  ] },
];

/** Dernier segment réel du chemin (groupes Expo Router exclus). */
const lastSegment = (path: string) => path.split('/').filter((s) => s && !s.startsWith('(')).pop() ?? '';

export default function GardenSideNav() {
  const router = useRouter();
  const pathname = usePathname();
  const fontsReady = useGardenFonts();
  const pending = useGardenNavBadges();
  const [addOpen, setAddOpen] = useState(false);
  const current = lastSegment(pathname ?? '');

  const item = (key: string, label: string, onPress: () => void, icon: ReactNode, badge = 0) => {
    const on = current === key;
    return (
      <Pressable key={key} onPress={onPress} accessibilityRole="link" accessibilityState={{ selected: on }} accessibilityLabel={pendingLabel(label, badge)}
        style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, minHeight: 44, paddingHorizontal: GARDEN_SPACE.md, borderRadius: GARDEN_RADII.sm, backgroundColor: on ? GARDEN_COLORS.branchesBg : hovered ? GARDEN_COLORS.field : 'transparent' }, pointer, transition]}>
        <View>{icon}<PendingBadge count={badge} /></View>
        {fontsReady ? <GardenText variant={on ? 'bodyStrong' : 'body'} color={on ? GARDEN_COLORS.ink : GARDEN_COLORS.inkSoft}>{label}</GardenText> : null}
      </Pressable>
    );
  };

  return (
    /* Largeur FIGÉE sur un conteneur : un ScrollView seul s'étirait (flex) et prenait la moitié de l'écran. */
    <View style={{ width: SIDEBAR_WIDTH, flexShrink: 0, height: '100%', backgroundColor: GARDEN_COLORS.card, borderRightWidth: 1, borderRightColor: GARDEN_COLORS.line }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GARDEN_SPACE.md, paddingVertical: GARDEN_SPACE.xl, gap: GARDEN_SPACE.lg }}>
      <Pressable onPress={() => router.push('/(tabs)/jardin' as any)} accessibilityRole="link" accessibilityLabel="Relyka, aller au Jardin" style={[{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm, paddingHorizontal: GARDEN_SPACE.sm }, pointer]}>
        {/* L'icône de l'app, pas Pico : Pico n'apparaît que là où il parle (conseils, jardin). */}
        <Image source={require('../../assets/logo.png')} style={{ width: 34, height: 34 }} resizeMode="contain" accessibilityIgnoresInvertColors />
        {fontsReady ? <GardenText variant="heading">Relyka</GardenText> : null}
      </Pressable>

      <Pressable onPress={() => setAddOpen(true)} accessibilityRole="button" accessibilityLabel={TABS.add}
        style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: GARDEN_SPACE.sm, minHeight: 48, borderRadius: GARDEN_RADII.md, backgroundColor: hovered ? GARDEN_COLORS.primaryPressed : GARDEN_COLORS.primary }, pointer, transition]}>
        <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" /></Svg>
        {fontsReady ? <GardenText variant="bodyStrong" color={GARDEN_COLORS.onPrimary}>{TABS.add}</GardenText> : null}
      </Pressable>

      <View style={{ gap: 2 }}>
        {MAIN.map((m) => item(m.route, m.label, () => router.push(menuHref(m.route) as any), <GardenNavIcon name={m.icon} color={current === m.route ? GARDEN_COLORS.ink : GARDEN_COLORS.muted} size={22} />, pending[m.route] ?? 0))}
      </View>
      {GROUPS.map((g) => (
        <View key={g.title} style={{ gap: 2 }}>
          {fontsReady ? <GardenText variant="label" style={{ paddingHorizontal: GARDEN_SPACE.md, marginBottom: 4 }}>{g.title}</GardenText> : null}
          {/* `t` : un lien vers une vue de Mon argent doit y rebasculer même si l'écran, resté monté,
              a déjà reçu ce paramètre (cf. menuTarget). */}
          {g.items.map((m) => item(m.key, m.label, () => router.push((m.route.includes('?') ? `${m.route}&t=${Date.now()}` : m.route) as any), <Ionicons name={m.icon as any} size={20} color={current === m.key ? GARDEN_COLORS.ink : GARDEN_COLORS.muted} />))}
        </View>
      ))}
      <GardenAddSheet visible={addOpen} onClose={() => setAddOpen(false)} />
    </ScrollView>
    </View>
  );
}
