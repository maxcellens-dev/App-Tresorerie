import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function AdminHub() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const items = [
    {
      href: '/(tabs)/(secondary)/admin/style-editor',
      icon: 'color-palette-outline',
      title: 'Style Editor',
      desc: 'Thème & couleurs',
      color: '#0ea5a8',
    },
    {
      href: '/(tabs)/(secondary)/admin/seo-center',
      icon: 'megaphone-outline',
      title: 'SEO Center',
      desc: 'Textes & métadonnées',
      color: '#7c3aed',
    },
    {
      href: '/(tabs)/(secondary)/admin/stats-hub',
      icon: 'bar-chart-outline',
      title: 'Stats Hub',
      desc: 'Métriques & activité',
      color: '#f97316',
    },
  ];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Panneau Admin</Text>
          <Text style={styles.subtitle}>Configuration dynamique et reporting. Les changements sont appliqués au prochain sync.</Text>

          <View style={styles.grid}>
            {items.map((item) => (
              <TouchableOpacity
                key={item.href}
                style={styles.itemBtn}
                onPress={() => router.push(item.href as any)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBox, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon as any} size={28} color={COLORS.bg} />
                </View>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemDesc}>{item.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backLabel: { fontSize: 16, color: COLORS.text, marginLeft: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  itemBtn: {
    flex: 1,
    minWidth: 140,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: { width: 56, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  itemTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 4 },
  itemDesc: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
  text: { color: COLORS.text },
});
