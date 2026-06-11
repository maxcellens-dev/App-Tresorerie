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
import { useGamification } from '../../hooks/useGamification';
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
  const [customHex, setCustomHex] = useState(customActive ? currentPreset.toUpperCase() : '#000000');
  const customValid = isHex(customHex);
  // Saisie au clavier OU sélecteur de couleur → met seulement à jour l'aperçu.
  // L'application se fait UNIQUEMENT via le bouton « Appliquer ».
  const onHexChange = (v: string) => setCustomHex(v.toUpperCase());
  const applyHex = () => { if (isHex(customHex)) setPreset(customHex as ThemePreset); };

  // Couleurs personnalisées : débloquées UNIQUEMENT par l'achat « accent_pack » en boutique
  // (y compris pour les abonnés Premium, qui doivent aussi l'acheter).
  const { inventory } = useGamification(user?.id);
  const colorsUnlocked = inventory.some((i) => i.item_key === 'accent_pack');
  // Les 7 dernières couleurs d'accent sont « premium » : masquées tant que le pack n'est pas acheté.
  const PREMIUM_PRESET_COUNT = 7;
  const shownPresets = (colorsUnlocked || allPresets.length <= PREMIUM_PRESET_COUNT)
    ? allPresets
    : allPresets.slice(0, allPresets.length - PREMIUM_PRESET_COUNT);

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
                {shownPresets.map((p) => {
                  const active = currentPreset === p.id;
                  return (
                    <TouchableOpacity key={p.id} style={[styles.presetDot, { backgroundColor: p.swatch }, active && styles.presetDotActive]} onPress={() => setPreset(p.id as ThemePreset)} activeOpacity={0.8} accessibilityLabel={p.label}>
                      {active && <Ionicons name="checkmark" size={18} color="#ffffff" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Couleurs personnalisées — réservées aux abonnés Premium ou aux acheteurs du pack */}
            <View style={[styles.block, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: 16, marginTop: 16 }]}>
              <View style={styles.lockRow}>
                <Text style={styles.label}>Couleurs personnalisées</Text>
                {!colorsUnlocked && <Ionicons name="lock-closed" size={15} color={COLORS.textSecondary} />}
              </View>

              {colorsUnlocked ? (
                <>
                  <Text style={styles.hint}>Choisissez votre propre teinte d'accent.</Text>

                  <View style={styles.customRow}>
                    {Platform.OS === 'web' ? (
                      // Palette (sélecteur natif) → applique directement la couleur.
                      React.createElement('input', {
                        type: 'color',
                        value: customValid ? customHex : '#000000',
                        onChange: (e: any) => onHexChange(e.target.value),
                        style: { width: 44, height: 44, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' },
                        'aria-label': 'Choisir une couleur',
                      })
                    ) : null}
                    <TextInput
                      style={[styles.hexInput, !customValid && { borderColor: COLORS.danger }]}
                      value={customHex}
                      onChangeText={onHexChange}
                      placeholder="#RRGGBB"
                      placeholderTextColor={COLORS.textSecondary}
                      autoCapitalize="characters"
                      maxLength={7}
                    />
                    {/* Aperçu de la couleur — à droite du champ, à gauche de « Appliquer ». */}
                    <View style={[styles.customPreview, { backgroundColor: customValid ? customHex : COLORS.cardBorder }, customActive && { borderColor: COLORS.text, borderWidth: 2 }]}>
                      {customActive && <Ionicons name="checkmark" size={18} color="#ffffff" />}
                    </View>
                    <TouchableOpacity
                      style={[styles.applyBtn, !customValid && { opacity: 0.5 }]}
                      onPress={applyHex}
                      disabled={!customValid}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.applyBtnText}>Appliquer</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.hint}>Débloquez les couleurs d'accent personnalisées avec Premium ou en boutique.</Text>
                  <TouchableOpacity style={styles.unlockBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.85}>
                    <Ionicons name="lock-open-outline" size={16} color={COLORS.bg} />
                    <Text style={styles.unlockBtnText}>Débloquer en boutique</Text>
                  </TouchableOpacity>
                </>
              )}
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
    lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    unlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 12, marginTop: 4 },
    unlockBtnText: { fontSize: 14, fontWeight: '700', color: c.bg },
  });
}
