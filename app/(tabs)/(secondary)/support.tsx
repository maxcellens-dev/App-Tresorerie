import { useMemo } from 'react';
/**
 * Support — assistance, idées, confidentialité, mentions légales, revoir le guide.
 * Déplacé depuis Paramètres.
 */
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Platform } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useAuth } from '../../../contexts/AuthContext';
import { useUserUnreadCount } from '../../../hooks/admin/useUnreadBadges';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useFeatureFlags } from '../../../hooks/config/useFeatureFlags';

// Fiche Play par défaut, quand l'admin n'a pas saisi de lien « Noter » (cf. parametres.tsx,
// UpdateBanner.tsx — même paquet).
const ANDROID_PACKAGE = 'com.relyka.myapp';

/** Ouvre un lien externe : nouvel onglet en web, navigateur/app du système ailleurs. */
function openExternal(url: string) {
  const clean = url.trim();
  if (!clean) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(clean, '_blank', 'noopener');
  else Linking.openURL(clean).catch(() => {});
}

export default function SupportScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const assistanceUnread = useUserUnreadCount(user?.id);
  const { data: flags } = useFeatureFlags();

  /* « Noter l'application » — lien administré (Admin › Mise à jour de l'App). Sur iOS, pas de
     repli : tant que la fiche App Store n'existe pas, la ligne reste masquée plutôt que d'envoyer
     vers une page vide. Sur Android et en web, on retombe sur la fiche Play du paquet. */
  const rateUrl = Platform.OS === 'ios'
    ? (flags?.about_rate_url_ios ?? '').trim()
    : (flags?.about_rate_url_android || `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`).trim();
  const instagramUrl = (flags?.about_instagram_url ?? '').trim();

  // `external` : lien qui QUITTE l'app (store, Instagram) → chevron remplacé par l'icône « sortie ».
  type Item = { icon: string; label: string; color: string; onPress: () => void; italic?: boolean; badge?: number; external?: boolean };
  // Deux blocs distincts : « être aidé » d'un côté, « textes légaux » de l'autre.
  const sections: { title: string; items: Item[] }[] = [
    {
      title: 'Besoin d\'aide',
      items: [
        { icon: 'headset-outline', label: 'Assistance', color: COLORS.emerald, onPress: () => router.push('/(tabs)/(secondary)/assistance'), badge: assistanceUnread },
        { icon: 'bulb-outline', label: 'Boîte à idées', color: '#f59e0b', onPress: () => router.push('/(tabs)/(secondary)/ideas') },
      ],
    },
    {
      title: 'Informations légales',
      items: [
        { icon: 'shield-checkmark-outline', label: 'Confidentialité', color: '#60a5fa', onPress: () => router.push('/confidentialite') },
        { icon: 'document-text-outline', label: 'Mentions légales', color: '#a78bfa', onPress: () => router.push('/legal') },
      ],
    },
  ];

  // « À propos » — liens externes, administrés. Un lien non renseigné = pas de ligne (et donc pas
  // de section du tout si les deux manquent).
  const aboutItems: Item[] = [
    ...(rateUrl ? [{ icon: 'star-outline', label: "Noter l'application", color: '#f59e0b', external: true, onPress: () => openExternal(rateUrl) }] : []),
    ...(instagramUrl ? [{ icon: 'logo-instagram', label: 'Nous suivre sur Instagram', color: '#e1306c', external: true, onPress: () => openExternal(instagramUrl) }] : []),
  ];
  if (aboutItems.length > 0) sections.push({ title: 'À propos', items: aboutItems });

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={[]}>
        {/* En-tête NORMALISÉ, comme les autres pages secondaires : cette page avait gardé son
            propre bouton « Retour » et son titre, avec un espacement et une taille qui ne
            correspondaient à aucune autre — c'est le genre d'écart qu'on ne voit qu'en passant
            d'un écran à l'autre. */}
        <ScreenHeader title="Support" onBack={goBack} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {sections.map((sec) => (
            <View key={sec.title}>
              <Text style={styles.sectionTitle}>{sec.title}</Text>
              <View style={styles.card}>
                {sec.items.map((it, i) => (
                  <TouchableOpacity
                    key={it.label}
                    style={[styles.row, i === sec.items.length - 1 && { borderBottomWidth: 0 }]}
                    activeOpacity={0.7}
                    onPress={it.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={it.badge ? `${it.label}, ${it.badge} non lu${it.badge > 1 ? 's' : ''}` : it.label}
                    accessibilityHint={it.external ? 'Ouvre un site extérieur à l’application' : undefined}
                  >
                    <Ionicons name={it.icon as any} size={20} color={it.color} />
                    <Text style={[styles.rowLabel, it.italic && { fontStyle: 'italic', fontSize: 13, color: COLORS.textSecondary }]}>{it.label}</Text>
                    {!!it.badge && it.badge > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>{it.badge > 99 ? '99+' : it.badge}</Text>
                      </View>
                    )}
                    <Ionicons name={it.external ? 'open-outline' : 'chevron-forward'} size={it.external ? 16 : 18} color={COLORS.textSecondary} />
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
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    sectionTitle: { fontSize: 12, fontWeight: '600', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, overflow: 'hidden', marginBottom: 20 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: c.text },
    unreadBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    unreadBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  });
}
