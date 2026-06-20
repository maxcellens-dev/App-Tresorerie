import { useMemo } from 'react';
/**
 * ScreenHeader — en-tête standard des écrans secondaires/formulaires :
 * une ligne « ← Retour » puis un grand titre. Identique aux pages Boutique, Premium, etc.
 * (remplace l'ancien encart boxé HeaderWithProfile sur les écrans de création/édition).
 */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';

export default function ScreenHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  return (
    <View>
      <TouchableOpacity style={styles.backRow} onPress={() => (onBack ? onBack() : router.back())} accessibilityRole="button">
        <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {right}
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
    title: { flex: 1, fontSize: 26, fontWeight: '800', color: c.text },
  });
}
