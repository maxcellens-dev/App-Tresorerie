import { useMemo } from 'react';
/**
 * Support — assistance, idées, confidentialité, mentions légales, revoir le guide.
 * Déplacé depuis Paramètres.
 */
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/useAppColors';
import { useTour } from '../../../contexts/TourContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useUserUnreadCount } from '../../../hooks/useUnreadBadges';
import { useNavBack } from '../../../hooks/useNavBack';

export default function SupportScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();
  const tour = useTour();
  const { user } = useAuth();
  const assistanceUnread = useUserUnreadCount(user?.id);

  type Item = { icon: string; label: string; color: string; onPress: () => void; italic?: boolean; badge?: number };
  // Deux blocs distincts : « être aidé » d'un côté, « textes légaux » de l'autre.
  const sections: { title: string; items: Item[] }[] = [
    {
      title: 'Besoin d\'aide',
      items: [
        { icon: 'headset-outline', label: 'Assistance', color: COLORS.emerald, onPress: () => router.push('/(tabs)/(secondary)/assistance'), badge: assistanceUnread },
        { icon: 'bulb-outline', label: 'Boîte à idées', color: '#f59e0b', onPress: () => router.push('/(tabs)/(secondary)/ideas') },
        { icon: 'navigate-circle-outline', label: 'Revoir le guide de présentation', color: COLORS.textSecondary, onPress: () => tour.start(), italic: true },
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

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Support</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {sections.map((sec) => (
            <View key={sec.title}>
              <Text style={styles.sectionTitle}>{sec.title}</Text>
              <View style={styles.card}>
                {sec.items.map((it, i) => (
                  <TouchableOpacity key={it.label} style={[styles.row, i === sec.items.length - 1 && { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={it.onPress}>
                    <Ionicons name={it.icon as any} size={20} color={it.color} />
                    <Text style={[styles.rowLabel, it.italic && { fontStyle: 'italic', fontSize: 13, color: COLORS.textSecondary }]}>{it.label}</Text>
                    {!!it.badge && it.badge > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>{it.badge > 99 ? '99+' : it.badge}</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
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
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 16 },
    sectionTitle: { fontSize: 12, fontWeight: '600', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, overflow: 'hidden', marginBottom: 20 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: c.text },
    unreadBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    unreadBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  });
}
