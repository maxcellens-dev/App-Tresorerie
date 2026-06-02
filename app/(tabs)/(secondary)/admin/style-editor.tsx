import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../hooks/useProfile';
import { useAppColors } from '../../../hooks/useAppColors';
import { useStyleConfig, useSaveStyleConfig, type StyleConfig, type CustomPreset } from '../../../hooks/useStyleConfig';
import { THEME_PRESETS, THEME_MODES, buildColors } from '../../../theme/palette';
import type { ThemeMode, ThemePreset } from '../../../theme/palette';


const FONTS = [
  { id: 'System',           label: 'Système' },
  { id: 'Inter',            label: 'Inter' },
  { id: 'Roboto',           label: 'Roboto' },
  { id: 'Georgia',          label: 'Georgia' },
  { id: '"Helvetica Neue", Helvetica', label: 'Helvetica' },
  { id: '"Times New Roman", serif',    label: 'Times NR' },
  { id: '"Courier New", monospace',    label: 'Courier' },
  { id: 'Palatino, serif',             label: 'Palatino' },
  { id: 'Verdana, sans-serif',         label: 'Verdana' },
  { id: '"Trebuchet MS", sans-serif',  label: 'Trebuchet' },
  { id: 'Garamond, serif',             label: 'Garamond' },
  { id: 'Impact, fantasy',             label: 'Impact' },
];

