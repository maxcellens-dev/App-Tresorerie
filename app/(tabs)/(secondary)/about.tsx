import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/useAppColors';


const APP_VERSION = '1.0.0';

export default function AboutScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
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

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  versionCard: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 24, alignItems: 'center', gap: 8, marginBottom: 32,
  },
  appName: { fontSize: 24, fontWeight: '800', color: c.text },
  tagline: { fontSize: 14, color: c.emerald, fontWeight: '500' },
  versionBadge: { backgroundColor: c.cardBorder, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  versionText: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, overflow: 'hidden', marginBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
  rowLast: { borderBottomWidth: 0 },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: c.text },
  rowHint: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  footer: { fontSize: 12, color: c.textSecondary, textAlign: 'center', marginTop: 16, marginBottom: 40 },
});
}
