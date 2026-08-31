/**
 * SÉLECTEUR DE TYPE DE COMPTE — une rangée qui défile, teintée par type.
 *
 * ── POURQUOI TEINTÉ ────────────────────────────────────────────────────────────────────────────
 * Le type de compte a DÉJÀ une couleur dans toute l'app : bleu pour un courant, vert pour une
 * épargne, violet pour un investissement (`theme/colors → accountColor`). C'est ce code couleur que
 * l'utilisateur lit dans la liste des comptes, dans les graphes et dans le sélecteur de compte d'un
 * virement. Peindre ces pastilles en vert d'accent, quel que soit le type choisi, c'était lui
 * apprendre une couleur ici et une autre partout ailleurs.
 *
 * ── POURQUOI UNE RANGÉE QUI DÉFILE ─────────────────────────────────────────────────────────────
 * Quatre types (bientôt plus) en `flexWrap` produisaient deux lignes bancales — trois pastilles
 * puis une seule, isolée en dessous. Le même geste que le choix du compte dans une saisie : on
 * balaie. La sélection est ramenée à l'écran automatiquement, sinon un type choisi hors cadre
 * donne l'impression qu'aucun ne l'est.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { accountColor } from '../../theme/colors';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { chipStyles, chipTone, DISABLED_OPACITY } from '../../lib/ui/controls';

export interface TypeOption {
  value: string;
  label: string;
  /** Teinte explicite — sinon celle du type de compte. */
  tone?: string;
}

interface Props {
  options: TypeOption[];
  value: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
  /** Marge basse (les formulaires enchaînent les blocs à 20 px). */
  marginBottom?: number;
}

export default function AccountTypeRow({ options, value, onSelect, disabled, marginBottom = 20 }: Props) {
  const COLORS = useAppColors();
  const s = useMemo(() => makeStyles(COLORS), [COLORS]);
  const ref = useRef<ScrollView>(null);
  const posRef = useRef<Record<string, number>>({});

  const scrollToActive = (animated: boolean) => {
    const x = posRef.current[value];
    if (x != null) ref.current?.scrollTo({ x: Math.max(0, x - 40), animated });
  };
  useEffect(() => { scrollToActive(true); }, [value]);

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[s.scroll, { marginBottom }]}
      contentContainerStyle={s.content}
    >
      {options.map((o) => {
        const active = value === o.value;
        const tone = o.tone ?? accountColor(o.value as any);
        return (
          <TouchableOpacity
            key={o.value}
            onLayout={(e) => {
              posRef.current[o.value] = e.nativeEvent.layout.x;
              if (o.value === value) scrollToActive(false);
            }}
            style={[s.chip, chipTone(active, tone, COLORS).container, disabled && { opacity: DISABLED_OPACITY }]}
            onPress={() => onSelect(o.value)}
            disabled={disabled}
            activeOpacity={0.85}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: !!disabled }}
          >
            <Text style={[s.label, { color: active ? tone : COLORS.textSecondary, fontWeight: active ? '700' : '600' }]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(c: any) {
  const base = chipStyles(c);
  return StyleSheet.create({
    scroll: {},
    // `paddingRight` : la dernière pastille ne doit pas coller au bord, sinon rien ne signale
    // qu'il reste quelque chose à droite.
    content: { paddingRight: 12, gap: 8 },
    chip: { ...base.chip, paddingVertical: 10, paddingHorizontal: 15 },
    label: { fontSize: 13.5 },
  });
}
