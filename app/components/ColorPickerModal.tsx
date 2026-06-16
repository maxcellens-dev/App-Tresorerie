/**
 * ColorPickerModal — sélecteur de couleur HSV (carré saturation/luminosité + barre de teinte),
 * affiché au centre de l'écran. Natif + web. Saisie hex synchronisée.
 * Utilisé par le Style Editor : clic sur une pastille → ouvre ce sélecteur.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Platform, PanResponder } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';

const SV_W = 248, SV_H = 188, HUE_W = 26;
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
  const styles = makeStyles(COLORS);
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
  // Synchronise le champ hex quand on bouge les curseurs.
  useEffect(() => { setHexInput(hex); /* eslint-disable-next-line */ }, [h, s, v]);

  const onHexChange = (t: string) => {
    const up = t.toUpperCase();
    setHexInput(up);
    if (isValidHex(up)) { const hsv = hexToHsv(up); setH(hsv.h); setS(hsv.s); setV(hsv.v); }
  };

  // Glissement sur le carré saturation/luminosité.
  const svPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => updateSV(e.nativeEvent.locationX, e.nativeEvent.locationY),
    onPanResponderMove: (e) => updateSV(e.nativeEvent.locationX, e.nativeEvent.locationY),
  })).current;
  const updateSV = (x: number, y: number) => {
    setS(clamp(x, 0, SV_W) / SV_W);
    setV(1 - clamp(y, 0, SV_H) / SV_H);
  };

  // Glissement sur la barre de teinte.
  const huePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setH(clamp(e.nativeEvent.locationY, 0, SV_H) / SV_H * 360),
    onPanResponderMove: (e) => setH(clamp(e.nativeEvent.locationY, 0, SV_H) / SV_H * 360),
  })).current;

  const hueColor = hsvToHex(h, 1, 1);
  const confirm = () => { onPick(hex); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Choisir une couleur</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Carré SV + barre de teinte */}
          <View style={styles.pickerRow}>
            <View style={styles.svBox} {...svPan.panHandlers}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: hueColor, borderRadius: 10 }]} />
              <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
              <LinearGradient colors={['rgba(0,0,0,0)', '#000000']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
              <View pointerEvents="none" style={[styles.svThumb, { left: s * SV_W - 8, top: (1 - v) * SV_H - 8 }]} />
            </View>
            <View style={styles.hueBox} {...huePan.panHandlers}>
              <LinearGradient
                colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']}
                style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
              />
              <View pointerEvents="none" style={[styles.hueThumb, { top: (h / 360) * SV_H - 3 }]} />
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

          <TouchableOpacity style={styles.confirmBtn} onPress={confirm} activeOpacity={0.85}>
            <Text style={styles.confirmText}>Valider</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24, paddingBottom: 90 },
    card: { width: '100%', maxWidth: 340, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 14 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    pickerRow: { flexDirection: 'row', gap: 12, alignSelf: 'center' },
    svBox: { width: SV_W, height: SV_H, borderRadius: 10 },
    svThumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: 'transparent', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2 },
    hueBox: { width: HUE_W, height: SV_H, borderRadius: 8 },
    hueThumb: { position: 'absolute', left: -2, right: -2, height: 6, borderRadius: 3, borderWidth: 2, borderColor: '#fff', backgroundColor: 'transparent' },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    preview: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
    hexInput: { flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 15, fontWeight: '700', letterSpacing: 1, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    confirmBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    confirmText: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
