import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from './hooks/useAppColors';
import { useAuth } from './contexts/AuthContext';
import { useProfile, useUpdateProfile } from './hooks/useProfile';


export default function NotificationsScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const enabled = (profile as any)?.notifications_enabled ?? true;

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
          <View style={styles.row}>
            <Ionicons name="notifications-outline" size={20} color={COLORS.textSecondary} />
            <Text style={styles.rowLabel}>Activer les notifications</Text>
            <Switch
              value={enabled}
              onValueChange={(v) => updateProfile.mutate({ notifications_enabled: v })}
              trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
              thumbColor="#ffffff"
            />
          </View>
          <Text style={styles.hint}>
            Concerne uniquement les notifications mobiles (réponses à l'assistance, annonces Relyka). Les badges dans l'app restent affichés même si vous les désactivez.
          </Text>
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
    padding: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: c.text },
  hint: { fontSize: 12, color: c.textSecondary, marginTop: 10, lineHeight: 16 },
});
}
