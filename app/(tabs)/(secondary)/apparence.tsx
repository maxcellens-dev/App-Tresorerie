/**
 * Apparence — mode d'affichage (admin) + couleur d'accent. Déplacé depuis Paramètres.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../hooks/useProfile';
import { useAppColors } from '../../../hooks/useAppColors';
import { useGamification } from '../../../hooks/useGamification';
import { usePlan } from '../../../hooks/usePlan';
import { useCosmetics } from '../../../hooks/useCosmetics';
import { useNavBack } from '../../../hooks/useNavBack';
import { COSMETIC_DEFS } from '../../../lib/gamification';
import { THEME_MODES, THEME_PRESETS, NATIVE_PRESET_IDS, resolveAccent, type ThemeMode, type ThemePreset } from '../../../theme/palette';
import { useStyleConfig, orderPresetIds } from '../../../hooks/useStyleConfig';

export default function AppearanceScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const goBack = useNavBack();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const isAdmin = profile?.is_admin ?? false;
  const currentMode = (profile?.theme_mode ?? 'dark') as ThemeMode;
  const currentPreset = (profile?.theme_preset ?? 'emerald') as ThemePreset;

  const { data: styleConfig } = useStyleConfig();
  const allPresets = useMemo(() => {
    const hidden = new Set(styleConfig?.hidden_presets ?? []);
    // La pastille affiche EXACTEMENT la couleur qui sera appliquée pour le mode courant
    // (résolution identique à useAppColors) → plus de décalage liste ↔ appliqué.
    const opts = { customAccents: styleConfig?.custom_accents, extraPresets: styleConfig?.extra_presets };
    const native = THEME_PRESETS.map((p) => ({ id: p.id, label: p.label, swatch: resolveAccent(currentMode, p.id, opts) }));
    const extra = (styleConfig?.extra_presets ?? []).map((p) => ({ id: p.id, label: p.label, swatch: resolveAccent(currentMode, p.id, opts) }));
    const all = [...native, ...extra];
    const ordered = orderPresetIds(all.map((p) => p.id), styleConfig?.preset_order);
    return ordered.map((id) => all.find((p) => p.id === id)!).filter((p) => p && !hidden.has(p.id));
  }, [styleConfig, currentMode]);

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

  // Les 14 pastilles de couleur d'accent sont GRATUITES pour tout le monde.
  // SEUL le sélecteur de couleur personnalisée (saisie du code hex, sous les pastilles)
  // est réservé aux abonnés Premium.
  const { config: gamiConfig, inventory } = useGamification(user?.id);
  const { isPremium } = usePlan(user?.id);
  const colorsUnlocked = isPremium;
  // Le « Pack couleurs » (7 teintes secondaires) s'obtient UNIQUEMENT via un achat en boutique,
  // pas avec le Premium (§N10).
  const hasAccentPack = inventory.some((i) => i.item_key === 'accent_pack' && i.qty > 0);

  // Perte du Premium : si une couleur d'accent personnalisée (hex) est appliquée, on revient
  // au thème par défaut → l'avantage premium disparaît. Garde-fou : profil chargé.
  useEffect(() => {
    if (!profile) return;
    if (colorsUnlocked) return;
    if (isHex(currentPreset)) setPreset('emerald');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, colorsUnlocked, currentPreset]);

  // ── Cosmétiques débloqués (inventaire) + équipés ──
  const cosmetics = useCosmetics(user?.id);
  const ownedCosmetics = useMemo(() => {
    return cosmetics.ownedKeys.map((key) => {
      const shopItem = gamiConfig?.shop.find((s) => s.key === key);
      const def = COSMETIC_DEFS[key];
      // Couleur d'illustration : pour un cadre/flamme = sa teinte ; pour un titre = doré.
      const color = def && /^#[0-9A-Fa-f]{6}$/.test(def.value) ? def.value : '#f59e0b';
      return {
        key,
        label: shopItem?.label ?? key,
        description: shopItem?.description ?? '',
        icon: shopItem?.icon ?? 'sparkles',
        slot: def?.slot ?? 'autre',
        slotLabel: def?.slotLabel ?? '',
        color,
        equipped: cosmetics.isEquipped(key),
      };
    });
  }, [cosmetics.ownedKeys, cosmetics.equipped, gamiConfig]);

  // Cosmétiques regroupés par catégorie (emplacement) et triés par nom.
  const cosmeticGroups = useMemo(() => {
    const order: { slot: string; label: string }[] = [
      { slot: 'avatar_frame', label: "Cadres d'avatar" },
      { slot: 'title', label: 'Titres de profil' },
      { slot: 'streak_flame', label: 'Flammes de série' },
    ];
    return order
      .map((g) => ({
        ...g,
        items: ownedCosmetics
          .filter((c) => c.slot === g.slot)
          .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
      }))
      .filter((g) => g.items.length > 0);
  }, [ownedCosmetics]);
  // Les presets natifs (7 couleurs de base) sont gratuits pour tous.
  // Les presets supplémentaires créés dans le Style Editor forment le "Pack couleurs".
  const nativePresets = allPresets.filter((p) => NATIVE_PRESET_IDS.includes(p.id));
  const packPresets = allPresets.filter((p) => !NATIVE_PRESET_IDS.includes(p.id));

  return (
    <View style={styles.root}>
      <StatusBar style={currentMode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Apparence</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={styles.card}>
            {/* Mode d'affichage clair / sombre — accessible à tous les utilisateurs. */}
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

            <View style={styles.block}>
              <Text style={styles.label}>Couleur d'accent</Text>
              <View style={styles.presetRow}>
                {/* Presets natifs (toujours libres) + presets du pack si débloqué */}
                {(hasAccentPack ? allPresets : nativePresets).map((p) => {
                  const active = currentPreset === p.id;
                  return (
                    <TouchableOpacity key={p.id} style={[styles.presetDot, { backgroundColor: p.swatch }, active && styles.presetDotActive]} onPress={() => setPreset(p.id as ThemePreset)} activeOpacity={0.8} accessibilityLabel={p.label}>
                      {active && <Ionicons name="checkmark" size={18} color="#ffffff" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Pack couleurs — extra presets créés dans le Style Editor, achetables en boutique */}
            {packPresets.length > 0 && !hasAccentPack && (
              <View style={[styles.block, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: 16, marginTop: 16 }]}>
                <View style={styles.lockRow}>
                  <Text style={styles.label}>Pack couleurs</Text>
                  <Ionicons name="lock-closed" size={15} color={COLORS.textSecondary} />
                </View>
                <Text style={styles.hint}>Couleurs supplémentaires disponibles à la boutique.</Text>
                <View style={styles.presetRow}>
                  {packPresets.map((p) => (
                    <View key={p.id} style={[styles.presetDot, { backgroundColor: p.swatch, opacity: 0.35 }]} />
                  ))}
                </View>
                <TouchableOpacity style={styles.unlockBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.85}>
                  <Ionicons name="bag-handle-outline" size={16} color={COLORS.bg} />
                  <Text style={styles.unlockBtnText}>Voir en boutique</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Couleur personnalisée — réservée aux abonnés Premium */}
            <View style={[styles.block, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: 16, marginTop: 16 }]}>
              <View style={styles.lockRow}>
                <Text style={styles.label}>Couleur personnalisée</Text>
                {colorsUnlocked ? (
                  <View style={{ marginLeft: 8, width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(245,179,1,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="star" size={11} color="#F5B301" />
                  </View>
                ) : (
                  <Ionicons name="lock-closed" size={15} color={COLORS.textSecondary} />
                )}
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
                  <Text style={styles.hint}>La personnalisation de la couleur d'accent est réservée aux abonnés Premium.</Text>
                  <TouchableOpacity style={styles.unlockBtn} onPress={() => router.push('/(tabs)/(secondary)/premium' as any)} activeOpacity={0.85}>
                    <Ionicons name="star-outline" size={16} color={COLORS.bg} />
                    <Text style={styles.unlockBtnText}>Passer Premium</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* ── Cosmétique : équiper les cosmétiques débloqués en boutique ── */}
            <View style={[styles.block, { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: 16, marginTop: 16 }]}>
              <Text style={styles.label}>Cosmétique</Text>
              {ownedCosmetics.length === 0 ? (
                <>
                  <Text style={styles.hint}>Aucun cosmétique débloqué pour le moment. Procurez-vous-en en boutique pour personnaliser votre profil.</Text>
                  <TouchableOpacity style={styles.unlockBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.85}>
                    <Ionicons name="bag-handle-outline" size={16} color={COLORS.bg} />
                    <Text style={styles.unlockBtnText}>Voir la boutique</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.hint}>Cochez un cosmétique pour l'équiper. Il s'affichera sur votre profil et dans l'app.</Text>
                  {cosmeticGroups.map((group) => (
                    <View key={group.slot}>
                      <Text style={styles.cosmeticGroupTitle}>{group.label}</Text>
                      <View style={styles.cosmeticGrid}>
                        {group.items.map((cos) => (
                          <TouchableOpacity
                            key={cos.key}
                            style={[styles.cosmeticCard, cos.equipped && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '14' }]}
                            onPress={() => cosmetics.toggle(cos.key)}
                            activeOpacity={0.8}
                          >
                            <View style={[styles.cosmeticCardIcon, { backgroundColor: cos.color + '22' }]}>
                              <Ionicons name={cos.icon as any} size={22} color={cos.color} />
                            </View>
                            <Text style={styles.cosmeticCardLabel} numberOfLines={2}>{cos.label}</Text>
                            {cos.equipped && (
                              <View style={styles.cosmeticCheck}>
                                <Ionicons name="checkmark" size={12} color="#fff" />
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}
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
    cosmeticGroupTitle: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 2 },
    cosmeticGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
    cosmeticCard: { flexBasis: '30%', flexGrow: 0, height: 96, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 7 },
    cosmeticCardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    cosmeticCardLabel: { fontSize: 11, fontWeight: '700', color: c.text, textAlign: 'center' },
    cosmeticCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
  });
}
