/**
 * ColorPickerModal — sélecteur de couleur manuel (natif + web), affiché au centre de l'écran.
 * Aperçu + saisie hex + palette de teintes à toucher. Utilisé par le Style Editor (admin)
 * pour modifier une couleur en cliquant directement sur la pastille.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';

const isValidHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);

/** Palette : 8 teintes × 5 niveaux + niveaux de gris. */
const HUES = ['#F43F5E', '#F97316', '#FACC15', '#22C55E', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899'];
function ramp(hex: string): string[] {
  // Variantes claires → foncées d'une teinte (mélange vers blanc puis noir).
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const mix = (t: number, toWhite: boolean) => {
    const tgt = toWhite ? 255 : 0;
    const c = (x: number) => Math.round(x * (1 - t) + tgt * t).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  };
  return [mix(0.55, true), mix(0.28, true), hex, mix(0.28, false), mix(0.5, false)];
}
const GREYS = ['#FFFFFF', '#D1D5DB', '#9CA3AF', '#6B7280', '#374151', '#111827'];

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
  const [hex, setHex] = useState(value);

  useEffect(() => { if (visible) setHex(value); }, [visible, value]);

  const valid = isValidHex(hex);
  const choose = (c: string) => { setHex(c.toUpperCase()); };
  const confirm = () => { if (valid) { onPick(hex.toUpperCase()); onClose(); } };

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

          {/* Aperçu + hex */}
          <View style={styles.previewRow}>
            <View style={[styles.preview, { backgroundColor: valid ? hex : '#888' }]} />
            <TextInput
              style={[styles.hexInput, !valid && { borderColor: COLORS.danger }]}
              value={hex}
              onChangeText={(v) => setHex(v.toUpperCase())}
              placeholder="#RRGGBB"
              placeholderTextColor={COLORS.textSecondary}
              autoCapitalize="characters"
              maxLength={7}
            />
          </View>

          {/* Palette teintes */}
          {HUES.map((h) => (
            <View key={h} style={styles.swatchRow}>
              {ramp(h).map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.swatch, { backgroundColor: c }, hex.toUpperCase() === c.toUpperCase() && styles.swatchActive]}
                  onPress={() => choose(c)}
                />
              ))}
            </View>
          ))}
          {/* Gris */}
          <View style={styles.swatchRow}>
            {GREYS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.swatch, { backgroundColor: c, borderWidth: c === '#FFFFFF' ? 1 : 0, borderColor: COLORS.cardBorder }, hex.toUpperCase() === c.toUpperCase() && styles.swatchActive]}
                onPress={() => choose(c)}
              />
            ))}
          </View>

          <TouchableOpacity style={[styles.confirmBtn, !valid && { opacity: 0.5 }]} onPress={confirm} disabled={!valid} activeOpacity={0.85}>
            <Text style={styles.confirmText}>Valider</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    // Centré, légèrement au-dessus du milieu (paddingBottom plus grand pousse la carte vers le haut).
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24, paddingBottom: 120 },
    card: { width: '100%', maxWidth: 340, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 10 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
    preview: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
    hexInput: { flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 15, fontWeight: '700', letterSpacing: 1, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    swatchRow: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    swatch: { flex: 1, aspectRatio: 1, borderRadius: 8, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    swatchActive: { borderWidth: 3, borderColor: c.text },
    confirmBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
    confirmText: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
