import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../hooks/useAppColors';

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
  { name: 'projection', label: 'Projection', icon: 'trending-up' },
  { name: 'projects', label: 'Projets', icon: 'flag' },
];

export default function CustomTabBar({ state }: any) {
  const router = useRouter();
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const activeRoute = state?.routes?.[state.index]?.name;

  return (
    <View style={styles.bar}>
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
            {focused ? (
              <View style={[styles.activeIndicator, { backgroundColor: COLORS.tabActive + '20' }]}>
                <Ionicons name={it.icon as any} size={22} color={color} />
              </View>
            ) : (
              <Ionicons name={`${it.icon}-outline` as any} size={22} color={color} />
            )}
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
      alignItems: 'center',
      height: 72,
      paddingTop: 4,
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
