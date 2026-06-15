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
import { useNavBack } from '../../../hooks/useNavBack';
import { supabase } from '../../../lib/supabase';
import { useStyleConfig, useSaveStyleConfig, getGradientStops, orderPresetIds, type StyleConfig, type CustomPreset, type CustomFont, type ModeStyleConfig } from '../../../hooks/useStyleConfig';
import { THEME_PRESETS, THEME_MODES, buildColors, SEMANTIC_KEYS, SEMANTIC_DEFAULTS, SEMANTIC_DEFAULTS_LIGHT, SEMANTIC_LABELS, DEFAULT_BG } from '../../../theme/palette';
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
  const goBack = useNavBack();
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
  const [darkStops,       setDarkStops]         = useState<string[]>(['30', '18', '10', '5']);
  const [darkCardAlpha,   setDarkCardAlpha]     = useState('8');
  const [darkBg,          setDarkBg]            = useState(DEFAULT_BG.dark);
  const [lightGradEnabled, setLightGradEnabled] = useState(true);
  const [lightStops,       setLightStops]       = useState<string[]>(['20', '12', '7', '3']);
  const [lightCardAlpha,   setLightCardAlpha]   = useState('4');
  const [lightBg,          setLightBg]          = useState(DEFAULT_BG.light);

  const [fontFamily, setFontFamily] = useState('System');
  const [fontImportUrl, setFontImportUrl] = useState('');
  const [appNameFont, setAppNameFont] = useState('Arial Rounded MT Bold');
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [fontUploading, setFontUploading] = useState(false);
  const [fontUploadMsg, setFontUploadMsg] = useState<string | null>(null);
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const [accentInputs, setAccentInputs] = useState<Record<string, string>>({});
  const [semanticInputs, setSemanticInputs] = useState<Record<string, string>>({});
  const [lightSemanticInputs, setLightSemanticInputs] = useState<Record<string, string>>({});
  const [extraPresets, setExtraPresets] = useState<CustomPreset[]>([]);
  const [hiddenPresets, setHiddenPresets] = useState<string[]>([]);
  const [presetOrder, setPresetOrder] = useState<string[]>([]);
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
      const toStopStrings = (cfg: ModeStyleConfig, fb: number) =>
        getGradientStops(cfg, fb).map((v) => String(Math.round(v * 100)));
      setDarkGradEnabled(styleConfig.dark.gradient_enabled);
      setDarkStops(toStopStrings(styleConfig.dark, 30));
      setDarkCardAlpha(String(styleConfig.dark.card_alpha));
      setDarkBg(styleConfig.dark.bg_color ?? DEFAULT_BG.dark);
      setLightGradEnabled(styleConfig.light.gradient_enabled);
      setLightStops(toStopStrings(styleConfig.light, 20));
      setLightCardAlpha(String(styleConfig.light.card_alpha));
      setLightBg(styleConfig.light.bg_color ?? DEFAULT_BG.light);
      setFontFamily(styleConfig.font_family ?? 'System');
      setFontImportUrl(styleConfig.font_import_url ?? '');
      setAppNameFont(styleConfig.app_name_font ?? 'Arial Rounded MT Bold');
      setCustomFonts(styleConfig.custom_fonts ?? []);
      setExtraPresets(styleConfig.extra_presets ?? []);
      setHiddenPresets(styleConfig.hidden_presets ?? []);
      const allIds = [...THEME_PRESETS.map(p => p.id), ...(styleConfig.extra_presets ?? []).map(p => p.id)];
      setPresetOrder(orderPresetIds(allIds, styleConfig.preset_order));
      const inputs: Record<string, string> = {};
      THEME_PRESETS.forEach(p => { inputs[p.id] = styleConfig.custom_accents?.[p.id] ?? p.swatch; });
      setAccentInputs(inputs);
      const semInputs: Record<string, string> = {};
      SEMANTIC_KEYS.forEach(k => { semInputs[k] = styleConfig.semantic_colors?.[k] ?? SEMANTIC_DEFAULTS[k]; });
      setSemanticInputs(semInputs);
      const lightSemInputs: Record<string, string> = {};
      SEMANTIC_KEYS.forEach(k => { lightSemInputs[k] = styleConfig.light_semantic_colors?.[k] ?? SEMANTIC_DEFAULTS_LIGHT[k]; });
      setLightSemanticInputs(lightSemInputs);
    }
  }, [styleConfig]);

  // Accents valides pour l'aperçu live
  const liveAccents: Record<string, string> = {};
  THEME_PRESETS.forEach(p => { const v = accentInputs[p.id] ?? ''; if (isValidHex(v)) liveAccents[p.id] = v; });

  // Couleurs sémantiques valides pour l'aperçu live (selon le mode de prévisualisation)
  const liveSemantics: Record<string, string> = {};
  const liveLightSemantics: Record<string, string> = {};
  SEMANTIC_KEYS.forEach(k => {
    const vd = semanticInputs[k] ?? ''; if (isValidHex(vd)) liveSemantics[k] = vd;
    const vl = lightSemanticInputs[k] ?? ''; if (isValidHex(vl)) liveLightSemantics[k] = vl;
  });

  // Liste ordonnée des presets (natifs + custom) pour l'affichage et le réordonnancement
  const allPresetIds = [...THEME_PRESETS.map(p => p.id), ...extraPresets.map(p => p.id)];
  const orderedPresetIds = orderPresetIds(allPresetIds, presetOrder);
  const movePreset = (id: string, dir: -1 | 1) => {
    const ids = orderPresetIds(allPresetIds, presetOrder);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const arr = [...ids];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setPresetOrder(arr);
  };

  const previewAlpha = previewMode === 'dark' ? Number(darkCardAlpha || 0) : Number(lightCardAlpha || 0);
  const previewBg = previewMode === 'dark' ? darkBg : lightBg;
  const previewColors = buildColors(previewMode, preset, { customAccents: liveAccents, extraPresets, cardAlpha: previewAlpha, semanticColors: liveSemantics, lightSemanticColors: liveLightSemantics, bgColor: previewBg });
  const curGradEnabled = previewMode === 'dark' ? darkGradEnabled : lightGradEnabled;
  const curStops = (previewMode === 'dark' ? darkStops : lightStops).map(s => Math.min(100, Math.max(0, Number(s) || 0)) / 100);

  // Getters/setters du mode édité (onglet Fond)
  const aEnabled = activeMode === 'dark' ? darkGradEnabled : lightGradEnabled;
  const aStops   = activeMode === 'dark' ? darkStops : lightStops;
  const aAlpha   = activeMode === 'dark' ? darkCardAlpha : lightCardAlpha;
  const aBg      = activeMode === 'dark' ? darkBg : lightBg;
  const setEnabled = (v: boolean) => activeMode === 'dark' ? setDarkGradEnabled(v) : setLightGradEnabled(v);
  const setStop    = (i: number, v: string) => {
    const setter = activeMode === 'dark' ? setDarkStops : setLightStops;
    setter(prev => prev.map((s, idx) => idx === i ? v : s));
  };
  const setAlpha   = (v: string)  => activeMode === 'dark' ? setDarkCardAlpha(v)   : setLightCardAlpha(v);
  const setBg      = (v: string)  => activeMode === 'dark' ? setDarkBg(v)          : setLightBg(v);

  // Téléverse un fichier de police vers Supabase Storage (bucket public « fonts »).
  // Web uniquement (ouverture du sélecteur de fichier natif du navigateur).
  function uploadFont() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setFontUploadMsg('Le téléversement de police se fait depuis la version web.');
      return;
    }
    if (!supabase) { setFontUploadMsg('Supabase non configuré.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setFontUploading(true); setFontUploadMsg(null);
      try {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `app/${Date.now()}_${safe}`;
        const { error } = await supabase!.storage.from('fonts').upload(path, file, {
          upsert: true, contentType: file.type || 'font/ttf', cacheControl: '31536000',
        });
        if (error) throw error;
        const { data } = supabase!.storage.from('fonts').getPublicUrl(path);
        // Nom de famille dérivé du fichier (unique).
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Police importée';
        let family = base;
        let n = 2;
        while (customFonts.some((f) => f.family === family)) { family = `${base} ${n++}`; }
        setCustomFonts((prev) => [...prev, { family, url: data.publicUrl }]);
        setAppNameFont(family); // sélectionne automatiquement la police importée
        setFontUploadMsg(`Police « ${family} » importée et sélectionnée. Cliquez « Appliquer » pour valider.`);
      } catch (e: unknown) {
        setFontUploadMsg(e instanceof Error ? e.message : 'Échec du téléversement.');
      } finally {
        setFontUploading(false);
      }
    };
    input.click();
  }

  function removeCustomFont(family: string) {
    setCustomFonts((prev) => prev.filter((f) => f.family !== family));
    if (appNameFont === family) setAppNameFont('Arial Rounded MT Bold');
  }

  // Options de la liste déroulante « police du titre » : système + intégrées + importées.
  const titleFontOptions: { family: string; label: string; custom?: boolean }[] = [
    { family: 'System', label: 'Système (défaut)' },
    { family: 'Arial Rounded MT Bold', label: 'Arial Rounded MT Bold' },
    ...FONTS.filter((f) => f.id !== 'System').map((f) => ({ family: f.id, label: f.label })),
    ...customFonts.map((cf) => ({ family: cf.family, label: `${cf.family} · importée`, custom: true })),
  ].filter((opt, i, arr) => arr.findIndex((o) => o.family === opt.family) === i);

  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      await updateProfile.mutateAsync({ theme_mode: previewMode, theme_preset: preset });
      const validated: Record<string, string> = {};
      THEME_PRESETS.forEach(p => { const v = accentInputs[p.id] ?? ''; if (isValidHex(v)) validated[p.id] = v; });
      const validatedSemantics: Record<string, string> = {};
      SEMANTIC_KEYS.forEach(k => { const v = semanticInputs[k] ?? ''; if (isValidHex(v)) validatedSemantics[k] = v; });
      const validatedLightSemantics: Record<string, string> = {};
      SEMANTIC_KEYS.forEach(k => { const v = lightSemanticInputs[k] ?? ''; if (isValidHex(v)) validatedLightSemantics[k] = v; });
      const stopsNum = (arr: string[]) => arr.map(s => clampPct(Number(s) || 0));
      const sc: Partial<StyleConfig> = {
        dark:  { gradient_enabled: darkGradEnabled,  gradient_opacity: clampPct(Number(darkStops[0]) || 0),  gradient_stops: stopsNum(darkStops),  card_alpha: clampPct(Number(darkCardAlpha) || 0),  bg_color: isValidHex(darkBg) ? darkBg.toUpperCase() : DEFAULT_BG.dark },
        light: { gradient_enabled: lightGradEnabled, gradient_opacity: clampPct(Number(lightStops[0]) || 0), gradient_stops: stopsNum(lightStops), card_alpha: clampPct(Number(lightCardAlpha) || 0), bg_color: isValidHex(lightBg) ? lightBg.toUpperCase() : DEFAULT_BG.light },
        font_family: fontFamily,
        font_import_url: fontImportUrl.trim(),
        app_name_font: appNameFont.trim(),
        custom_fonts: customFonts,
        custom_accents: validated,
        extra_presets: extraPresets,
        hidden_presets: hiddenPresets,
        preset_order: orderPresetIds([...THEME_PRESETS.map(p => p.id), ...extraPresets.map(p => p.id)], presetOrder),
        semantic_colors: validatedSemantics,
        light_semantic_colors: validatedLightSemantics,
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
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Ionicons name="chevron-back" size={22} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 4, fontSize: 14, fontWeight: '600' }}>Retour</Text>
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
              colors={curGradEnabled && curStops.some(s => s > 0)
                ? curStops.map(s => previewColors.emerald + toHex(s)) as any
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

              <Section label="Couleurs d'accentuation (presets)" icon="color-palette-outline" COLORS={COLORS}>
                <Text style={styles.hint}>Pastille = activer · code hex = modifier · œil = masquer · flèches = réordonner (l'ordre s'applique aussi dans Paramètres). Ajoutez vos propres presets en bas.</Text>
                <View style={{ gap: 10 }}>
                  {orderedPresetIds.map((id, idx) => {
                    const native = THEME_PRESETS.find(p => p.id === id);
                    const custom = extraPresets.find(p => p.id === id);
                    if (!native && !custom) return null;
                    const active = preset === id;
                    const hidden = hiddenPresets.includes(id);
                    const inputHex = native ? (accentInputs[id] ?? native.swatch) : (custom!.dark);
                    const valid = isValidHex(inputHex);
                    const col = valid ? inputHex : (native?.swatch ?? '#888');
                    return (
                      <View key={id} style={[styles.accentItem, active && { borderColor: col, borderWidth: 2 }, hidden && { opacity: 0.45 }]}>
                        <View style={styles.moveCol}>
                          <TouchableOpacity onPress={() => movePreset(id, -1)} disabled={idx === 0} hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}>
                            <Ionicons name="chevron-up" size={16} color={idx === 0 ? COLORS.cardBorder : COLORS.textSecondary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => movePreset(id, 1)} disabled={idx === orderedPresetIds.length - 1} hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}>
                            <Ionicons name="chevron-down" size={16} color={idx === orderedPresetIds.length - 1 ? COLORS.cardBorder : COLORS.textSecondary} />
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity style={[styles.swatch, { backgroundColor: col }]} onPress={() => setPreset(id)} activeOpacity={0.8}>
                          {active && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </TouchableOpacity>
                        <Text style={styles.accentLabel} numberOfLines={1}>
                          {native ? `${native.emoji} ${native.label}` : custom!.label}{hidden ? ' · masqué' : ''}
                        </Text>
                        <TextInput
                          style={[styles.hexInput, { width: 84 }, !valid && { borderColor: COLORS.danger }]}
                          value={inputHex}
                          onChangeText={v => native
                            ? setAccentInputs(prev => ({ ...prev, [id]: v }))
                            : setExtraPresets(prev => prev.map(x => x.id === id ? { ...x, dark: v.toUpperCase() } : x))}
                          placeholder="#RRGGBB" placeholderTextColor={COLORS.textSecondary}
                          maxLength={7} autoCapitalize="characters"
                        />
                        {native ? (
                          <TouchableOpacity
                            onPress={() => setHiddenPresets(prev => hidden ? prev.filter(x => x !== id) : [...prev, id])}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={hidden ? COLORS.textSecondary : COLORS.emerald} />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            onPress={() => { if (preset === id) setPreset('emerald'); setExtraPresets(prev => prev.filter(x => x.id !== id)); setPresetOrder(prev => prev.filter(x => x !== id)); }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close-circle" size={20} color={COLORS.danger} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}

                  {/* Créateur de preset d'accent */}
                  <View style={[styles.accentItem, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.textSecondary }}>+ Nouveau preset d'accent</Text>
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
                        const newId = 'custom_' + Date.now();
                        setExtraPresets(prev => [...prev, { id: newId, label: newLabel.trim(), dark: newDark.toUpperCase(), light: newLight.toUpperCase() }]);
                        setPresetOrder(prev => [...prev, newId]);
                        setNewLabel(''); setNewDark('#FFFFFF'); setNewLight('#000000');
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>+ Ajouter ce preset</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={[styles.hint, { marginTop: 10 }]}>Les presets sont disponibles pour tous les utilisateurs dans Paramètres.</Text>
              </Section>

              {/* Couleurs sémantiques — séparées par mode */}
              {(['dark', 'light'] as const).map((m) => {
                const isCurMode = previewMode === m;
                const inputs = m === 'dark' ? semanticInputs : lightSemanticInputs;
                const setInputs = m === 'dark' ? setSemanticInputs : setLightSemanticInputs;
                const defaults = m === 'dark' ? SEMANTIC_DEFAULTS : SEMANTIC_DEFAULTS_LIGHT;
                const modeLabel = m === 'dark' ? 'Sombre' : 'Clair';
                const modeIcon = m === 'dark' ? '🌙' : '☀️';
                return (
                  <Section key={m} label={`Couleurs principales — Thème ${modeLabel} ${modeIcon}`} icon="brush-outline" COLORS={COLORS}>
                    {!isCurMode && (
                      <Text style={[styles.hint, { color: COLORS.orange }]}>
                        Vous prévisualisez le thème {m === 'dark' ? 'Clair' : 'Sombre'} — passez en mode {modeLabel} (ci-dessus) pour voir ces couleurs en live.
                      </Text>
                    )}
                    <Text style={styles.hint}>
                      {m === 'dark'
                        ? 'Montants, boutons et libellés pour le thème sombre. Globaux à tous les utilisateurs.'
                        : 'Palette indépendante pour le thème clair — couleurs plus sombres pour le contraste sur fond pâle.'}
                    </Text>
                    <View style={{ gap: 10 }}>
                      {SEMANTIC_KEYS.map(k => {
                        const inputHex = inputs[k] ?? defaults[k];
                        const valid = isValidHex(inputHex);
                        const col = valid ? inputHex : defaults[k];
                        const isDefault = inputHex.toUpperCase() === defaults[k].toUpperCase();
                        return (
                          <View key={k} style={styles.accentItem}>
                            <View style={[styles.swatch, { backgroundColor: col }]} />
                            <Text style={styles.accentLabel}>{SEMANTIC_LABELS[k].emoji} {SEMANTIC_LABELS[k].label}</Text>
                            <TextInput
                              style={[styles.hexInput, { width: 84 }, !valid && { borderColor: COLORS.danger }]}
                              value={inputHex}
                              onChangeText={v => setInputs(prev => ({ ...prev, [k]: v }))}
                              placeholder="#RRGGBB" placeholderTextColor={COLORS.textSecondary}
                              maxLength={7} autoCapitalize="characters"
                            />
                            <TouchableOpacity
                              onPress={() => setInputs(prev => ({ ...prev, [k]: defaults[k] }))}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              disabled={isDefault}
                            >
                              <Ionicons name="refresh-outline" size={20} color={isDefault ? COLORS.cardBorder : COLORS.emerald} />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  </Section>
                );
              })}

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

              <Section label="Couleur de fond de l'app" icon="contrast-outline" COLORS={COLORS}>
                <Text style={styles.hint}>Couleur derrière le dégradé. {activeMode === 'dark' ? 'En sombre, un noir pur peut être adouci (ex. #0A0E14).' : ''}</Text>
                <View style={styles.accentItem}>
                  <View style={[styles.swatch, { backgroundColor: isValidHex(aBg) ? aBg : DEFAULT_BG[activeMode], borderWidth: 1, borderColor: COLORS.cardBorder }]} />
                  <Text style={styles.accentLabel}>Fond {activeMode === 'dark' ? 'sombre' : 'clair'}</Text>
                  <TextInput
                    style={[styles.hexInput, { width: 96 }, !isValidHex(aBg) && { borderColor: COLORS.danger }]}
                    value={aBg}
                    onChangeText={setBg}
                    placeholder="#RRGGBB" placeholderTextColor={COLORS.textSecondary}
                    maxLength={7} autoCapitalize="characters"
                  />
                  <TouchableOpacity onPress={() => setBg(DEFAULT_BG[activeMode])} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={aBg.toUpperCase() === DEFAULT_BG[activeMode]}>
                    <Ionicons name="refresh-outline" size={20} color={aBg.toUpperCase() === DEFAULT_BG[activeMode] ? COLORS.cardBorder : COLORS.emerald} />
                  </TouchableOpacity>
                </View>
                <View style={{ gap: 8 }}>
                  {/* Ligne 1 : fonds colorés/chauds */}
                  <View style={styles.alphaRow}>
                    {(activeMode === 'dark'
                      ? ['#000000', '#0A0E14', '#111418', '#16181C']
                      : ['#F4EFE6', '#FDF6EC', '#F0EBE3', '#EAE5DC']
                    ).map(hex => (
                      <TouchableOpacity key={hex} style={[styles.alphaSample, { backgroundColor: hex }, aBg.toUpperCase() === hex.toUpperCase() && { borderColor: COLORS.emerald }]} onPress={() => setBg(hex)}>
                        <Text style={{ color: activeMode === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)', fontSize: 9, fontWeight: '600' }}>{hex.slice(1)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* Ligne 2 : fonds neutres + blanc (mode clair seulement) */}
                  {activeMode === 'light' && (
                    <View style={styles.alphaRow}>
                      {['#F7F8FA', '#F2F3F5', '#EAECEF', '#FFFFFF'].map(hex => (
                        <TouchableOpacity key={hex} style={[styles.alphaSample, { backgroundColor: hex, borderWidth: 1, borderColor: hex === '#FFFFFF' ? COLORS.cardBorder : 'transparent' }, aBg.toUpperCase() === hex.toUpperCase() && { borderColor: COLORS.emerald }]} onPress={() => setBg(hex)}>
                          <Text style={{ color: 'rgba(0,0,0,0.5)', fontSize: 9, fontWeight: '600' }}>{hex === '#FFFFFF' ? 'blanc' : hex.slice(1)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </Section>

              <Section label="Dégradé de fond" icon="layers-outline" COLORS={COLORS}>
                <View style={styles.row2}>
                  <ModeBtn label="Activé" icon="eye-outline" active={aEnabled} accent={COLORS.emerald} COLORS={COLORS} onPress={() => setEnabled(true)} />
                  <ModeBtn label="Désactivé" icon="eye-off-outline" active={!aEnabled} accent={COLORS.danger} COLORS={COLORS} onPress={() => setEnabled(false)} />
                </View>
                {aEnabled && (
                  <>
                    <Text style={[styles.hint, { marginTop: 14 }]}>
                      Opacité de chaque palier (haut → bas). Ex : 30 · 18 · 10 · 5.
                    </Text>
                    {(['Palier 1 (haut)', 'Palier 2', 'Palier 3', 'Palier 4 (bas)'] as const).map((lbl, i) => (
                      <View key={i} style={styles.inputRow}>
                        <Text style={styles.inputLabel}>{lbl}</Text>
                        <PctInput value={aStops[i] ?? '0'} onChange={v => setStop(i, v)} COLORS={COLORS} />
                      </View>
                    ))}
                    {/* Barre de prévisualisation horizontale du dégradé */}
                    <LinearGradient
                      colors={aStops.map(s => previewColors.emerald + toHex(Math.min(100, Math.max(0, Number(s) || 0)) / 100)) as any}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={styles.gradBar}
                    />
                  </>
                )}
              </Section>

              <Section label="Transparence des cartes" icon="albums-outline" COLORS={COLORS}>
                <Text style={styles.hint}>0 % = opaque · plus le % monte, plus le fond transparaît.</Text>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Opacité des cartes (0-100 %)</Text>
                  <PctInput value={aAlpha} onChange={v => setAlpha(v)} COLORS={COLORS} />
                </View>
                <View style={styles.alphaRow}>
                  {(activeMode === 'dark' ? [0, 8, 15, 25] : [0, 70, 88, 100]).map(pct => {
                    // Mode clair : cartes blanches (blanc sur fond coloré) ; sombre : blanches translucides sur noir.
                    const bg = `rgba(255,255,255,${pct / 100})`;
                    return (
                      <TouchableOpacity key={pct} style={[styles.alphaSample, { backgroundColor: bg, borderWidth: 1, borderColor: COLORS.cardBorder }, Math.abs(Number(aAlpha || 0) - pct) < 2 && { borderColor: COLORS.emerald }]} onPress={() => setAlpha(String(pct))}>
                        <Text style={{ color: activeMode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', fontSize: 10, fontWeight: '600' }}>{pct}%</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>
            </>
          )}

          {/* ══════════ ONGLET POLICE ══════════ */}
          {tab === 'font' && (
            <>
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

            <Section label="Police personnalisée (nom de l'app)" icon="cloud-upload-outline" COLORS={COLORS}>
              <Text style={styles.hint}>
                Téléversez un fichier de police (.ttf / .otf / .woff / .woff2) — il est stocké sur Supabase. Renseignez ensuite le nom EXACT de la famille, puis « Appliquer ». Le nom de l'app utilisera cette police partout. (Web ; sur mobile : police système.)
              </Text>

              <TouchableOpacity
                style={[styles.uploadBtn, { borderColor: COLORS.emerald }, fontUploading && { opacity: 0.6 }]}
                onPress={uploadFont}
                disabled={fontUploading}
                activeOpacity={0.8}
              >
                {fontUploading ? <ActivityIndicator color={COLORS.emerald} /> : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.emerald} />}
                <Text style={[styles.uploadBtnText, { color: COLORS.emerald }]}>{fontUploading ? 'Téléversement…' : 'Téléverser un fichier de police'}</Text>
              </TouchableOpacity>
              {fontUploadMsg && <Text style={[styles.hint, { marginTop: 8, color: fontUploadMsg.includes('Échec') || fontUploadMsg.includes('non') ? '#f43f5e' : COLORS.emerald }]}>{fontUploadMsg}</Text>}

              {/* Liste déroulante : police du titre (système + intégrées + importées) */}
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Police du nom de l'app</Text>
              <TouchableOpacity style={styles.dropdownHeader} onPress={() => setFontDropdownOpen((o) => !o)} activeOpacity={0.8}>
                <Text style={{ flex: 1, color: COLORS.text, fontSize: 14, fontFamily: appNameFont === 'System' ? undefined : appNameFont }} numberOfLines={1}>
                  {appNameFont || 'Système'}
                </Text>
                <Ionicons name={fontDropdownOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {fontDropdownOpen && (
                <View style={styles.dropdownList}>
                  {titleFontOptions.map((opt) => {
                    const selected = opt.family === appNameFont;
                    return (
                      <View key={opt.family} style={styles.dropdownRow}>
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 }}
                          onPress={() => { setAppNameFont(opt.family); setFontDropdownOpen(false); }}
                          activeOpacity={0.7}
                        >
                          {selected ? <Ionicons name="checkmark" size={16} color={COLORS.emerald} /> : <View style={{ width: 16 }} />}
                          <Text style={{ flex: 1, color: selected ? COLORS.emerald : COLORS.text, fontSize: 14, fontFamily: opt.family === 'System' ? undefined : opt.family }} numberOfLines={1}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                        {opt.custom && (
                          <TouchableOpacity onPress={() => removeCustomFont(opt.family)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ paddingHorizontal: 6 }}>
                            <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Aperçu</Text>
              <Text style={{ fontSize: 30, color: COLORS.text, fontFamily: appNameFont === 'System' ? undefined : (appNameFont.trim() || undefined) }}>Relyka</Text>

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Avancé — importer via lien CSS (Google Fonts)</Text>
              <TextInput
                style={styles.textInput}
                value={fontImportUrl}
                onChangeText={setFontImportUrl}
                placeholder="https://fonts.googleapis.com/css2?family=Pacifico&display=swap"
                placeholderTextColor={COLORS.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.hint}>Optionnel : pour une police hébergée ailleurs. Ajoutez ensuite son nom de famille manuellement n'est pas nécessaire si vous téléversez le fichier.</Text>
            </Section>
            </>
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
  fieldLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600', marginBottom: 6 },
  textInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, borderStyle: 'dashed' as any },
  uploadBtnText: { fontSize: 13, fontWeight: '700' },
  dropdownHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  dropdownList: { marginTop: 4, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10 },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.cardBorder },

  accentItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 10 },
  moveCol: { width: 20, alignItems: 'center', justifyContent: 'center', marginRight: -2 },
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

  gradBar: { height: 40, borderRadius: 10, marginTop: 14, borderWidth: 1, borderColor: c.cardBorder },
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
