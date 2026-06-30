import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';


export default function AdminHub() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const sections = [
    {
      category: 'Système',
      items: [
        { href: '/(tabs)/(secondary)/admin/features', icon: 'flask-outline', title: 'Fonctionnalités', desc: 'Clôture · Premium · Pubs', color: '#f43f5e' },
        { href: '/(tabs)/(secondary)/admin/ai', icon: 'sparkles-outline', title: 'Conseils IA', desc: 'Modèles · prompts · quotas · tickets', color: '#10b981' },
        { href: '/(tabs)/(secondary)/admin/app-update', icon: 'cloud-download-outline', title: "Mise à jour de l'App", desc: 'Bandeau de mise à jour & versions', color: '#0ea5e9' },
      ],
    },
    {
      category: 'Utilisateurs & support',
      items: [
        { href: '/(tabs)/(secondary)/admin/assistance', icon: 'headset-outline', title: 'Assistance', desc: 'Demandes de support', color: '#22d3ee' },
        { href: '/(tabs)/(secondary)/admin/suggestions', icon: 'chatbubbles-outline', title: 'Suggestions', desc: 'Idées utilisateurs', color: '#eab308' },
        { href: '/(tabs)/(secondary)/admin/notifications', icon: 'notifications-outline', title: 'Notifications', desc: 'Envoi immédiat ou planifié, par cible', color: '#ef4444' },
        { href: '/(tabs)/(secondary)/admin/stats-hub', icon: 'bar-chart-outline', title: 'Stats Hub', desc: 'Métriques & activité', color: '#f97316' },
        { href: '/(tabs)/(secondary)/admin/users', icon: 'people-outline', title: 'Utilisateurs', desc: 'Recherche + passage Premium', color: '#22c55e' },
        { href: '/(tabs)/(secondary)/admin/groups', icon: 'people-circle-outline', title: 'Groupes', desc: 'Groupes custom pour cibler les notifs', color: '#8b5cf6' },
      ],
    },
    {
      category: 'Apparence & contenu',
      items: [
        { href: '/(tabs)/(secondary)/admin/style-editor', icon: 'color-palette-outline', title: 'Style Editor', desc: 'Thème & couleurs', color: '#0ea5a8' },
        { href: '/(tabs)/(secondary)/admin/landing', icon: 'desktop-outline', title: "Page d'accueil", desc: 'Landing desktop (textes, images, menu)', color: '#38bdf8' },
        { href: '/(tabs)/(secondary)/admin/seo-center', icon: 'megaphone-outline', title: 'SEO Center', desc: 'Textes & métadonnées', color: '#7c3aed' },
        { href: '/(tabs)/(secondary)/admin/conseils', icon: 'newspaper-outline', title: 'Conseils', desc: 'Conseils du jour (généraux + contextuels)', color: '#f59e0b' },
        { href: '/(tabs)/(secondary)/admin/gamification', icon: 'trophy-outline', title: 'Gamification', desc: 'Badges, série, relyks, identité', color: '#f59e0b' },
        { href: '/(tabs)/(secondary)/admin/ads', icon: 'megaphone-outline', title: 'Publicités', desc: 'Bannières maison (zones activables)', color: '#ec4899' },
      ],
    },
    {
      category: 'Moteur financier',
      items: [
        { href: '/(tabs)/admin/financial-profiles', icon: 'person-outline', title: 'Profils financiers', desc: 'P1-P5 · messages · seuils', color: '#a78bfa' },
        { href: '/(tabs)/admin/recommendations', icon: 'bulb-outline', title: 'Recommandations', desc: 'Moteur & paliers', color: COLORS.green },
        { href: '/(tabs)/admin/safe-to-spend', icon: 'calculator-outline', title: 'Formule À dépenser', desc: 'Calcul détaillé', color: '#60a5fa' },
        { href: '/(tabs)/admin/fiscal-rates', icon: 'cash-outline', title: 'Fiscalité', desc: 'Taux par enveloppe (PEA, AV…)', color: '#fbbf24' },
      ],
    },
  ];

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Panneau Admin</Text>
          <Text style={styles.subtitle}>Configuration dynamique et reporting. Les changements sont appliqués au prochain sync.</Text>

          {sections.map((section) => (
            <View key={section.category} style={{ marginBottom: 12 }}>
              <Text style={styles.categoryTitle}>{section.category}</Text>
              <View style={styles.grid}>
                {section.items.map((item) => (
                  <TouchableOpacity
                    key={item.href}
                    style={styles.itemBtn}
                    onPress={() => router.push(item.href as any)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBox, { backgroundColor: item.color }]}>
                      <Ionicons name={item.icon as any} size={20} color={COLORS.bg} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                      <Text style={styles.itemDesc} numberOfLines={2}>{item.desc}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  title: { fontSize: 21, fontWeight: '700', color: c.text, marginBottom: 4 },
  subtitle: { fontSize: 12, color: c.textSecondary, marginBottom: 12, lineHeight: 16 },
  categoryTitle: { fontSize: 11, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  itemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 150,
    backgroundColor: c.card,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  iconBox: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 2 },
  itemDesc: { fontSize: 12, color: c.textSecondary, lineHeight: 15 },
  text: { color: c.text },
});
}
