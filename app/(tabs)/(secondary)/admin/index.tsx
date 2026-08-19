import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/data/useProfile';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useAdminUnreadBreakdown } from '../../../../hooks/admin/useUnreadBadges';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';


export default function AdminHub() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;
  const unread = useAdminUnreadBreakdown(!!isAdmin, user?.id);
  const [query, setQuery] = useState('');

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Panneau Admin" onBack={goBack} />
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const sections = [
    {
      category: 'Système & Sécurité',
      items: [
        { href: '/(tabs)/(secondary)/admin/security', icon: 'shield-half-outline', title: 'Centre de sécurité', desc: 'Coupure globale · crashs & erreurs · mots de passe', color: '#dc2626' },
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
        { href: '/(tabs)/(secondary)/admin/emails', icon: 'mail-outline', title: 'E-mails', desc: 'Message ponctuel ou programmé, par cible', color: '#0ea5e9' },
        { href: '/(tabs)/(secondary)/admin/stats-hub', icon: 'bar-chart-outline', title: 'Stats Hub', desc: 'Métriques & activité', color: '#f97316' },
        { href: '/(tabs)/(secondary)/admin/users', icon: 'people-outline', title: 'Utilisateurs', desc: 'Recherche · Premium · groupes · inactifs', color: '#22c55e' },
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
        { href: '/(tabs)/(secondary)/admin/usage-limits', icon: 'lock-closed-outline', title: "Limites d'usage", desc: 'Quotas gratuit / premium (anti-abus)', color: '#f43f5e' },
      ],
    },
    {
      category: 'Moteur financier',
      items: [
        { href: '/(tabs)/admin/financial-profiles', icon: 'person-outline', title: 'Profils financiers', desc: 'P0-P9 · messages · seuils', color: '#a78bfa' },
        { href: '/(tabs)/admin/recommendations', icon: 'bulb-outline', title: 'Recommandations', desc: 'Moteur & paliers', color: COLORS.green },
        { href: '/(tabs)/admin/safe-to-spend', icon: 'calculator-outline', title: 'Formule du Relyka', desc: 'Le calcul, étape par étape', color: '#60a5fa' },
        { href: '/(tabs)/admin/fiscal-rates', icon: 'cash-outline', title: 'Fiscalité', desc: 'Taux par enveloppe (PEA, AV…)', color: '#fbbf24' },
        { href: '/(tabs)/(secondary)/admin/pouls', icon: 'compass-outline', title: 'État des lieux', desc: 'Bilan mensuel · signaux par profil', color: '#ef4444' },
        { href: '/(tabs)/(secondary)/admin/reliability', icon: 'shield-checkmark-outline', title: 'Fiabilité & confiance', desc: 'Seuils de doute · notifications système', color: '#34d399' },
        { href: '/(tabs)/(secondary)/admin/banners-preview', icon: 'eye-outline', title: 'Aperçu bandeaux', desc: 'Prochain geste · clôture · confiance (tous les textes)', color: '#f59e0b' },
      ],
    },
  ];

  // Recherche : filtre les items par titre/description ; masque les sections vides.
  const q = query.trim().toLowerCase();
  const filteredSections = q
    ? sections
        .map((sec) => ({ ...sec, items: sec.items.filter((it) => `${it.title} ${it.desc}`.toLowerCase().includes(q)) }))
        .filter((sec) => sec.items.length > 0)
    : sections;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Panneau Admin" onBack={goBack} />

        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtitle}>Configuration dynamique et reporting. Les changements sont appliqués au prochain sync.</Text>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={COLORS.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Rechercher une section…"
              placeholderTextColor={COLORS.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {filteredSections.length === 0 && (
            <Text style={styles.noResult}>Aucune section pour « {query} ».</Text>
          )}

          {filteredSections.map((section) => (
            <View key={section.category} style={{ marginBottom: 12 }}>
              <Text style={styles.categoryTitle}>{section.category}</Text>
              <View style={styles.grid}>
                {section.items.map((item) => {
                  // Badge « non lu » par type sur le bouton correspondant → on sait dans quelle page aller.
                  const badge = item.href.endsWith('/admin/ai') ? unread.ai_ticket
                    : item.href.endsWith('/admin/assistance') ? unread.support
                    : item.href.endsWith('/admin/suggestions') ? unread.suggestion
                    : item.href.endsWith('/admin/security') ? unread.crash
                    : 0;
                  return (
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
                    {badge > 0 && (
                      <View style={styles.badge}><Text style={styles.badgeTxt}>{badge > 99 ? '99+' : badge}</Text></View>
                    )}
                  </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  subtitle: { fontSize: 12, color: c.textSecondary, marginBottom: 12, lineHeight: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 4, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 14, color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  noResult: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 20 },
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
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  itemTitle: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 2 },
  itemDesc: { fontSize: 12, color: c.textSecondary, lineHeight: 15 },
  text: { color: c.text },
});
}
