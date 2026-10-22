import { gardenFormStyles } from '../../../../lib/garden/legacyStyles';
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Platform, Alert } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../../hooks/data/useProfile';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { supabase } from '../../../../lib/platform/supabase';
import { useStyleConfig, useSaveStyleConfig, getGradientStops, orderPresetIds, type StyleConfig, type CustomPreset, type CustomFont, type ModeStyleConfig } from '../../../../hooks/theme/useStyleConfig';
import { THEME_PRESETS, THEME_MODES, buildColors, SEMANTIC_KEYS, SEMANTIC_DEFAULTS, SEMANTIC_DEFAULTS_LIGHT, SEMANTIC_LABELS, DEFAULT_BG, DEFAULT_INK, DEFAULT_CARD } from '../../../../theme/palette';
import type { ThemeMode, ThemePreset } from '../../../../theme/palette';
import ColorPickerModal from '../../../../components/ui/ColorPickerModal';
import GardenColorsEditor from '../../../../components/admin/GardenColorsEditor';
import { GOOGLE_FONTS, injectGoogleFonts } from '../../../../lib/platform/webFonts';
import { ensureNativeFonts, useNativeFontsVersion } from '../../../../lib/platform/nativeFonts';
import { GARDEN_FONTS as GF } from '../../../../lib/garden/fontFamilies';


