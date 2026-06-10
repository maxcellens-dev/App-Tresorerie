/**
 * ImpersonationBanner — bandeau affiché en haut de l'app quand un admin est en mode
 * « connecté en tant que » (consultation/intervention sur le compte d'un autre utilisateur).
 * Le bouton « Quitter » rend la main à la session admin réelle.
 */
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';

export default function ImpersonationBanner() {
  const { isImpersonating, impersonatedEmail, stopImpersonating } = useAuth();
  const router = useRouter();

  if (!isImpersonating) return null;

  const exit = () => {
    stopImpersonating();
    router.replace('/(tabs)/(secondary)/admin/users' as any);
  };

  return (
    <View style={styles.bar}>
      <Ionicons name="eye" size={16} color="#1f2937" />
      <Text style={styles.text} numberOfLines={1}>
        Mode admin · vous agissez sur <Text style={styles.email}>{impersonatedEmail ?? 'ce compte'}</Text>
      </Text>
      <TouchableOpacity style={styles.exitBtn} onPress={exit} accessibilityRole="button">
        <Ionicons name="exit-outline" size={14} color="#1f2937" />
        <Text style={styles.exitText}>Quitter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f59e0b', paddingHorizontal: 14, paddingVertical: 8,
    ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 1000 } as any : {}),
  },
  text: { flex: 1, fontSize: 13, fontWeight: '700', color: '#1f2937' },
  email: { fontWeight: '800' },
  exitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1f2937', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  exitText: { fontSize: 12, fontWeight: '800', color: '#fff' },
});
