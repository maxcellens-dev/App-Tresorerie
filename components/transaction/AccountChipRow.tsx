/**
 * SÉLECTEUR DE COMPTE — la rangée de pastilles utilisée par TOUS les écrans de saisie.
 *
 * Elle existait en plusieurs copies : une dans la nouvelle transaction, deux dans l'ancien écran de
 * virement (source et destination), une dans l'édition. Elles avaient déjà divergé — seules
 * certaines affichaient le solde, seules certaines défilaient jusqu'au compte sélectionné, seules
 * certaines grisaient un compte impossible à choisir. Autrement dit : le même geste ne se
 * présentait pas pareil selon l'écran d'où on l'avait ouvert.
 *
 * Le composant porte donc AUSSI ses couleurs et ses styles : tant qu'ils étaient passés par
 * l'appelant, rien n'empêchait deux écrans de la rendre différemment.
 *
 * Le solde est affiché sous le nom : choisir un compte source sans savoir ce qu'il contient oblige
 * à ressortir de la saisie pour aller le vérifier.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { accountColor } from '../../theme/colors';
import { currencySymbolFor } from '../../lib/finance/currency';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { chipStyles, chipTone, DISABLED_OPACITY } from '../../lib/ui/controls';

export interface ChipAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency?: string | null;
}

interface Props {
  accounts: ChipAccount[];
  activeId: string | null;
  /** Compte présent mais NON choisissable (la destination d'un virement ne peut pas être sa source). */
  disabledId?: string | null;
  onSelect: (id: string) => void;
}

export default function AccountChipRow({ accounts, activeId, disabledId, onSelect }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const ref = useRef<ScrollView>(null);
  const posRef = useRef<Record<string, number>>({});

  /* Le compte sélectionné doit être VISIBLE : sur une longue liste, il restait hors écran à droite
     — l'utilisateur voyait une rangée sans sélection apparente et en choisissait un autre. */
  const scrollToActive = (animated: boolean) => {
    if (activeId != null && posRef.current[activeId] != null) {
      ref.current?.scrollTo({ x: Math.max(0, posRef.current[activeId] - 40), animated });
    }
  };
  useEffect(() => { scrollToActive(true); }, [activeId]);

  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
      {accounts.map((acc) => {
        const color = accountColor(acc.type as any);
        const isActive = activeId === acc.id;
        const isDisabled = disabledId === acc.id;
        return (
          <TouchableOpacity
            key={acc.id}
            onLayout={(e) => {
              posRef.current[acc.id] = e.nativeEvent.layout.x;
              if (acc.id === activeId) scrollToActive(false);
            }}
            style={[
              styles.chip,
              chipTone(isActive, color, COLORS).container,
              isDisabled && { opacity: DISABLED_OPACITY },
            ]}
            onPress={() => onSelect(acc.id)}
            disabled={isDisabled}
            activeOpacity={0.85}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive, disabled: isDisabled }}
          >
            <Text style={[styles.name, { color: isActive ? color : COLORS.text, fontWeight: isActive ? '700' : '600' }]}>{acc.name}</Text>
            <Text style={styles.balance}>
              {Number(acc.balance).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbolFor(acc.currency)}
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
    scroll: { marginBottom: 16 },
    /* Géométrie COMMUNE à toutes les pastilles de l'app (lib/ui/controls) : seule la teinte change
       d'un contexte à l'autre. Avant, celle-ci était une gélule de rayon 20 quand les filtres de la
       page Transactions en avaient une de rayon 8 — le même geste, deux formes. */
    chip: {
      ...base.chip,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0,
      paddingVertical: 9,
      paddingHorizontal: 14,
      marginRight: 8,
    },
    name: { fontSize: 14, lineHeight: 18, textAlign: 'center' },
    balance: { fontSize: 11, lineHeight: 14, color: c.textSecondary, marginTop: 2 },
  });
}
