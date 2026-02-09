import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

type TabName = 'accounts' | 'treasury-plan' | 'pilotage' | 'transactions' | 'reporting';
type IconName = 'wallet' | 'calendar' | 'home' | 'list' | 'bar-chart';

interface TabItem {
  name: TabName;
  label: string;
  icon: IconName;
}

const ITEMS: TabItem[] = [
  { name: 'accounts', label: 'Comptes', icon: 'wallet' },
  { name: 'treasury-plan', label: 'Tréso', icon: 'calendar' },
  { name: 'pilotage', label: 'Pilotage', icon: 'home' },
  { name: 'transactions', label: 'Transactions', icon: 'list' },
  { name: 'reporting', label: 'Reporting', icon: 'bar-chart' },
];

export default function CustomTabBar({ state, navigation }: any) {
  const router = useRouter();
  const activeRoute = state?.routes?.[state.index]?.name;
  const isWeb = Platform.OS === 'web';

  return (
    <View style={[styles.bar, isWeb && { backgroundColor: 'rgba(15,23,42,0.95)' }]}>
      {ITEMS.map((it) => {
        const focused = activeRoute === it.name;
        const color = focused ? '#34d399' : '#94a3b8';
        return (
          <TouchableOpacity
            key={it.name}
            style={styles.item}
            onPress={() => router.push(`/(tabs)/${it.name}` as any)}
            accessibilityRole="button"
          >
            <Ionicons name={`${it.icon}${focused ? '' : '-outline'}` as any} size={22} color={color} />
            <Text style={[styles.label, { color }]}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 72,
    paddingTop: 8,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(30,41,59,0.8)',
    backgroundColor: 'transparent',
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  label: { fontSize: 11, fontWeight: '600', marginTop: 4 },
});