const FONTS = [
  { id: 'System',           label: 'Système' },
  { id: 'Inter',            label: 'Inter' },
  { id: 'DM Sans',          label: 'DM Sans' },
  { id: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans' },
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

type FontOption = { family: string; label: string; custom?: boolean };

// Marqueur (web) : exclut ces éléments de la police globale → l'aperçu montre la police EN COURS de choix.
const FONT_PREVIEW_PROPS: any = Platform.OS === 'web' ? { dataSet: { fontpreview: '1' } } : {};

/**
 * Sélecteur de police RÉUTILISABLE (liste déroulante unique) — sert à la fois pour la police du
 * TEXTE de l'app et pour la police du NOM de l'app. Aperçu « Aa » rendu dans chaque police, coche
 * sur la sélection, corbeille sur les polices importées.
 */
function FontSelect({
  value, onChange, options, onRemoveCustom, COLORS, styles,
}: {
  value: string;
  onChange: (family: string) => void;
  options: FontOption[];
  onRemoveCustom?: (family: string) => void;
  COLORS: any;
  styles: any;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.family === value);
  const ff = (family: string) => (family === 'System' ? undefined : family);
  return (
    <View>
      <TouchableOpacity style={styles.dropdownHeader} onPress={() => setOpen((o) => !o)} activeOpacity={0.8}>
        <Text {...FONT_PREVIEW_PROPS} style={{ fontSize: 18, color: COLORS.text, width: 30, fontFamily: ff(value) }}>Aa</Text>
        <Text {...FONT_PREVIEW_PROPS} style={{ flex: 1, color: COLORS.text, fontSize: 14, fontFamily: ff(value) }} numberOfLines={1}>
          {current?.label ?? value ?? 'Système'}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
      </TouchableOpacity>
      {open && (
        <View style={styles.dropdownList}>
          {options.map((opt) => {
            const selected = opt.family === value;
            return (
              <View key={opt.family} style={styles.dropdownRow}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 }}
                  onPress={() => { onChange(opt.family); setOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text {...FONT_PREVIEW_PROPS} style={{ fontSize: 17, color: selected ? COLORS.emerald : COLORS.text, width: 28, fontFamily: ff(opt.family) }}>Aa</Text>
                  <Text {...FONT_PREVIEW_PROPS} style={{ flex: 1, color: selected ? COLORS.emerald : COLORS.text, fontSize: 14, fontFamily: ff(opt.family) }} numberOfLines={1}>
                    {opt.label}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={16} color={COLORS.emerald} />}
                </TouchableOpacity>
                {opt.custom && onRemoveCustom && (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la police" onPress={() => onRemoveCustom(opt.family)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ paddingHorizontal: 6 }}>
                    <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function isValidHex(v: string) { return /^#[0-9A-Fa-f]{6}$/.test(v); }
function clampPct(v: number) { return Math.min(100, Math.max(0, v)); }
function toHex(a: number) { return Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0').toUpperCase(); }
/** Mélange opaque base+overlay à alpha (0-1) — même calcul que HeaderWithProfile (aperçu fidèle). */
function blendHexPreview(base: string, overlay: string, alpha: number): string {
  const b = /^#[0-9A-Fa-f]{6}$/.test(base) ? base : '#000000';
  const o = /^#[0-9A-Fa-f]{6}$/.test(overlay) ? overlay : '#000000';
  const a = Math.min(1, Math.max(0, alpha));
  const mix = (i: number) => Math.round(parseInt(b.slice(i, i + 2), 16) * (1 - a) + parseInt(o.slice(i, i + 2), 16) * a).toString(16).padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/**
 * Ouvre le sélecteur de couleur natif du navigateur, positionné près de l'endroit cliqué.
 * Callback avec #RRGGBB. No-op sur natif.
 */
function openColorPicker(anchorX: number, anchorY: number, initial: string, onPick: (hex: string) => void) {
  if (typeof document === 'undefined') return;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = /^#[0-9A-Fa-f]{6}$/.test(initial) ? initial : '#000000';
  // Positionner l'input invisible là où l'utilisateur a cliqué → le picker s'ouvre à cet endroit.
  const wh = window.innerHeight;
  const top = anchorY + 40 < wh ? anchorY : Math.max(0, anchorY - 220);
  input.style.cssText = `position:fixed;left:${anchorX}px;top:${top}px;width:1px;height:1px;opacity:0;pointer-events:none;border:none;padding:0;`;
  document.body.appendChild(input);
  input.addEventListener('input', () => { onPick(input.value.toUpperCase()); });
  input.addEventListener('change', () => { onPick(input.value.toUpperCase()); document.body.removeChild(input); });
  input.addEventListener('blur', () => { try { document.body.removeChild(input); } catch {} });
  input.click();
}

type Tab = 'colors' | 'background' | 'font';

export default function StyleEditor() {
  const router = useRouter();
  const goBack = useNavBack();
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  // Sélecteur de couleur centré (natif + web) ouvert au clic sur une pastille.
  const [colorPicker, setColorPicker] = useState<{ value: string; onPick: (hex: string) => void } | null>(null);
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const { data: styleConfig, isError: styleReadFailed, refetch: refetchStyle } = useStyleConfig();
  const saveStyle = useSaveStyleConfig();

  const isAdmin = profile?.is_admin ?? false;

  const [tab, setTab] = useState<Tab>('background');
  const [previewMode, setPreviewMode] = useState<ThemeMode>('dark');
  const [activeMode, setActiveMode]   = useState<ThemeMode>('dark'); // mode édité (fond/cartes)
  const [preset, setPreset]   = useState<ThemePreset>('emerald');

  const [darkGradEnabled, setDarkGradEnabled]   = useState(true);
  const [darkStops,       setDarkStops]         = useState<string[]>(['30', '18', '10', '5']);
  const [darkCardAlpha,   setDarkCardAlpha]     = useState('8');
  const [darkHeaderAlpha,  setDarkHeaderAlpha]  = useState('0');
  const [darkBg,          setDarkBg]            = useState(DEFAULT_BG.dark);
  const [darkInk,         setDarkInk]           = useState(DEFAULT_INK.dark);
  const [darkCard,        setDarkCard]          = useState(DEFAULT_CARD.dark);
  const [lightGradEnabled, setLightGradEnabled] = useState(true);
  const [lightStops,       setLightStops]       = useState<string[]>(['20', '12', '7', '3']);
  const [lightCardAlpha,   setLightCardAlpha]   = useState('88');
  const [lightHeaderAlpha, setLightHeaderAlpha] = useState('0');
  const [lightBg,          setLightBg]          = useState(DEFAULT_BG.light);
  const [lightInk,         setLightInk]         = useState(DEFAULT_INK.light);
  const [lightCard,        setLightCard]        = useState(DEFAULT_CARD.light);

  const [fontFamily, setFontFamily] = useState('System');
  const [fontImportUrl, setFontImportUrl] = useState('');
  const [appNameFont, setAppNameFont] = useState('Arial Rounded MT Bold');
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [fontUploading, setFontUploading] = useState(false);
  const [fontUploadMsg, setFontUploadMsg] = useState<string | null>(null);
  const [accentInputs, setAccentInputs] = useState<Record<string, string>>({});
  const [semanticInputs, setSemanticInputs] = useState<Record<string, string>>({});
  const [lightSemanticInputs, setLightSemanticInputs] = useState<Record<string, string>>({});
  const [extraPresets, setExtraPresets] = useState<CustomPreset[]>([]);
  const [hiddenPresets, setHiddenPresets] = useState<string[]>([]);
  const [presetOrder, setPresetOrder] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newDark,  setNewDark]  = useState('#FFFFFF');
  const [newLight, setNewLight] = useState('#000000');

  // Couleurs du Jardin réglées par mode (saisies brutes ; seules les hex valides sont enregistrées).
  const [gardenInputs, setGardenInputs] = useState<Record<'light' | 'dark', Record<string, string>>>({ light: {}, dark: {} });
  // S'ouvre sur le mode affiché : on règle ce qu'on a sous les yeux.
  const [gardenGlow, setGardenGlow] = useState<Record<'light' | 'dark', Record<string, any>>>({ light: {}, dark: {} });
  const [gardenMode, setGardenMode] = useState<'light' | 'dark'>(COLORS.mode === 'dark' ? 'dark' : 'light');
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
      setDarkHeaderAlpha(String(styleConfig.dark.header_alpha ?? 0));
      setDarkBg(styleConfig.dark.bg_color ?? DEFAULT_BG.dark);
      setDarkInk(styleConfig.dark.ink_color ?? DEFAULT_INK.dark);
      setDarkCard(styleConfig.dark.card_color ?? DEFAULT_CARD.dark);
      setLightGradEnabled(styleConfig.light.gradient_enabled);
      setLightStops(toStopStrings(styleConfig.light, 20));
      setLightCardAlpha(String(styleConfig.light.card_alpha));
      setLightHeaderAlpha(String(styleConfig.light.header_alpha ?? 0));
      setLightBg(styleConfig.light.bg_color ?? DEFAULT_BG.light);
      setLightInk(styleConfig.light.ink_color ?? DEFAULT_INK.light);
      setLightCard(styleConfig.light.card_color ?? DEFAULT_CARD.light);
      setGardenGlow({ light: { ...(styleConfig.garden_glow?.light ?? {}) }, dark: { ...(styleConfig.garden_glow?.dark ?? {}) } });
      setGardenInputs({ light: { ...(styleConfig.garden?.light ?? {}) }, dark: { ...(styleConfig.garden?.dark ?? {}) } } as any);
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

  // Charge les polices Google connues (web) pour que les aperçus « Aa » du sélecteur soient fidèles.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    injectGoogleFonts('admin-google-fonts-preview', Object.keys(GOOGLE_FONTS));
  }, []);

  // Injecte les polices IMPORTÉES (téléversées) pour que leurs aperçus « Aa » s'affichent DANS l'admin
  // avant même l'enregistrement (FontApplier ne les charge qu'une fois la config sauvegardée).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const ID = 'admin-custom-fonts-preview';
    let el = document.getElementById(ID) as HTMLStyleElement | null;
    const valid = customFonts.filter((f) => f?.family && f?.url);
    if (valid.length === 0) { el?.remove(); return; }
    if (!el) { el = document.createElement('style'); el.id = ID; document.head.appendChild(el); }
    const fmt = (url: string) => /\.woff2(\?.*)?$/i.test(url) ? 'woff2' : /\.woff(\?.*)?$/i.test(url) ? 'woff' : /\.otf(\?.*)?$/i.test(url) ? 'opentype' : 'truetype';
    el.textContent = valid.map((f) => `@font-face { font-family: '${f.family}'; src: url('${f.url}') format('${fmt(f.url)}'); font-display: swap; }`).join('\n');
  }, [customFonts]);

  // NATIF — charge les polices IMPORTÉES (expo-font) pour que les aperçus s'affichent en direct.
  // (Les polices Google, sans fichier, ne peuvent pas s'afficher sur natif → repli système.)
  useNativeFontsVersion(); // re-render quand une police finit de charger
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const valid = customFonts.filter((f) => f?.family && f?.url);
    if (valid.length) ensureNativeFonts(valid as any);
  }, [customFonts]);

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
  const isNativeId = (x: string) => THEME_PRESETS.some((p) => p.id === x);
  const movePreset = (id: string, dir: -1 | 1) => {
    const ids = orderPresetIds(allPresetIds, presetOrder);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    // Réordonnancement UNIQUEMENT à l'intérieur d'un même groupe (natives entre elles, pack entre eux).
    if (isNativeId(ids[i]) !== isNativeId(ids[j])) return;
    const arr = [...ids];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setPresetOrder(arr);
  };

  const previewAlpha = previewMode === 'dark' ? Number(darkCardAlpha || 0) : Number(lightCardAlpha || 0);
  const previewBg = previewMode === 'dark' ? darkBg : lightBg;
  const previewInk = previewMode === 'dark' ? darkInk : lightInk;
  const previewCard = previewMode === 'dark' ? darkCard : lightCard;
  const previewColors = buildColors(previewMode, preset, { customAccents: liveAccents, extraPresets, cardAlpha: previewAlpha, semanticColors: liveSemantics, lightSemanticColors: liveLightSemantics, bgColor: previewBg, inkColor: previewInk, cardColor: previewCard });
  const curGradEnabled = previewMode === 'dark' ? darkGradEnabled : lightGradEnabled;
  const curStops = (previewMode === 'dark' ? darkStops : lightStops).map(s => Math.min(100, Math.max(0, Number(s) || 0)) / 100);
  // Fond de l'ENTÊTE tel qu'il sera rendu par HeaderWithProfile : baseline (haut du dégradé) + surplus
  // d'accent. On le reproduit ici pour que l'aperçu montre l'effet du réglage en direct (les 2 thèmes).
  const previewHeaderBg = (() => {
    const baseline = curGradEnabled ? (curStops[0] ?? 0) : 0;
    const extra = Math.min(100, Math.max(0, Number(previewMode === 'dark' ? darkHeaderAlpha : lightHeaderAlpha) || 0)) / 100;
    const a = Math.min(1, baseline + extra * (1 - baseline));
    return blendHexPreview(previewColors.bg, previewColors.emerald, a);
  })();

  // Getters/setters du mode édité (onglet Fond)
  const aEnabled = activeMode === 'dark' ? darkGradEnabled : lightGradEnabled;
  const aStops   = activeMode === 'dark' ? darkStops : lightStops;
  const aAlpha       = activeMode === 'dark' ? darkCardAlpha   : lightCardAlpha;
  const aHeaderAlpha = activeMode === 'dark' ? darkHeaderAlpha : lightHeaderAlpha;
  const aBg          = activeMode === 'dark' ? darkBg          : lightBg;
  const aCard        = activeMode === 'dark' ? darkCard        : lightCard;
  const setEnabled = (v: boolean) => activeMode === 'dark' ? setDarkGradEnabled(v) : setLightGradEnabled(v);
  const setStop    = (i: number, v: string) => {
    const setter = activeMode === 'dark' ? setDarkStops : setLightStops;
    setter(prev => prev.map((s, idx) => idx === i ? v : s));
  };
  const setAlpha       = (v: string) => activeMode === 'dark' ? setDarkCardAlpha(v)   : setLightCardAlpha(v);
  const setHeaderAlpha = (v: string) => activeMode === 'dark' ? setDarkHeaderAlpha(v) : setLightHeaderAlpha(v);
  const setBg          = (v: string) => activeMode === 'dark' ? setDarkBg(v)          : setLightBg(v);
  const setCard        = (v: string) => activeMode === 'dark' ? setDarkCard(v)        : setLightCard(v);

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

  // UNE SEULE liste de polices, partagée par les DEUX sélecteurs (texte de l'app + nom de l'app) :
  // système + polices intégrées + polices importées (téléversées). Dédoublonnée par famille.
  const allFontOptions: FontOption[] = useMemo(() => [
    { family: 'System', label: 'Système (défaut)' },
    { family: 'Arial Rounded MT Bold', label: 'Arial Rounded MT Bold' },
    ...FONTS.filter((f) => f.id !== 'System').map((f) => ({ family: f.id, label: f.label })),
    ...customFonts.map((cf) => ({ family: cf.family, label: `${cf.family} · importée`, custom: true })),
  ].filter((opt, i, arr) => arr.findIndex((o) => o.family === opt.family) === i), [customFonts]);

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
        garden_glow: gardenGlow,
        garden: {
          light: Object.fromEntries(Object.entries(gardenInputs.light).filter(([, v]) => isValidHex(v)).map(([k, v]) => [k, v.toUpperCase()])),
          dark: Object.fromEntries(Object.entries(gardenInputs.dark).filter(([, v]) => isValidHex(v)).map(([k, v]) => [k, v.toUpperCase()])),
        },
        dark:  { gradient_enabled: darkGradEnabled,  gradient_opacity: clampPct(Number(darkStops[0]) || 0),  gradient_stops: stopsNum(darkStops),  card_alpha: clampPct(Number(darkCardAlpha) || 0),  bg_color: isValidHex(darkBg)  ? darkBg.toUpperCase()  : DEFAULT_BG.dark,  ink_color: isValidHex(darkInk)  ? darkInk.toUpperCase()  : DEFAULT_INK.dark,  card_color: isValidHex(darkCard)  ? darkCard.toUpperCase()  : DEFAULT_CARD.dark,  header_alpha: clampPct(Number(darkHeaderAlpha)  || 0) },
        light: { gradient_enabled: lightGradEnabled, gradient_opacity: clampPct(Number(lightStops[0]) || 0), gradient_stops: stopsNum(lightStops), card_alpha: clampPct(Number(lightCardAlpha) || 0), bg_color: isValidHex(lightBg) ? lightBg.toUpperCase() : DEFAULT_BG.light, ink_color: isValidHex(lightInk) ? lightInk.toUpperCase() : DEFAULT_INK.light, card_color: isValidHex(lightCard) ? lightCard.toUpperCase() : DEFAULT_CARD.light, header_alpha: clampPct(Number(lightHeaderAlpha) || 0) },
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
    } catch (e) {
      // L'échec ne partait qu'en console : le bouton reprenait son libellé normal et rien ne
      // distinguait un thème publié d'un thème perdu.
      console.error(e);
      Alert.alert('Thème non enregistré', e instanceof Error ? e.message : 'Vérifie ta connexion, puis réessaie.');
    }
    finally { setSaving(false); }
  }

  /* ⚠️ NE JAMAIS OUVRIR L'ÉDITEUR SUR UNE LECTURE RATÉE. Les presets supplémentaires, les couleurs
     masquées, l'ordre des pastilles, les accents personnalisés et les polices importées sont des
     LISTES : l'enregistrement les remplace en bloc par l'état local. Or cet état local part de
     valeurs par défaut et n'est garni qu'une fois la configuration lue — ouvrir la page hors réseau
     puis appuyer sur « Enregistrer » effaçait donc tout le travail de personnalisation, pour tous
     les utilisateurs de l'app. */
  if (styleReadFailed) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Design System" onBack={goBack} />
          <Text style={styles.body}>
            Le thème actuel n'a pas pu être lu. L'éditeur reste fermé : l'ouvrir sur des valeurs par
            défaut ferait effacer les couleurs, presets et polices en place au premier enregistrement.
          </Text>
          <TouchableOpacity onPress={() => refetchStyle()} accessibilityRole="button" style={{ marginTop: 18, alignSelf: 'flex-start', backgroundColor: COLORS.emerald, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 }}>
            <Text style={{ fontFamily: GF.bodyHeavy, color: COLORS.onAccent, fontWeight: 'normal', fontSize: 14 }}>Réessayer</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Design System" onBack={goBack} /><Text style={styles.body}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'colors',     label: 'Couleurs',     icon: 'color-palette-outline' },
    { id: 'background', label: 'Couleurs du Jardin', icon: 'leaf-outline' },
    { id: 'font',       label: 'Police',       icon: 'text-outline' },
  ];

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <ScreenHeader title="Design System" onBack={goBack} />
          <Text style={styles.headerSub}>Identité visuelle de l'app</Text>
        </View>

        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

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
                <Text style={styles.hint}>Ligne = activer · pastille = choisir la couleur · code hex = modifier · œil = masquer · flèches = réordonner. Ajoutez vos propres presets en bas.</Text>
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
                    // Titre « Pack couleurs » inséré devant le premier preset du pack (non natif).
                    const isFirstPack = !native && orderedPresetIds.findIndex(x => !THEME_PRESETS.some(p => p.id === x)) === idx;
                    // Bord de groupe : on ne peut monter/descendre que si le voisin est du MÊME groupe.
                    const canUp = idx > 0 && isNativeId(orderedPresetIds[idx - 1]) === !!native;
                    const canDown = idx < orderedPresetIds.length - 1 && isNativeId(orderedPresetIds[idx + 1]) === !!native;
                    return (
                      <React.Fragment key={id}>
                      {isFirstPack && <Text style={styles.packHeader}>Pack couleurs · teintes secondaires</Text>}
                      <View style={[styles.accentItem, active && { borderColor: col, borderWidth: 2 }, hidden && { opacity: 0.45 }]}>
                        <View style={styles.moveCol}>
                          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Monter la teinte" onPress={() => movePreset(id, -1)} disabled={!canUp} hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}>
                            <Ionicons name="chevron-up" size={16} color={!canUp ? COLORS.cardBorder : COLORS.textSecondary} />
                          </TouchableOpacity>
                          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Descendre la teinte" onPress={() => movePreset(id, 1)} disabled={!canDown} hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}>
                            <Ionicons name="chevron-down" size={16} color={!canDown ? COLORS.cardBorder : COLORS.textSecondary} />
                          </TouchableOpacity>
                        </View>
                        {/* Pastille = ouvrir le sélecteur de couleur */}
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choisir la couleur"
                          accessibilityState={{ selected: active }}
                          style={[styles.swatch, { backgroundColor: col }]}
                          onPress={() => setColorPicker({ value: col, onPick: v => native
                            ? setAccentInputs(prev => ({ ...prev, [id]: v }))
                            : setExtraPresets(prev => prev.map(x => x.id === id ? { ...x, dark: v } : x)) })}
                          activeOpacity={0.8}
                        >
                          {active && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </TouchableOpacity>
                        {/* Ligne (label) = activer ce preset */}
                        <TouchableOpacity style={{ flex: 1 }} onPress={() => setPreset(id)} activeOpacity={0.7}>
                          <Text style={styles.accentLabel} numberOfLines={1}>
                            {native ? `${native.emoji} ${native.label}` : custom!.label}{hidden ? ' · masqué' : ''}
                          </Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.hexInput, { width: 84 }, !valid && { borderColor: COLORS.danger }]}
                          value={inputHex}
                          onChangeText={v => native
                            ? setAccentInputs(prev => ({ ...prev, [id]: v }))
                            : setExtraPresets(prev => prev.map(x => x.id === id ? { ...x, dark: v.toUpperCase() } : x))}
                          placeholder="#RRGGBB" placeholderTextColor={COLORS.textSecondary}
                          maxLength={7} autoCapitalize="characters"
                        />
                        {/* Masquer (œil) — pour TOUS les presets (natifs et pack) */}
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel={hidden ? 'Afficher la teinte' : 'Masquer la teinte'}
                          onPress={() => setHiddenPresets(prev => hidden ? prev.filter(x => x !== id) : [...prev, id])}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={hidden ? COLORS.textSecondary : COLORS.emerald} />
                        </TouchableOpacity>
                        {/* Supprimer (✕) — uniquement les presets du Pack (les natifs ne se suppriment pas) */}
                        {!native && (
                          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la teinte"
                            onPress={() => { if (preset === id) setPreset('emerald'); setExtraPresets(prev => prev.filter(x => x.id !== id)); setPresetOrder(prev => prev.filter(x => x !== id)); }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close-circle" size={20} color={COLORS.danger} />
                          </TouchableOpacity>
                        )}
                      </View>
                      </React.Fragment>
                    );
                  })}

                  {/* Créateur de preset d'accent */}
                  <View style={[styles.accentItem, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                    <Text style={{ fontFamily: GF.bodyBold, fontSize: 12, fontWeight: 'normal', color: COLORS.textSecondary }}>+ Nouveau preset d'accent</Text>
                    <TextInput style={[styles.hexInput, { textAlign: 'left', paddingLeft: 10 }]} value={newLabel} onChangeText={setNewLabel}
                      placeholder="Nom (ex. Turquoise)" placeholderTextColor={COLORS.textSecondary} />
                    <View style={styles.row2g}>
                      <TouchableOpacity style={[styles.swatch, { backgroundColor: isValidHex(newDark) ? newDark : '#888' }]} onPress={() => setColorPicker({ value: isValidHex(newDark) ? newDark : '#000000', onPick: setNewDark })} activeOpacity={0.8} />
                      <TextInput style={[styles.hexInput, { flex: 1 }]} value={newDark} onChangeText={setNewDark} placeholder="#RRGGBB (couleur)" placeholderTextColor={COLORS.textSecondary} maxLength={7} autoCapitalize="characters" />
                    </View>
                    <TouchableOpacity
                      style={{ backgroundColor: (newLabel.trim() && isValidHex(newDark)) ? COLORS.emerald : COLORS.cardBorder, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                      onPress={() => {
                        if (!newLabel.trim() || !isValidHex(newDark)) return;
                        const newId = 'custom_' + Date.now();
                        // Couleur unique : on stocke la même teinte en dark ET light (identique clair/sombre).
                        const hex = newDark.toUpperCase();
                        setExtraPresets(prev => [...prev, { id: newId, label: newLabel.trim(), dark: hex, light: hex }]);
                        setPresetOrder(prev => [...prev, newId]);
                        setNewLabel(''); setNewDark('#FFFFFF'); setNewLight('#000000');
                      }}
                    >
                      <Text style={{ fontFamily: GF.bodyBold, color: '#fff', fontWeight: 'normal', fontSize: 14 }}>+ Ajouter ce preset</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={[styles.hint, { marginTop: 10 }]}>Les presets sont disponibles pour tous les utilisateurs dans Paramètres.</Text>
              </Section>

            </>
          )}

          {/* ══════════ ONGLET FOND & CARTES ══════════ */}
          {tab === 'background' && (
            <>
              <GardenColorsEditor mode={gardenMode} onModeChange={setGardenMode} value={gardenInputs} onChange={setGardenInputs} glowValue={gardenGlow} onGlowChange={setGardenGlow}
                onPickColor={(initial, onPick) => setColorPicker({ value: initial, onPick })} />
            </>
          )}

          {/* ══════════ ONGLET POLICE ══════════ */}
          {tab === 'font' && (
            <>
            <Section label="Polices" icon="text-outline" COLORS={COLORS}>
              <Text style={styles.hint}>
                Le texte de l'app utilise les polices du Jardin (Nunito, Fredoka pour les titres). Seul le
                NOM de l'app se choisit ici, parmi les polices intégrées ou celles que tu importes ci-dessous.
              </Text>

              {/* Sélecteur 2 — police du NOM de l'app (même liste) */}
              <Text style={styles.fieldLabel}>Police du nom de l'app</Text>
              <FontSelect
                value={appNameFont}
                onChange={setAppNameFont}
                options={allFontOptions}
                onRemoveCustom={removeCustomFont}
                COLORS={COLORS}
                styles={styles}
              />
              <View style={styles.fontPreviewBox}>
                <Text {...FONT_PREVIEW_PROPS} style={{ fontSize: 30, color: COLORS.text, fontFamily: appNameFont === 'System' ? undefined : (appNameFont.trim() || undefined) }}>Relyka</Text>
              </View>
            </Section>

            <Section label="Importer une police" icon="cloud-upload-outline" COLORS={COLORS}>
              <Text style={styles.hint}>
                Téléverse un fichier (.ttf / .otf / .woff / .woff2) : il rejoint automatiquement la liste
                ci-dessus et devient utilisable pour le texte ET le nom de l'app. (Web ; sur mobile : police système.)
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
              <Text style={styles.hint}>Optionnel : pour une police hébergée ailleurs.</Text>
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
            Mode et couleur d'accent : choisis par chacun dans Apparence.{'\n'}
            Couleurs du Jardin, presets et police du nom : globaux, pour tous.
          </Text>
        </KeyboardAwareScrollView>
      </SafeAreaView>

      <ColorPickerModal
        visible={!!colorPicker}
        value={colorPicker?.value ?? '#000000'}
        onPick={(hex) => colorPicker?.onPick(hex)}
        onClose={() => setColorPicker(null)}
      />
    </View>
  );
}

// ── Sous-composants ──
function Section({ label, icon, COLORS, children }: { label: string; icon: string; COLORS: any; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 26 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Ionicons name={icon as any} size={15} color={COLORS.emerald} />
        <Text style={{ fontFamily: GF.bodyBold, fontSize: 11, fontWeight: 'normal', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
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
      <Text style={{ fontFamily: GF.bodyBold, fontSize: 13, fontWeight: 'normal', color: active ? accent : COLORS.textSecondary }}>{label}</Text>
    </TouchableOpacity>
  );
}

function PctInput({ value, onChange, COLORS }: { value: string; onChange: (v: string) => void; COLORS: any }) {
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  return (
    <View style={styles.pctWrap}>
      <TextInput style={styles.pctInput} value={value} onChangeText={v => onChange(v.replace(/[^0-9]/g, '').slice(0, 3))} keyboardType="number-pad" maxLength={3} />
      <Text style={styles.pctUnit}>%</Text>
    </View>
  );
}

function makeStyles(c: any) {
  const base = makeBaseStyles(c);
  return gardenFormStyles(base);
}

function makeBaseStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  headerSub: { fontFamily: GF.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 100 },

  preview: { borderRadius: 20, overflow: 'hidden', height: 170, padding: 14, marginBottom: 20, justifyContent: 'space-between', borderWidth: 1, borderColor: c.cardBorder },
  previewHeaderBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -14, marginTop: -14, paddingHorizontal: 14, paddingVertical: 10 },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLabel: { fontFamily: GF.bodyBold, fontSize: 10, fontWeight: 'normal', letterSpacing: 0.8 },
  previewModeSwitcher: { flexDirection: 'row', gap: 4 },
  previewModeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  previewCards: { flexDirection: 'row', gap: 8 },
  previewCard: { flex: 1, borderRadius: 10, padding: 8, gap: 3, borderWidth: 1, borderLeftWidth: 3 },
  previewCardLabel: { fontFamily: GF.body, fontSize: 9 },
  previewCardAmount: { fontFamily: GF.bodyBold, fontSize: 13, fontWeight: 'normal' },

  tabBar: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: c.cardBorder, backgroundColor: c.card },
  tabBtnText: { fontFamily: GF.bodyBold, fontSize: 11, fontWeight: 'normal' },

  row2: { flexDirection: 'row', gap: 10 },
  row2g: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  hint: { fontFamily: GF.body, fontSize: 12, color: c.textSecondary, marginBottom: 12, lineHeight: 17 },
  packHeader: { fontFamily: GF.bodyHeavy, fontSize: 13, fontWeight: 'normal', color: c.text, marginTop: 14, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabel: { fontFamily: GF.bodyBold, fontSize: 12, color: c.textSecondary, fontWeight: 'normal', marginBottom: 6 },
  textInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, borderStyle: 'dashed' as any },
  uploadBtnText: { fontFamily: GF.bodyBold, fontSize: 13, fontWeight: 'normal' },
  dropdownHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  dropdownList: { marginTop: 4, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10 },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.cardBorder },

  accentItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 10 },
  moveCol: { width: 20, alignItems: 'center', justifyContent: 'center', marginRight: -2 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  accentLabel: { fontFamily: GF.body, flex: 1, fontSize: 14, color: c.text, fontWeight: 'normal' },
  hexInput: { width: 96, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, color: c.text, fontSize: 13, fontWeight: '600', textAlign: 'center', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },

  modeTabs: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  modeTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
  modeTabText: { fontFamily: GF.bodyBold, fontSize: 12, fontWeight: 'normal' },

  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  inputLabel: { fontFamily: GF.body, fontSize: 13, color: c.textSecondary, flex: 1 },
  pctWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pctInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: c.text, fontSize: 18, fontWeight: '700', width: 72, textAlign: 'center', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  pctUnit: { fontFamily: GF.bodyBold, fontSize: 16, color: c.textSecondary, fontWeight: 'normal' },

  gradBar: { height: 40, borderRadius: 10, marginTop: 14, borderWidth: 1, borderColor: c.cardBorder },
  alphaRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  alphaSample: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },

  fontPreviewBox: { marginTop: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
  fontGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fontBtn: { width: '30%', borderRadius: 12, padding: 12, borderWidth: 1.5, borderColor: c.cardBorder, backgroundColor: c.card, alignItems: 'center', gap: 4, position: 'relative' },
  fontSample: { fontFamily: GF.bodyBold, fontSize: 22, fontWeight: 'normal', color: c.text },
  fontLabel: { fontFamily: GF.bodyBold, fontSize: 10, color: c.textSecondary, fontWeight: 'normal', textAlign: 'center' },
  fontCheck: { position: 'absolute', top: 5, right: 5, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 12, paddingVertical: 16, marginTop: 8, marginBottom: 16 },
  saveBtnLabel: { fontFamily: GF.bodyBold, fontSize: 16, fontWeight: 'normal', color: '#fff' },
  footnote: { fontFamily: GF.body, fontSize: 11, color: c.textSecondary, textAlign: 'center', lineHeight: 16 },
  body: { color: c.text, padding: 20 },
});
}
