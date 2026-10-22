/**
 * Pavé numérique de la saisie rapide : le montant se TAPE, sans clavier système (qui cache la moitié
 * de l'écran et change d'un téléphone à l'autre). Sur le web, le clavier physique marche aussi.
 *
 * Le montant est gardé en texte (« 12,5 ») : deux décimales au plus, pas de zéro en tête.
 */
import { useEffect } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenText from '../garden/GardenText';
import { GARDEN_COLORS, GARDEN_RADII } from '../../lib/garden/theme';
import { pointer } from '../../lib/ui/webLayout';

/** Applique une touche au montant en cours. Pure (testée). */
export function pressKey(value: string, key: string): string {
  if (key === 'back') return value.slice(0, -1);
  if (key === ',') return value.includes(',') ? value : (value || '0') + ',';
  if (!/^\d$/.test(key)) return value;
  const [int, dec] = value.split(',');
  if (dec != null) return dec.length >= 2 ? value : value + key;
  if (int.length >= 7) return value;
  return int === '0' ? key : value + key;
}

/** « 12,5 » → 12.5 ; vide → 0. */
export const keypadNumber = (value: string) => parseFloat((value || '0').replace(',', '.')) || 0;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'];

/** `active` : ce pavé reçoit le clavier physique (web). Un seul à la fois — celui d'une feuille
 *  ouverte par-dessus, pas celui de l'écran dessous. */
export default function AmountKeypad({ value, onChange, onEnter, active = true }: { value: string; onChange: (v: string) => void; onEnter?: () => void; active?: boolean }) {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key === 'Backspace' ? 'back' : e.key === '.' ? ',' : e.key;
      if (e.key === 'Enter') { onEnter?.(); return; }
      if (k === 'back' || k === ',' || /^\d$/.test(k)) { e.preventDefault(); onChange(pressKey(value, k)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onEnter, active]);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {KEYS.map((k) => (
        <Pressable key={k} onPress={() => onChange(pressKey(value, k))} accessibilityRole="button" accessibilityLabel={k === 'back' ? 'Effacer' : k === ',' ? 'Virgule' : k}
          style={({ pressed, hovered }: any) => [{
            flexBasis: '31%', flexGrow: 1, height: 46, borderRadius: GARDEN_RADII.md, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? GARDEN_COLORS.track : hovered ? GARDEN_COLORS.field : GARDEN_COLORS.card,
            borderWidth: 1, borderColor: GARDEN_COLORS.line,
          }, pointer]}>
          {k === 'back'
            ? <Ionicons name="backspace-outline" size={24} color={GARDEN_COLORS.ink} />
            : <GardenText variant="heading" tabular>{k}</GardenText>}
        </Pressable>
      ))}
    </View>
  );
}
