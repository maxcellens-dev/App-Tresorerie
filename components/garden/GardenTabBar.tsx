/**
 * Barre d'onglets du Jardin (téléphone et navigateur étroit) : Mon argent · Projets · + · Jardin · Pico.
 * Sur bureau, la navigation passe à gauche (GardenSideNav) et cette barre n'est pas rendue.
 *
 * Elle remplace la barre actuelle (CustomTabBar) quand l'interrupteur `garden_ui` est ouvert pour
 * l'utilisateur ; le navigateur d'onglets reste le même, donc les pages de détail existantes restent
 * accessibles sans rien dupliquer.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import GardenText from './GardenText';
import GardenAddSheet from './GardenAddSheet';
import Pico from './Pico';
import { useGardenNavBadges } from '../../hooks/garden/useGardenNavBadges';
import { GARDEN_COLORS, GARDEN_TOUCH } from '../../lib/garden/theme';
import { TABS } from '../../lib/garden/lexicon';

/** Routes du groupe (tabs) qui forment la navigation du Jardin. */
export const GARDEN_TAB_ROUTES = ['argent', 'projets', 'jardin', 'pepin'] as const;
export type GardenTabRoute = (typeof GARDEN_TAB_ROUTES)[number];

export function GardenNavIcon({ name, color, size = 24 }: { name: 'tree' | 'wallet' | 'pots' | 'pico'; color: string; size?: number }) {
  if (name === 'pico') return <Pico avatar size={size + 2} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {name === 'tree' ? (<><Path d="M12 21v-6" /><Path d="M12 15c-4 0-7-2.5-7-6a7 7 0 0 1 14 0c0 3.5-3 6-7 6z" /></>) : null}
      {name === 'wallet' ? (<><Rect x={2} y={6} width={20} height={14} rx={4} /><Path d="M16 13h2M2 10h20" /></>) : null}
      {name === 'pots' ? (<><Path d="M6 14h12l-1.5 7h-9z" /><Path d="M12 14V8" /><Circle cx={12} cy={6} r={2.5} /><Path d="M12 10c-3 0-4-2-4-3 2 0 4 1 4 3zM12 10c3 0 4-2 4-3-2 0-4 1-4 3z" /></>) : null}
    </Svg>
  );
}

export function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={{ position: 'absolute', top: -3, right: -6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: GARDEN_COLORS.flowersText, alignItems: 'center', justifyContent: 'center' }}>
      <GardenText variant="smallStrong" color="#FFFFFF" style={{ fontSize: 10, lineHeight: 12 }}>{count}</GardenText>
    </View>
  );
}

/**
 * Cible d'un bouton du menu. « Mon argent » rouvre TOUJOURS sa vue « Aujourd'hui » : l'écran reste
 * monté et gardait sinon la dernière vue choisie (Ce mois, Demain). `t` change à chaque appui, pour
 * que l'écran rebascule même si le paramètre `view` était déjà « today ».
 */
export function menuTarget(route: GardenTabRoute): [string, Record<string, string>?] {
  return route === 'argent' ? [route, { view: 'today', t: String(Date.now()) }] : [route];
}

/** Même cible, en URL (navigation de bureau). */
export function menuHref(route: GardenTabRoute): string {
  return route === 'argent' ? `/(tabs)/argent?view=today&t=${Date.now()}` : `/(tabs)/${route}`;
}

export const pendingLabel =(label: string, n: number) => (n > 0 ? `${label}, ${n} invitation${n > 1 ? 's' : ''} en attente` : label);

/* Même typage que CustomTabBar : le paquet de types de la barre d'onglets n'est pas une dépendance
   directe du projet (Expo Router l'embarque). */
export default function GardenTabBar({ state, navigation }: any) {
  const pendingByRoute = useGardenNavBadges();
  const insets = useSafeAreaInsets();
  const [addOpen, setAddOpen] = useState(false);
  const current = state.routes[state.index]?.name;

  const tab = (route: GardenTabRoute, label: string, icon: 'tree' | 'wallet' | 'pots' | 'pico') => {
    const on = current === route;
    const pending = pendingByRoute[route] ?? 0;
    const color = on ? GARDEN_COLORS.ink : GARDEN_COLORS.muted;
    return (
      <Pressable key={route} onPress={() => navigation.navigate(...(menuTarget(route) as [never, never]))} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={pendingLabel(label, pending)}
        style={{ flex: 1, minHeight: GARDEN_TOUCH + 8, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <View>
          <GardenNavIcon name={icon} color={color} />
          <PendingBadge count={pending} />
        </View>
        <GardenText variant="smallStrong" color={color} style={{ fontSize: 11 }}>{label}</GardenText>
      </Pressable>
    );
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: GARDEN_COLORS.card, borderTopWidth: 1, borderTopColor: GARDEN_COLORS.line, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: 6 }}>
      {tab('argent', TABS.money, 'wallet')}
      {tab('projets', TABS.projects, 'pots')}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Pressable onPress={() => setAddOpen(true)} accessibilityRole="button" accessibilityLabel={TABS.add}
          style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, backgroundColor: pressed ? GARDEN_COLORS.primaryPressed : GARDEN_COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: -18, shadowColor: '#26784A', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 })}>
          <Svg width={26} height={26} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" /></Svg>
        </Pressable>
      </View>
      {tab('jardin', TABS.garden, 'tree')}
      {tab('pepin', TABS.pico, 'pico')}
      <GardenAddSheet visible={addOpen} onClose={() => setAddOpen(false)} />
    </View>
  );
}
