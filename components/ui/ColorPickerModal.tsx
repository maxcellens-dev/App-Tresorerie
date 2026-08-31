/**
 * ColorPickerModal — sélecteur de couleur HSV (carré saturation/luminosité + barre de teinte),
 * affiché au centre de l'écran. Natif + web. Saisie hex synchronisée.
 * Utilisé par le Style Editor : clic sur une pastille → ouvre ce sélecteur.
 */
import { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Platform, PanResponder, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';

/* Dimensions MAXIMALES du sélecteur. La largeur réelle est calculée à partir de l'écran (cf.
   `svW` plus bas) : figées, ces valeurs faisaient déborder le carré et la barre de teinte hors de
   la fenêtre sur les petits téléphones (≈320 px de large) — la barre de teinte se retrouvait
   partiellement hors écran, donc impossible à attraper du pouce. */
const SV_W_MAX = 248, SV_H_MAX = 188, HUE_W = 26;
/** Marges à retrancher : padding de l'overlay (24×2), padding de la carte (18×2), écart (12). */
const CARD_MAX = 340, OVERLAY_PAD = 24, CARD_PAD = 18, GAP = 12;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const isValidHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);

// ── Conversions ──
function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
function rgbToHex(r: number, g: number, b: number) {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
function hexToHsv(hex: string) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
const hsvToHex = (h: number, s: number, v: number) => { const { r, g, b } = hsvToRgb(h, s, v); return rgbToHex(r, g, b); };

export default function ColorPickerModal({
  visible, value, onPick, onClose,
}: {
  visible: boolean;
  value: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { width: winW, height: winH } = useWindowDimensions();
  // Le sélecteur s'adapte à la place réellement disponible, sans jamais dépasser sa taille de confort.
  const svW = Math.max(140, Math.min(SV_W_MAX, Math.min(CARD_MAX, winW - OVERLAY_PAD * 2) - CARD_PAD * 2 - HUE_W - GAP));
  const svH = Math.max(120, Math.min(SV_H_MAX, winH - 360));
  /* Les gestes sont créés UNE fois (useRef) : ils ne verraient jamais un changement de taille.
     On leur donne donc les dimensions courantes par référence — sinon une rotation d'écran
     désalignerait le doigt et le curseur. */
  const dims = useRef({ w: svW, h: svH });
  dims.current = { w: svW, h: svH };
  const [h, setH] = useState(0);
  const [s, setS] = useState(1);
  const [v, setV] = useState(1);
  const [hexInput, setHexInput] = useState(value);

  // Init à l'ouverture.
  useEffect(() => {
    if (!visible) return;
    const init = isValidHex(value) ? value : '#FF0000';
    const hsv = hexToHsv(init);
    setH(hsv.h); setS(hsv.s); setV(hsv.v); setHexInput(init.toUpperCase());
  }, [visible, value]);

  const hex = hsvToHex(h, s, v);
  // Saisie RVB (0-255 par canal) — champs synchronisés avec les curseurs, comme le hex.
  const [rgbInput, setRgbInput] = useState({ r: '255', g: '0', b: '0' });
  // Synchronise les champs hex + RVB quand on bouge les curseurs.
  useEffect(() => {
    setHexInput(hex);
    const q = hsvToRgb(h, s, v);
    setRgbInput({ r: String(q.r), g: String(q.g), b: String(q.b) });
    /* eslint-disable-next-line */
  }, [h, s, v]);

  const onHexChange = (t: string) => {
    const up = t.toUpperCase();
    setHexInput(up);
    if (isValidHex(up)) { const hsv = hexToHsv(up); setH(hsv.h); setS(hsv.s); setV(hsv.v); }
  };

  const onRgbChange = (ch: 'r' | 'g' | 'b', t: string) => {
    const digits = t.replace(/[^0-9]/g, '').slice(0, 3);
    const next = { ...rgbInput, [ch]: digits };
    setRgbInput(next);
    if (digits === '') return; // canal en cours d'effacement → on attend une valeur
    const cur = hsvToRgb(h, s, v);
    const val = (x: string, fallback: number) => (x === '' ? fallback : clamp(parseInt(x, 10), 0, 255));
    const hsv = hexToHsv(rgbToHex(val(next.r, cur.r), val(next.g, cur.g), val(next.b, cur.b)));
    setH(hsv.h); setS(hsv.s); setV(hsv.v);
  };

  // Glissement sur le carré saturation/luminosité.
  const svPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => updateSV(e.nativeEvent.locationX, e.nativeEvent.locationY),
    onPanResponderMove: (e) => updateSV(e.nativeEvent.locationX, e.nativeEvent.locationY),
  })).current;
  const updateSV = (x: number, y: number) => {
    setS(clamp(x, 0, dims.current.w) / dims.current.w);
    setV(1 - clamp(y, 0, dims.current.h) / dims.current.h);
  };

  // Glissement sur la barre de teinte.
  const huePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setH(clamp(e.nativeEvent.locationY, 0, dims.current.h) / dims.current.h * 360),
    onPanResponderMove: (e) => setH(clamp(e.nativeEvent.locationY, 0, dims.current.h) / dims.current.h * 360),
  })).current;

  const hueColor = hsvToHex(h, 1, 1);
  const confirm = () => { onPick(hex); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAwareOverlay style={styles.overlay} onBackdropPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Choisir une couleur</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Carré SV + barre de teinte */}
          <View style={styles.pickerRow}>
            <View style={[styles.svBox, { width: svW, height: svH }]} {...svPan.panHandlers}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: hueColor, borderRadius: 10 }]} />
              <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
              <LinearGradient colors={['rgba(0,0,0,0)', '#000000']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
              <View pointerEvents="none" style={[styles.svThumb, { left: s * svW - 8, top: (1 - v) * svH - 8 }]} />
            </View>
            <View style={[styles.hueBox, { height: svH }]} {...huePan.panHandlers}>
              <LinearGradient
                colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']}
                style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
              />
              <View pointerEvents="none" style={[styles.hueThumb, { top: (h / 360) * svH - 3 }]} />
            </View>
          </View>

          {/* Aperçu + hex */}
          <View style={styles.previewRow}>
            <View style={[styles.preview, { backgroundColor: hex }]} />
            <TextInput
              style={styles.hexInput}
              value={hexInput}
              onChangeText={onHexChange}
              placeholder="#RRGGBB"
              placeholderTextColor={COLORS.textSecondary}
              autoCapitalize="characters"
              maxLength={7}
            />
          </View>

          {/* Saisie RVB (0-255) — synchronisée avec la palette et le hex */}
          <View style={styles.rgbRow}>
            {(['r', 'g', 'b'] as const).map((ch, i) => (
              <View key={ch} style={styles.rgbField}>
                <Text style={styles.rgbLabel}>{['R', 'V', 'B'][i]}</Text>
                <TextInput
                  style={styles.rgbInput}
                  value={rgbInput[ch]}
                  onChangeText={(t) => onRgbChange(ch, t)}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="0"
                  placeholderTextColor={COLORS.textSecondary}
                  selectTextOnFocus
                />
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.confirmBtn} onPress={confirm} activeOpacity={0.85}>
            <Text style={styles.confirmText}>Valider</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAwareOverlay>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24, paddingBottom: 90 },
    card: { width: '100%', maxWidth: CARD_MAX, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: CARD_PAD, gap: 14 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    pickerRow: { flexDirection: 'row', gap: GAP, alignSelf: 'center' },
    svBox: { borderRadius: 10 },
    svThumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: 'transparent', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2 },
    hueBox: { width: HUE_W, borderRadius: 8 },
    hueThumb: { position: 'absolute', left: -2, right: -2, height: 6, borderRadius: 3, borderWidth: 2, borderColor: '#fff', backgroundColor: 'transparent' },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    preview: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
    rgbRow: { flexDirection: 'row', gap: 10 },
    // Chaque canal = un encadré compact [label | valeur] : le label vit DANS l'encadré (pas de
    // label flottant qui se fait recouvrir quand la place manque).
    rgbField: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10 },
    rgbLabel: { fontSize: 13, fontWeight: '800', color: c.textSecondary, marginRight: 6 },
    rgbInput: { flex: 1, minWidth: 0, paddingVertical: 9, color: c.text, fontSize: 14, fontWeight: '700', textAlign: 'center', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    hexInput: { flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 15, fontWeight: '700', letterSpacing: 1, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    confirmBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    // `onAccent` : lisible même quand l'accent courant est une teinte claire (cf. AppColors).
    confirmText: { fontSize: 15, fontWeight: '800', color: c.onAccent },
  });
}
