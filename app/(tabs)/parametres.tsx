import { useState } from 'react';import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

const ADMIN_URL = process.env.EXPO_PUBLIC_ADMIN_URL || '';

export default function SettingsScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { user, signOut } = useAuth();
  const profileQuery = useProfile(user?.id);
  const { data: profile } = profileQuery;
  const updateProfile = useUpdateProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';
  const [marginInput, setMarginInput] = useState<string | null>(null);

  const currentMargin = marginInput ?? String(profile?.safety_margin_percent ?? 10);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await profileQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  async function handleSignOut() {
    await signOut();
    router.replace('/welcome');
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#34d399"
              progressBackgroundColor="#0f172a"
            />
          }
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Catégories</Text>
            <TouchableOpacity style={[styles.row, styles.rowLast]} activeOpacity={0.7} onPress={() => router.push('/(tabs)/categories')} accessibilityRole="button">
              <Ionicons name="pie-chart-outline" size={22} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Catégories</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.rowHint}>Recettes et dépenses par défaut, modifiables pour le plan de trésorerie.</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pilotage</Text>
            <View style={[styles.row, styles.rowLast, { flexDirection: 'column', alignItems: 'flex-start', gap: 8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%' }}>
                <Ionicons name="shield-outline" size={22} color={COLORS.textSecondary} />
                <Text style={styles.rowLabel}>Marge de sécurité</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TextInput
                    style={styles.marginInput}
                    value={currentMargin}
                    onChangeText={(text) => setMarginInput(text.replace(/[^0-9]/g, ''))}
                    onEndEditing={() => {
                      const val = parseInt(currentMargin) || 10;
                      const clamped = Math.max(0, Math.min(50, val));
                      setMarginInput(null);
                      if (clamped !== (profile?.safety_margin_percent ?? 10)) {
                        updateProfile.mutate({ safety_margin_percent: clamped });
                      }
                    }}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                  <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: '600' }}>%</Text>
                </View>
              </View>
            </View>
            <Text style={styles.rowHint}>Pourcentage retenu sur votre solde courant dans le calcul du « À dépenser en sécurité ».</Text>
          </View>

          {isAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Administration</Text>
              <TouchableOpacity
                style={[styles.row, styles.rowLast]}
                activeOpacity={0.7}
                onPress={() => router.push('/(tabs)/admin')}
                accessibilityRole="button"
              >
                <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.emerald} />
                <Text style={[styles.rowLabel, { color: COLORS.emerald }]}>Panneau Admin</Text>
                <Ionicons name="chevron-forward" size={20} color={COLORS.emerald} />
              </TouchableOpacity>
              <Text style={styles.rowHint}>
                Accédez au Style Editor, SEO Center, Stats Hub et bien d'autres outils de configuration.
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Application</Text>
            <TouchableOpacity style={[styles.row, styles.rowLast]} activeOpacity={0.7} onPress={() => router.push('/(tabs)/about')} accessibilityRole="button">
              <Ionicons name="information-circle-outline" size={22} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>À propos</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 20 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderBottomWidth: 0,
    gap: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  rowLast: { borderBottomWidth: 1 },
  rowLabel: { flex: 1, fontSize: 16, color: COLORS.text, fontWeight: '500' },
  rowHint: { fontSize: 12, color: COLORS.textSecondary, marginTop: 8, paddingHorizontal: 4 },
  marginInput: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 8,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    width: 52,
    height: 36,
    paddingHorizontal: 8,
  },
});
