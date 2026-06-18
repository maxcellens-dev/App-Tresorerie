import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useRwInvitations } from '../hooks/useRelykaWorld';
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

export default function CustomTabBar({ state }: any) {
  const router = useRouter();
  const COLORS = useAppColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(COLORS);
  const activeRoute = state?.routes?.[state.index]?.name;
  const { user } = useAuth();
  const { data: rwInvitations = [] } = useRwInvitations(user?.id);
  const rwInviteCount = rwInvitations.length;

  return (
    // paddingBottom = inset système (barre de navigation / gestes) → le contenu remonte
    // au-dessus des boutons du téléphone, et le fond couvre toute la zone (pas de bande vide).
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.topBorder} />
      {ITEMS.map((it) => {
        const focused = activeRoute === it.name;
        const color = focused ? COLORS.tabActive : COLORS.tabInactive;
        return (
          <TouchableOpacity
            key={it.name}
            style={styles.item}
            onPress={() => router.push(`/(tabs)/${it.name}` as any)}
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
