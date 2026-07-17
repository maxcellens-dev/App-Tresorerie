import React, { useMemo, useRef, useEffect } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform, DeviceEventEmitter } from 'react-native';
import { registerGuideAnchor, unregisterGuideAnchor } from '../lib/guideAnchors';
import GuideRing from './GuideRing';

/** Événement émis quand on tape l'onglet « Comptes » → la page réinitialise son sous-onglet sur « Comptes ». */
export const COMPTES_TAB_PRESSED = 'comptesTabPressed';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useRwInvitations } from '../hooks/useRelykaWorld';
import { useAccountInvitations, useSharedAccountsRealtime } from '../hooks/useSharedAccounts';
import { useCreditInvitations, useSharedCreditsRealtime } from '../hooks/useSharedCredits';
import { UnreadBadge } from './HeaderWithProfile';

type TabName = 'comptes' | 'projects' | 'pilotage' | 'transactions' | 'projection';
type IconName = 'wallet' | 'flag' | 'home' | 'list' | 'trending-up';

interface TabItem {
  name: TabName;
  label: string;
  icon: IconName;
}

const ITEMS: TabItem[] = [
  { name: 'comptes', label: 'Comptes', icon: 'wallet' },
  { name: 'transactions', label: 'Transactions', icon: 'list' },
  { name: 'pilotage', label: 'Pilotage', icon: 'home' },
  { name: 'projects', label: 'Projets', icon: 'flag' },
  { name: 'projection', label: 'Projection', icon: 'trending-up' },
];

export default function CustomTabBar({ state, navigation }: any) {
  const COLORS = useAppColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const navActiveRoute = state?.routes?.[state.index]?.name;
  // Surlignage OPTIMISTE : l'onglet tapé s'allume À LA FRAME DU TAP (état local synchrone), sans
  // attendre que la navigation/le rendu de l'écran aboutisse → la barre répond toujours instantanément.
  const [pressedTab, setPressedTab] = React.useState<TabName | null>(null);
  useEffect(() => {
    if (pressedTab && navActiveRoute === pressedTab) setPressedTab(null);
  }, [navActiveRoute, pressedTab]);
  const activeRoute = pressedTab ?? navActiveRoute;
  const { user } = useAuth();
  const { data: rwInvitations = [] } = useRwInvitations(user?.id);
  const rwInviteCount = rwInvitations.length;
  const { data: acctInvitations = [] } = useAccountInvitations(user?.id);
  const { data: creditInvitations = [] } = useCreditInvitations(user?.id);
  // Badge « Comptes » = invitations de comptes partagés/joints + invitations de crédits partagés.
  const acctInviteCount = acctInvitations.length + creditInvitations.length;
  useSharedAccountsRealtime(user?.id); // sync live des comptes partagés/joints + invitations
  useSharedCreditsRealtime(user?.id);  // sync live des crédits partagés + invitations

  // Ancre du guide : la vraie position de la barre (mesurée), pas un rectangle « height - 78 » approximatif.
  const barRef = useRef<any>(null);
  useEffect(() => {
    registerGuideAnchor('tabbar', barRef);
    return () => unregisterGuideAnchor('tabbar');
  }, []);

  return (
    // paddingBottom = inset système (barre de navigation / gestes) → le contenu remonte
    // au-dessus des boutons du téléphone, et le fond couvre toute la zone (pas de bande vide).
    <View ref={barRef} collapsable={false} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.topBorder} />
      {/* Bordure du guide tracée SUR la barre elle-même (aucune mesure). */}
      <GuideRing target="tabbar" radius={12} inset={-2} />
      {ITEMS.map((it) => {
        const focused = activeRoute === it.name;
        const color = focused ? COLORS.tabActive : COLORS.tabInactive;
        return (
          <TouchableOpacity
            key={it.name}
            style={styles.item}
            onPress={() => {
              setPressedTab(it.name); // feedback visuel immédiat, avant la navigation
              if (it.name === 'comptes') DeviceEventEmitter.emit(COMPTES_TAB_PRESSED);
              // `navigation.navigate` DIRECT (pas router.push) : pas de résolution d'URL/linking sur
              // le chemin du tap. `screen: 'index'` → un onglet à pile imbriquée revient à sa racine
              // (même comportement qu'avant : taper l'onglet ramène toujours à la liste).
              const nested = it.name === 'comptes' || it.name === 'transactions' || it.name === 'projects';
              if (nested) navigation.navigate(it.name, { screen: 'index' });
              else navigation.navigate(it.name);
            }}
            accessibilityRole="button"
          >
            <View>
              {focused ? (
                <View style={[styles.activeIndicator, { backgroundColor: COLORS.tabActive + '20' }]}>
                  <Ionicons name={it.icon as any} size={22} color={color} />
                </View>
              ) : (
                <Ionicons name={`${it.icon}-outline` as any} size={22} color={color} />
              )}
              {/* Badge invitations Relyka World en attente sur l'onglet Projets */}
              {it.name === 'projects' && rwInviteCount > 0 && <UnreadBadge count={rwInviteCount} style={{ top: -4, right: -8 }} />}
              {/* Badge invitations de compte partagé/joint en attente sur l'onglet Comptes */}
              {it.name === 'comptes' && acctInviteCount > 0 && <UnreadBadge count={acctInviteCount} style={{ top: -4, right: -8 }} />}
            </View>
            <Text style={[styles.label, { color }]}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingTop: 6,
      paddingHorizontal: 8,
      backgroundColor: c.bg,
    },
    topBorder: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 0.5,
      backgroundColor: c.cardBorder,
    },
    item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 4 },
    activeIndicator: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: { fontSize: 10, fontWeight: '600' },
  });
}
