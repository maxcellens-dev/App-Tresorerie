import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from './hooks/useAppColors';


export default function NotificationsScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.card}>
          <Ionicons name="notifications-outline" size={48} color={COLORS.textSecondary} style={styles.icon} />
          <Text style={styles.message}>La gestion des notifications sera disponible prochainement.</Text>
          <Text style={styles.hint}>Vous pourrez choisir les alertes (tréso, rappels, etc.) et les préférences d’envoi.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 24 },
  card: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 24,
    alignItems: 'center',
  },
  icon: { marginBottom: 16 },
  message: { fontSize: 16, color: c.text, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  hint: { fontSize: 14, color: c.textSecondary, textAlign: 'center' },
});
}
