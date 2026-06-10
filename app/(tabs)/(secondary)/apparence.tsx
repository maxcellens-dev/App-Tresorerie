/**
 * Apparence — mode d'affichage (admin) + couleur d'accent. Déplacé depuis Paramètres.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/useProfile';
import { useAppColors } from '../../hooks/useAppColors';
import { THEME_MODES, THEME_PRESETS, type ThemeMode, type ThemePreset } from '../../theme/palette';
import { useStyleConfig, orderPresetIds } from '../../hooks/useStyleConfig';

export default function AppearanceScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const isAdmin = profile?.is_admin ?? false;
  const currentMode = (profile?.theme_mode ?? 'dark') as ThemeMode;
  const currentPreset = (profile?.theme_preset ?? 'emerald') as ThemePreset;

  const { data: styleConfig } = useStyleConfig();
  const allPresets = useMemo(() => {
    const hidden = new Set(styleConfig?.hidden_presets ?? []);
    const native = THEME_PRESETS.map((p) => ({ id: p.id, label: p.label, swatch: styleConfig?.custom_accents?.[p.id] ?? p.swatch }));
    const extra = (styleConfig?.extra_presets ?? []).map((p) => ({ id: p.id, label: p.label, swatch: p.dark }));
    const all = [...native, ...extra];
    const ordered = orderPresetIds(all.map((p) => p.id), styleConfig?.preset_order);
    return ordered.map((id) => all.find((p) => p.id === id)!).filter((p) => p && !hidden.has(p.id));
  }, [styleConfig]);

  const setMode = (mode: ThemeMode) => updateProfile.mutate({ theme_mode: mode });
  const setPreset = (preset: ThemePreset) => updateProfile.mutate({ theme_preset: preset });

  return (
    <View style={styles.root}>
      <StatusBar style={currentMode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Apparence</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={styles.card}>
            {isAdmin && (
              <View style={[styles.block, { borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, paddingBottom: 16, marginBottom: 16 }]}>
                <Text style={styles.label}>Mode d'affichage</Text>
                <View style={styles.segmentRow}>
                  {THEME_MODES.map((m) => {
                    const active = currentMode === m.id;
                    return (
                      <TouchableOpacity key={m.id} style={[styles.segment, active && styles.segmentActive]} onPress={() => setMode(m.id)} activeOpacity={0.8}>
                        <Ionicons name={m.icon as any} size={16} color={active ? COLORS.bg : COLORS.textSecondary} />
                        <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{m.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.block}>
              <Text style={styles.label}>Couleur d'accent</Text>
              <View style={styles.presetRow}>
                {allPresets.map((p) => {
                  const active = currentPreset === p.id;
                  return (
                    <TouchableOpacity key={p.id} style={[styles.presetDot, { backgroundColor: p.swatch }, active && styles.presetDotActive]} onPress={() => setPreset(p.id as ThemePreset)} activeOpacity={0.8} accessibilityLabel={p.label}>
                      {active && <Ionicons name="checkmark" size={18} color="#ffffff" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 16 },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 16 },
    block: { gap: 10 },
    label: { fontSize: 15, fontWeight: '500', color: c.text },
    segmentRow: { flexDirection: 'row', gap: 8 },
    segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg },
    segmentActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    segmentLabel: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    segmentLabelActive: { color: c.bg },
    presetRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
    presetDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    presetDotActive: { borderWidth: 2, borderColor: c.text },
  });
}
