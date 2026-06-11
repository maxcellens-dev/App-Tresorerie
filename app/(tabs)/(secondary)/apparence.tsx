/**
 * Apparence — mode d'affichage (admin) + couleur d'accent. Déplacé depuis Paramètres.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform } from 'react-native';
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

  // ── Couleur personnalisée (theme_preset = hex direct) ──
  const isHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);
  const customActive = isHex(currentPreset);
  const [customHex, setCustomHex] = useState(customActive ? currentPreset.toUpperCase() : '#3B82F6');
  const customValid = isHex(customHex);
  const applyCustom = (hex: string) => { const v = hex.toUpperCase(); setCustomHex(v); if (isHex(v)) setPreset(v as ThemePreset); };
  // Palette rapide de teintes pour la saisie au doigt.
  const CUSTOM_SWATCHES = [
    '#FF3B30', '#FF6B6B', '#FF9500', '#FFCC00', '#34C759', '#00C7BE',
    '#30B0C7', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FF6B9D',
    '#A2845E', '#06D6A0', '#118AB2', '#8E8E93',
  ];

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

            {/* Couleur personnalisée */}
            <View style={[styles.block, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: 16, marginTop: 16 }]}>
              <Text style={styles.label}>Couleur personnalisée</Text>
              <Text style={styles.hint}>Choisissez votre propre teinte d'accent (code hexadécimal ou sélection rapide).</Text>

              <View style={styles.customRow}>
                <View style={[styles.customPreview, { backgroundColor: customValid ? customHex : COLORS.cardBorder }, customActive && { borderColor: COLORS.text, borderWidth: 2 }]}>
                  {customActive && <Ionicons name="checkmark" size={18} color="#ffffff" />}
                </View>
                {Platform.OS === 'web' ? (
                  // Sélecteur de couleur natif du navigateur (web bureau).
                  React.createElement('input', {
                    type: 'color',
                    value: customValid ? customHex : '#3B82F6',
                    onChange: (e: any) => applyCustom(e.target.value),
                    style: { width: 44, height: 44, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' },
                    'aria-label': 'Choisir une couleur',
                  })
                ) : null}
                <TextInput
                  style={[styles.hexInput, !customValid && { borderColor: COLORS.danger }]}
                  value={customHex}
                  onChangeText={applyCustom}
                  placeholder="#RRGGBB"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCapitalize="characters"
                  maxLength={7}
                />
                <TouchableOpacity
                  style={[styles.applyBtn, !customValid && { opacity: 0.5 }]}
                  onPress={() => customValid && setPreset(customHex as ThemePreset)}
                  disabled={!customValid}
                  activeOpacity={0.85}
                >
                  <Text style={styles.applyBtnText}>Appliquer</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.spectrumRow}>
                {CUSTOM_SWATCHES.map((s) => {
                  const active = customActive && currentPreset.toUpperCase() === s;
                  return (
                    <TouchableOpacity key={s} style={[styles.spectrumDot, { backgroundColor: s }, active && styles.presetDotActive]} onPress={() => applyCustom(s)} activeOpacity={0.8} accessibilityLabel={`Couleur ${s}`}>
                      {active && <Ionicons name="checkmark" size={14} color="#ffffff" />}
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
    hint: { fontSize: 12, color: c.textSecondary, lineHeight: 16, marginTop: -2 },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    customPreview: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    hexInput: { width: 110, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, color: c.text, backgroundColor: c.bg, fontSize: 14, letterSpacing: 1 },
    applyBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, backgroundColor: c.emerald },
    applyBtnText: { fontSize: 14, fontWeight: '700', color: c.bg },
    spectrumRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 4 },
    spectrumDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
  });
}
