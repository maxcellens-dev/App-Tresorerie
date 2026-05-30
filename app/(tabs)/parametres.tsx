import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import type { FinancialProfile } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';

const PROFILE_LABELS: Record<FinancialProfile, string> = {
  economiser: 'Économiser',
  suivi: 'Suivi',
  optimiser: 'Optimiser',
  investir: 'Investir',
};

const DEFAULT_ALLOCATIONS: Record<FinancialProfile, { save: number; invest: number; enjoy: number; keep: number }> = {
  economiser: { save: 55, invest: 5, enjoy: 15, keep: 25 },
  suivi: { save: 30, invest: 15, enjoy: 25, keep: 30 },
  optimiser: { save: 25, invest: 30, enjoy: 25, keep: 20 },
  investir: { save: 15, invest: 45, enjoy: 20, keep: 20 },
};


const ADMIN_URL = process.env.EXPO_PUBLIC_ADMIN_URL || '';

export default function SettingsScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { user, signOut } = useAuth();
  const profileQuery = useProfile(user?.id);
  const { data: profile } = profileQuery;
  const updateProfile = useUpdateProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';
  const [marginInput, setMarginInput] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<FinancialProfile>('suivi');
  const [savePct, setSavePct] = useState('30');
  const [investPct, setInvestPct] = useState('15');
  const [enjoyPct, setEnjoyPct] = useState('25');
  const [keepPct, setKeepPct] = useState('30');
  const [saveLoading, setSaveLoading] = useState(false);

  const currentMargin = marginInput ?? String(profile?.safety_margin_percent ?? 10);

  useEffect(() => {
    if (!profile) return;
    setSelectedProfile(profile.financial_profile ?? 'suivi');
    setSavePct(String(profile.allocation_save_percent ?? DEFAULT_ALLOCATIONS[profile.financial_profile ?? 'suivi'].save));
    setInvestPct(String(profile.allocation_invest_percent ?? DEFAULT_ALLOCATIONS[profile.financial_profile ?? 'suivi'].invest));
    setEnjoyPct(String(profile.allocation_enjoy_percent ?? DEFAULT_ALLOCATIONS[profile.financial_profile ?? 'suivi'].enjoy));
    setKeepPct(String(profile.allocation_keep_percent ?? DEFAULT_ALLOCATIONS[profile.financial_profile ?? 'suivi'].keep));
  }, [profile]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await profileQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  async function handleSaveSettings() {
    const total = Number(savePct) + Number(investPct) + Number(enjoyPct) + Number(keepPct);
    if (total !== 100) {
      Alert.alert('Allocation', 'Le total des pourcentages doit être égal à 100 %.');
      return;
    }
    setSaveLoading(true);
    try {
      const margin = Math.max(0, Math.min(50, Number(currentMargin) || 10));
      await updateProfile.mutateAsync({
        financial_profile: selectedProfile,
        allocation_save_percent: Number(savePct) || 0,
        allocation_invest_percent: Number(investPct) || 0,
        allocation_enjoy_percent: Number(enjoyPct) || 0,
        allocation_keep_percent: Number(keepPct) || 0,
        safety_margin_percent: margin,
      });
      Alert.alert('Paramètres', 'Vos préférences financières ont été mises à jour.');
    } catch (error: unknown) {
      Alert.alert('Erreur', error instanceof Error ? error.message : 'Impossible de sauvegarder vos paramètres.');
    } finally {
      setSaveLoading(false);
    }
  }

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
            <View style={[styles.row, styles.rowLast, { flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginTop: 12 }]}> 
              <View style={styles.allocationRowHeader}>
                <Text style={styles.rowLabel}>Profil financier</Text>
                <Text style={styles.rowHint}>Stratégie utilisée pour vos recommandations.</Text>
              </View>
              <View style={styles.profileOptionsRow}>
                {(['economiser', 'suivi', 'optimiser', 'investir'] as FinancialProfile[]).map((profileKey) => {
                  const active = selectedProfile === profileKey;
                  return (
                    <TouchableOpacity
                      key={profileKey}
                      style={[styles.strategyCard, active && styles.strategyCardActive]}
                      onPress={() => setSelectedProfile(profileKey)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.strategyLabel, active && styles.strategyLabelActive]}>{PROFILE_LABELS[profileKey]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.allocationInputsBlock}>
                {[
                  { label: 'Épargner', value: savePct, setter: setSavePct },
                  { label: 'Investir', value: investPct, setter: setInvestPct },
                  { label: 'Plaisir', value: enjoyPct, setter: setEnjoyPct },
                  { label: 'Conserver', value: keepPct, setter: setKeepPct },
                ].map((item) => (
                  <View key={item.label} style={styles.allocationRow}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <TextInput
                      style={styles.allocationInput}
                      value={item.value}
                      onChangeText={(text) => item.setter(text.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                    <Text style={styles.allocationSuffix}>%</Text>
                  </View>
                ))}
              </View>
              <Text style={[styles.rowHint, Number(savePct) + Number(investPct) + Number(enjoyPct) + Number(keepPct) !== 100 && styles.allocationWarning]}>
                Total : {Number(savePct) + Number(investPct) + Number(enjoyPct) + Number(keepPct)} %
              </Text>
              <TouchableOpacity
                style={[styles.saveButton, (saveLoading || Number(savePct) + Number(investPct) + Number(enjoyPct) + Number(keepPct) !== 100) && styles.saveButtonDisabled]}
                onPress={handleSaveSettings}
                disabled={saveLoading || Number(savePct) + Number(investPct) + Number(enjoyPct) + Number(keepPct) !== 100}
                accessibilityRole="button"
              >
                <Text style={styles.saveButtonText}>{saveLoading ? 'Enregistrement...' : 'Enregistrer le profil'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.rowHint}>Pour que les recommandations restent alignées avec votre stratégie.</Text>
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

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 20 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderBottomWidth: 0,
    gap: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  rowLast: { borderBottomWidth: 1 },
  rowLabel: { flex: 1, fontSize: 16, color: c.text, fontWeight: '500' },
  rowHint: { fontSize: 12, color: c.textSecondary, marginTop: 8, paddingHorizontal: 4 },
  marginInput: {
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 8,
    color: c.text,
    fontSize: 16,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    width: 52,
    height: 36,
    paddingHorizontal: 8,
  },
  allocationRowHeader: {
    width: '100%',
    marginTop: 12,
  },
  profileOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  strategyCard: {
    flex: 1,
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 14,
    backgroundColor: c.card,
  },
  strategyCardActive: {
    borderColor: c.emerald,
    backgroundColor: '#153a20',
  },
  strategyLabel: {
    color: c.text,
    fontSize: 14,
    fontWeight: '600',
  },
  strategyLabelActive: {
    color: c.emerald,
  },
  allocationInputsBlock: {
    marginTop: 14,
    gap: 10,
  },
  allocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  allocationInput: {
    flex: 1,
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 8,
    color: c.text,
    fontSize: 16,
    fontWeight: '600' as const,
    paddingHorizontal: 12,
    height: 44,
  },
  allocationSuffix: {
    color: c.text,
    fontSize: 16,
    fontWeight: '700',
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: c.emerald,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveButtonText: {
    color: c.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  allocationWarning: {
    color: c.danger,
  },
});
}
