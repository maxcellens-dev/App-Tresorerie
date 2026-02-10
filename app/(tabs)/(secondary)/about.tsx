import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

const APP_VERSION = '1.0.0';

export default function AboutScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Version */}
          <View style={styles.versionCard}>
            <Text style={styles.appName}>Trésorerie</Text>
            <Text style={styles.tagline}>Laissez-vous guider pour faire les meilleurs choix pour vos économies.</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>Version {APP_VERSION}</Text>
            </View>
          </View>

          {/* Support */}
          <Text style={styles.sectionTitle}>Support</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/assistance' as any)}>
              <Ionicons name="headset-outline" size={22} color={COLORS.emerald} />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Assistance</Text>
                <Text style={styles.rowHint}>Contactez notre équipe de support</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/ideas' as any)}>
              <Ionicons name="bulb-outline" size={22} color="#f59e0b" />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Boîte à idées</Text>
                <Text style={styles.rowHint}>Suggérez des améliorations</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/confidentialite' as any)}>
              <Ionicons name="shield-checkmark-outline" size={22} color="#60a5fa" />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Politique de confidentialité</Text>
                <Text style={styles.rowHint}>Comment nous protégeons vos données</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.row, styles.rowLast]} activeOpacity={0.7} onPress={() => router.push('/(tabs)/legal' as any)}>
              <Ionicons name="document-text-outline" size={22} color="#a78bfa" />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Mentions légales</Text>
                <Text style={styles.rowHint}>Informations légales et conditions</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>© 2026 Trésorerie. Tous droits réservés.</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  versionCard: {
    backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 24, alignItems: 'center', gap: 8, marginBottom: 32,
  },
  appName: { fontSize: 24, fontWeight: '800', color: COLORS.text },
  tagline: { fontSize: 14, color: COLORS.emerald, fontWeight: '500' },
  versionBadge: { backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  versionText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.cardBorder, overflow: 'hidden', marginBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  rowLast: { borderBottomWidth: 0 },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  rowHint: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  footer: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 16, marginBottom: 40 },
});