function isValidHex(v: string) { return /^#[0-9A-Fa-f]{6}$/.test(v); }
function clampPct(v: number) { return Math.min(100, Math.max(0, v)); }
function toHex(a: number) { return Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0').toUpperCase(); }

type Tab = 'colors' | 'background' | 'font';

export default function StyleEditor() {
  const router = useRouter();
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const { data: styleConfig } = useStyleConfig();
  const saveStyle = useSaveStyleConfig();

  const isAdmin = profile?.is_admin ?? false;

  const [tab, setTab] = useState<Tab>('colors');
  const [previewMode, setPreviewMode] = useState<ThemeMode>('dark');
  const [activeMode, setActiveMode]   = useState<ThemeMode>('dark'); // mode édité (fond/cartes)
  const [preset, setPreset]   = useState<ThemePreset>('emerald');

  const [darkGradEnabled, setDarkGradEnabled]   = useState(true);
  const [darkGradOpacity, setDarkGradOpacity]   = useState('30');
  const [darkCardAlpha,   setDarkCardAlpha]     = useState('8');
  const [lightGradEnabled, setLightGradEnabled] = useState(true);
  const [lightGradOpacity, setLightGradOpacity] = useState('20');
  const [lightCardAlpha,   setLightCardAlpha]   = useState('4');

  const [fontFamily, setFontFamily] = useState('System');
  const [accentInputs, setAccentInputs] = useState<Record<string, string>>({});
  const [extraPresets, setExtraPresets] = useState<CustomPreset[]>([]);
  const [hiddenPresets, setHiddenPresets] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newDark,  setNewDark]  = useState('#FFFFFF');
  const [newLight, setNewLight] = useState('#000000');

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    if (profile) {
      setPreviewMode(profile.theme_mode ?? 'dark');
      setActiveMode(profile.theme_mode ?? 'dark');
      setPreset((profile.theme_preset as ThemePreset) ?? 'emerald');
    }
  }, [profile]);

  useEffect(() => {
    if (styleConfig) {
      setDarkGradEnabled(styleConfig.dark.gradient_enabled);
      setDarkGradOpacity(String(styleConfig.dark.gradient_opacity));
      setDarkCardAlpha(String(styleConfig.dark.card_alpha));
      setLightGradEnabled(styleConfig.light.gradient_enabled);
      setLightGradOpacity(String(styleConfig.light.gradient_opacity));
      setLightCardAlpha(String(styleConfig.light.card_alpha));
      setFontFamily(styleConfig.font_family ?? 'System');
      setExtraPresets(styleConfig.extra_presets ?? []);
      setHiddenPresets(styleConfig.hidden_presets ?? []);
      const inputs: Record<string, string> = {};
      THEME_PRESETS.forEach(p => { inputs[p.id] = styleConfig.custom_accents?.[p.id] ?? p.swatch; });
      setAccentInputs(inputs);
    }
  }, [styleConfig]);

  // Accents valides pour l'aperçu live
  const liveAccents: Record<string, string> = {};
  THEME_PRESETS.forEach(p => { const v = accentInputs[p.id] ?? ''; if (isValidHex(v)) liveAccents[p.id] = v; });

  const previewAlpha = previewMode === 'dark' ? Number(darkCardAlpha || 0) : Number(lightCardAlpha || 0);
  const previewColors = buildColors(previewMode, preset, { customAccents: liveAccents, extraPresets, cardAlpha: previewAlpha });
  const curGradEnabled = previewMode === 'dark' ? darkGradEnabled : lightGradEnabled;
  const curGradOpacity = Number(previewMode === 'dark' ? darkGradOpacity : lightGradOpacity) / 100;

  // Getters/setters du mode édité (onglet Fond)
  const aEnabled  = activeMode === 'dark' ? darkGradEnabled  : lightGradEnabled;
  const aGrad     = activeMode === 'dark' ? darkGradOpacity  : lightGradOpacity;
  const aAlpha    = activeMode === 'dark' ? darkCardAlpha    : lightCardAlpha;
  const setEnabled = (v: boolean) => activeMode === 'dark' ? setDarkGradEnabled(v) : setLightGradEnabled(v);
  const setGrad    = (v: string)  => activeMode === 'dark' ? setDarkGradOpacity(v) : setLightGradOpacity(v);
  const setAlpha   = (v: string)  => activeMode === 'dark' ? setDarkCardAlpha(v)   : setLightCardAlpha(v);

  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      await updateProfile.mutateAsync({ theme_mode: previewMode, theme_preset: preset });
      const validated: Record<string, string> = {};
      THEME_PRESETS.forEach(p => { const v = accentInputs[p.id] ?? ''; if (isValidHex(v)) validated[p.id] = v; });
      const sc: Partial<StyleConfig> = {
        dark:  { gradient_enabled: darkGradEnabled,  gradient_opacity: clampPct(Number(darkGradOpacity) || 0),  card_alpha: clampPct(Number(darkCardAlpha) || 0) },
        light: { gradient_enabled: lightGradEnabled, gradient_opacity: clampPct(Number(lightGradOpacity) || 0), card_alpha: clampPct(Number(lightCardAlpha) || 0) },
        font_family: fontFamily,
        custom_accents: validated,
        extra_presets: extraPresets,
        hidden_presets: hiddenPresets,
      };
      await saveStyle.mutateAsync(sc);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe}><Text style={styles.body}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'colors',     label: 'Couleurs',     icon: 'color-palette-outline' },
    { id: 'background', label: 'Fond & Cartes', icon: 'layers-outline' },
    { id: 'font',       label: 'Police',       icon: 'text-outline' },
  ];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[COLORS.emerald + '4D', COLORS.emerald + '2E', COLORS.emerald + '14', COLORS.bg]}
        locations={[0, 0.28, 0.58, 1.0]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(tabs)/(secondary)/admin' as any)}>
            <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Design System</Text>
            <Text style={styles.headerSub}>Identité visuelle de l'app</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* ══ Aperçu (toujours visible) ══ */}
          <View style={styles.preview}>
            <LinearGradient
              colors={curGradEnabled && curGradOpacity > 0
                ? [previewColors.emerald + toHex(curGradOpacity), previewColors.emerald + toHex(curGradOpacity * 0.6), previewColors.emerald + toHex(curGradOpacity * 0.33), previewColors.bg]
                : [previewColors.bg, previewColors.bg]}
              locations={[0, 0.28, 0.58, 1]}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.previewHeader}>
              <Text style={[styles.previewLabel, { color: previewMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)' }]}>APERÇU</Text>
              <View style={styles.previewModeSwitcher}>
                {THEME_MODES.map(m => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.previewModeBtn, previewMode === m.id && { backgroundColor: previewColors.emerald + '30' }]}
                    onPress={() => { setPreviewMode(m.id); setActiveMode(m.id); }}
                  >
                    <Ionicons name={m.icon as any} size={13} color={previewMode === m.id ? previewColors.emerald : (previewMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.previewCards}>
              {(['Courant', 'Épargne', 'Invest'] as const).map((label, i) => {
                const cols = [previewColors.checking, previewColors.savings, previewColors.investment];
                const col = cols[i];
                const amounts = ['6 118', '21 000', '76 687'];
                const cardBg = previewMode === 'dark'
                  ? `rgba(255,255,255,${previewAlpha / 100})`
                  : `rgba(0,0,0,${previewAlpha / 100})`;
                const txtMuted = previewMode === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
                return (
                  <View key={label} style={[styles.previewCard, { backgroundColor: cardBg, borderColor: col + '40', borderLeftColor: col }]}>
                    <Ionicons name={i === 0 ? 'wallet-outline' : i === 1 ? 'leaf-outline' : 'trending-up-outline'} size={13} color={col} />
                    <Text style={[styles.previewCardLabel, { color: txtMuted, fontFamily: fontFamily === 'System' ? undefined : fontFamily }]}>{label}</Text>
                    <Text style={[styles.previewCardAmount, { color: col, fontFamily: fontFamily === 'System' ? undefined : fontFamily }]}>{amounts[i]} €</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* ══ Onglets ══ */}
          <View style={styles.tabBar}>
            {TABS.map(t => (
              <TouchableOpacity
                key={t.id}
                style={[styles.tabBtn, tab === t.id && { backgroundColor: COLORS.emerald + '20', borderColor: COLORS.emerald }]}
                onPress={() => setTab(t.id)}
              >
                <Ionicons name={t.icon as any} size={15} color={tab === t.id ? COLORS.emerald : COLORS.textSecondary} />
                <Text style={[styles.tabBtnText, { color: tab === t.id ? COLORS.emerald : COLORS.textSecondary }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ══════════ ONGLET COULEURS ══════════ */}
          {tab === 'colors' && (
            <>
              <Section label="Mode appliqué à votre compte" icon="contrast-outline" COLORS={COLORS}>
                <View style={styles.row2}>
                  {THEME_MODES.map(m => (
                    <ModeBtn key={m.id} label={m.label} icon={m.icon} active={previewMode === m.id} accent={previewColors.emerald} COLORS={COLORS}
                      onPress={() => { setPreviewMode(m.id); setActiveMode(m.id); }} />
                  ))}
                </View>
              </Section>

              <Section label="Couleurs d'accentuation (modifiables)" icon="color-palette-outline" COLORS={COLORS}>
                <Text style={styles.hint}>Pastille = activer · code hex = modifier · œil = masquer dans Paramètres.</Text>
                <View style={{ gap: 10 }}>
                  {THEME_PRESETS.map(p => {
                    const inputHex = accentInputs[p.id] ?? p.swatch;
                    const valid = isValidHex(inputHex);
                    const col = valid ? inputHex : p.swatch;
                    const active = preset === p.id;
                    const hidden = hiddenPresets.includes(p.id);
                    return (
                      <View key={p.id} style={[styles.accentItem, active && { borderColor: col, borderWidth: 2 }, hidden && { opacity: 0.45 }]}>
                        <TouchableOpacity style={[styles.swatch, { backgroundColor: col }]} onPress={() => setPreset(p.id)} activeOpacity={0.8}>
                          {active && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </TouchableOpacity>
                        <Text style={styles.accentLabel}>{p.emoji} {p.label}{hidden ? ' · masqué' : ''}</Text>
                        <TextInput
                          style={[styles.hexInput, { width: 84 }, !valid && { borderColor: COLORS.danger }]}
                          value={inputHex}
                          onChangeText={v => setAccentInputs(prev => ({ ...prev, [p.id]: v }))}
                          placeholder="#RRGGBB" placeholderTextColor={COLORS.textSecondary}
                          maxLength={7} autoCapitalize="characters"
                        />
                        <TouchableOpacity
                          onPress={() => setHiddenPresets(prev => hidden ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={hidden ? COLORS.textSecondary : COLORS.emerald} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </Section>

              <Section label="Presets personnalisés" icon="add-circle-outline" COLORS={COLORS}>
                <Text style={styles.hint}>Disponibles ensuite pour tous les utilisateurs dans Paramètres.</Text>
                {extraPresets.map(p => (
                  <View key={p.id} style={[styles.accentItem, preset === p.id && { borderColor: p.dark, borderWidth: 2 }]}>
                    <TouchableOpacity style={[styles.swatch, { backgroundColor: p.dark }]} onPress={() => setPreset(p.id)} activeOpacity={0.8}>
                      {preset === p.id && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </TouchableOpacity>
                    <Text style={styles.accentLabel}>{p.label}</Text>
                    <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginRight: 6 }}>{p.dark}</Text>
                    <TouchableOpacity onPress={() => { if (preset === p.id) setPreset('emerald'); setExtraPresets(prev => prev.filter(x => x.id !== p.id)); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={20} color={COLORS.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={[styles.accentItem, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.textSecondary }}>Nouveau preset</Text>
                  <TextInput style={[styles.hexInput, { textAlign: 'left', paddingLeft: 10 }]} value={newLabel} onChangeText={setNewLabel}
                    placeholder="Nom (ex. Turquoise)" placeholderTextColor={COLORS.textSecondary} />
                  <View style={styles.row2g}>
                    <View style={[styles.swatch, { backgroundColor: isValidHex(newDark) ? newDark : '#888' }]} />
                    <TextInput style={[styles.hexInput, { flex: 1 }]} value={newDark} onChangeText={setNewDark} placeholder="#RRGGBB sombre" placeholderTextColor={COLORS.textSecondary} maxLength={7} autoCapitalize="characters" />
                  </View>
                  <View style={styles.row2g}>
                    <View style={[styles.swatch, { backgroundColor: isValidHex(newLight) ? newLight : '#888', borderWidth: 1, borderColor: COLORS.cardBorder }]} />
                    <TextInput style={[styles.hexInput, { flex: 1 }]} value={newLight} onChangeText={setNewLight} placeholder="#RRGGBB clair" placeholderTextColor={COLORS.textSecondary} maxLength={7} autoCapitalize="characters" />
                  </View>
                  <TouchableOpacity
                    style={{ backgroundColor: (newLabel.trim() && isValidHex(newDark) && isValidHex(newLight)) ? COLORS.emerald : COLORS.cardBorder, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                    onPress={() => {
                      if (!newLabel.trim() || !isValidHex(newDark) || !isValidHex(newLight)) return;
                      setExtraPresets(prev => [...prev, { id: 'custom_' + Date.now(), label: newLabel.trim(), dark: newDark.toUpperCase(), light: newLight.toUpperCase() }]);
                      setNewLabel(''); setNewDark('#FFFFFF'); setNewLight('#000000');
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>+ Ajouter ce preset</Text>
                  </TouchableOpacity>
                </View>
              </Section>
            </>
          )}

          {/* ══════════ ONGLET FOND & CARTES ══════════ */}
          {tab === 'background' && (
            <>
              {/* Sélecteur du mode à éditer */}
              <View style={styles.modeTabs}>
                {THEME_MODES.map(m => (
                  <TouchableOpacity key={m.id}
                    style={[styles.modeTab, activeMode === m.id && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '18' }]}
                    onPress={() => { setActiveMode(m.id); setPreviewMode(m.id); }}>
                    <Ionicons name={m.icon as any} size={14} color={activeMode === m.id ? COLORS.emerald : COLORS.textSecondary} />
                    <Text style={[styles.modeTabText, { color: activeMode === m.id ? COLORS.emerald : COLORS.textSecondary }]}>Réglages {m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Section label="Dégradé de fond" icon="layers-outline" COLORS={COLORS}>
                <View style={styles.row2}>
                  <ModeBtn label="Activé" icon="eye-outline" active={aEnabled} accent={COLORS.emerald} COLORS={COLORS} onPress={() => setEnabled(true)} />
                  <ModeBtn label="Désactivé" icon="eye-off-outline" active={!aEnabled} accent={COLORS.danger} COLORS={COLORS} onPress={() => setEnabled(false)} />
                </View>
                {aEnabled && (
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Opacité du dégradé (0-100 %)</Text>
                    <PctInput value={aGrad} onChange={v => setGrad(v)} COLORS={COLORS} />
                  </View>
                )}
              </Section>

              <Section label="Transparence des cartes" icon="albums-outline" COLORS={COLORS}>
                <Text style={styles.hint}>0 % = opaque · plus le % monte, plus le fond transparaît.</Text>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Opacité des cartes (0-100 %)</Text>
                  <PctInput value={aAlpha} onChange={v => setAlpha(v)} COLORS={COLORS} />
                </View>
                <View style={styles.alphaRow}>
                  {[0, 8, 15, 25].map(pct => {
                    const bg = activeMode === 'dark' ? `rgba(255,255,255,${pct / 100})` : `rgba(0,0,0,${pct / 100})`;
                    return (
                      <TouchableOpacity key={pct} style={[styles.alphaSample, { backgroundColor: bg }, Math.abs(Number(aAlpha || 0) - pct) < 2 && { borderColor: COLORS.emerald }]} onPress={() => setAlpha(String(pct))}>
                        <Text style={{ color: COLORS.textSecondary, fontSize: 10, fontWeight: '600' }}>{pct}%</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>
            </>
          )}

          {/* ══════════ ONGLET POLICE ══════════ */}
          {tab === 'font' && (
            <Section label="Police de caractères" icon="text-outline" COLORS={COLORS}>
              <Text style={styles.hint}>Appliquée partout sur le web. Sur mobile, seules les polices système s'appliquent.</Text>
              <View style={styles.fontGrid}>
                {FONTS.map(f => (
                  <TouchableOpacity key={f.id}
                    style={[styles.fontBtn, fontFamily === f.id && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '18' }]}
                    onPress={() => setFontFamily(f.id)} activeOpacity={0.8}>
                    <Text style={[styles.fontSample, { fontFamily: f.id === 'System' ? undefined : f.id }]}>Aa</Text>
                    <Text style={[styles.fontLabel, fontFamily === f.id && { color: COLORS.emerald }]}>{f.label}</Text>
                    {fontFamily === f.id && <View style={[styles.fontCheck, { backgroundColor: COLORS.emerald }]}><Ionicons name="checkmark" size={9} color="#fff" /></View>}
                  </TouchableOpacity>
                ))}
              </View>
            </Section>
          )}

          {/* Enregistrer */}
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: COLORS.emerald }, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name={saved ? 'checkmark-circle' : 'save-outline'} size={20} color="#fff" />
                <Text style={styles.saveBtnLabel}>{saved ? 'Enregistré !' : 'Appliquer les changements'}</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.footnote}>
            Mode et accentuation : par utilisateur.{'\n'}
            Dégradé, transparence, police et palette : globaux.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Sous-composants ──
function Section({ label, icon, COLORS, children }: { label: string; icon: string; COLORS: any; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 26 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Ionicons name={icon as any} size={15} color={COLORS.emerald} />
        <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function ModeBtn({ label, icon, active, accent, COLORS, onPress }: { label: string; icon: string; active: boolean; accent: string; COLORS: any; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: active ? accent : COLORS.cardBorder, backgroundColor: active ? accent + '20' : COLORS.card }}
      onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon as any} size={16} color={active ? accent : COLORS.textSecondary} />
      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? accent : COLORS.textSecondary }}>{label}</Text>
    </TouchableOpacity>
  );
}

function PctInput({ value, onChange, COLORS }: { value: string; onChange: (v: string) => void; COLORS: any }) {
  const styles = makeStyles(COLORS);
  return (
    <View style={styles.pctWrap}>
      <TextInput style={styles.pctInput} value={value} onChangeText={v => onChange(v.replace(/[^0-9]/g, '').slice(0, 3))} keyboardType="number-pad" maxLength={3} />
      <Text style={styles.pctUnit}>%</Text>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: c.text, letterSpacing: -0.4, textAlign: 'center' },
  headerSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },

  preview: { borderRadius: 20, overflow: 'hidden', height: 170, padding: 14, marginBottom: 20, justifyContent: 'space-between', borderWidth: 1, borderColor: c.cardBorder },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  previewModeSwitcher: { flexDirection: 'row', gap: 4 },
  previewModeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  previewCards: { flexDirection: 'row', gap: 8 },
  previewCard: { flex: 1, borderRadius: 10, padding: 8, gap: 3, borderWidth: 1, borderLeftWidth: 3 },
  previewCardLabel: { fontSize: 9 },
  previewCardAmount: { fontSize: 13, fontWeight: '700' },

  tabBar: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: c.cardBorder, backgroundColor: c.card },
  tabBtnText: { fontSize: 11, fontWeight: '700' },

  row2: { flexDirection: 'row', gap: 10 },
  row2g: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  hint: { fontSize: 12, color: c.textSecondary, marginBottom: 12, lineHeight: 17 },

  accentItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  accentLabel: { flex: 1, fontSize: 14, color: c.text, fontWeight: '500' },
  hexInput: { width: 96, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, color: c.text, fontSize: 13, fontWeight: '600', textAlign: 'center', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },

  modeTabs: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  modeTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
  modeTabText: { fontSize: 12, fontWeight: '600' },

  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  inputLabel: { fontSize: 13, color: c.textSecondary, flex: 1 },
  pctWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pctInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: c.text, fontSize: 18, fontWeight: '700', width: 72, textAlign: 'center', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  pctUnit: { fontSize: 16, color: c.textSecondary, fontWeight: '600' },

  alphaRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  alphaSample: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },

  fontGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fontBtn: { width: '30%', borderRadius: 12, padding: 12, borderWidth: 1.5, borderColor: c.cardBorder, backgroundColor: c.card, alignItems: 'center', gap: 4, position: 'relative' },
  fontSample: { fontSize: 22, fontWeight: '700', color: c.text },
  fontLabel: { fontSize: 10, color: c.textSecondary, fontWeight: '600', textAlign: 'center' },
  fontCheck: { position: 'absolute', top: 5, right: 5, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 16, paddingVertical: 16, marginTop: 8, marginBottom: 16 },
  saveBtnLabel: { fontSize: 16, fontWeight: '700', color: '#fff' },
  footnote: { fontSize: 11, color: c.textSecondary, textAlign: 'center', lineHeight: 16 },
  body: { color: c.text, padding: 20 },
});
}
