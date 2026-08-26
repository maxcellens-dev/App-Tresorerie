/**
 * Sélecteur de devise — bouton qui ouvre un modal avec recherche.
 *
 * ⚠️ LE CATALOGUE EST PLUS LARGE QUE LA TABLE DES TAUX.
 * `CURRENCIES` liste une centaine de devises ; `currency_rates` (migration 087, rafraîchie
 * quotidiennement depuis la BCE) n'en couvre qu'une quarantaine. Choisir une devise absente de la
 * table ne produisait AUCUN signe : la conversion renvoyait `null`, et les écrans qui additionnent
 * (Comptes, Pilotage, Projection) retombaient alors sur le montant BRUT en l'affichant avec le
 * nouveau symbole — « 1 240 ₨ » pour 1 240 €. Un chiffre faux, plausible, jamais signalé.
 * On ne retire pas ces devises (le symbole seul a du sens pour beaucoup de gens), mais on DIT
 * lesquelles n'ont pas de taux, dans la liste comme sous le bouton.
 */
import { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { CURRENCIES, currencySymbolFor } from '../../lib/finance/currency';
import { useCurrencyRates } from '../../hooks/data/useCurrencyRates';
import { sheetWidth, useSheetBottomPadding } from '../../lib/ui/appLayout';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';

interface Props {
  value: string;                       // code ISO sélectionné
  onChange: (code: string) => void;
  label?: string;
}

export default function CurrencyPicker({ value, onChange, label }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(20);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  /* `isSuccess` : tant que les taux ne sont pas revenus, on n'affirme RIEN — signaler « pas de
     taux » sur une lecture en cours reviendrait à alarmer sur toutes les devises à l'ouverture. */
  const { data: rates, isSuccess: ratesLoaded } = useCurrencyRates();
  const hasRate = (code: string) => {
    const r = rates?.[code];
    return typeof r === 'number' && r > 0;
  };
  const flagMissing = (code: string) => ratesLoaded && !hasRate(code);

  const current = CURRENCIES.find((c) => c.code === value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <View style={styles.triggerLeft}>
          <Text style={styles.triggerSymbol}>{currencySymbolFor(value)}</Text>
          <Text style={styles.triggerText}>
            {current ? `${current.name} (${current.code})` : value}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={COLORS.textSecondary} />
      </TouchableOpacity>

      {/* La devise choisie n'a pas de taux : les montants s'afficheront avec son symbole, mais
          aucune conversion ne sera faite. Mieux vaut le dire que laisser lire un total faux. */}
      {flagMissing(value) && (
        <View style={styles.warnRow}>
          <Ionicons name="warning-outline" size={14} color={COLORS.orange} />
          <Text style={styles.warnText}>
            Aucun taux de change connu pour cette devise : les montants garderont son symbole, mais
            ne seront pas convertis. Les totaux mêlant plusieurs devises resteront approximatifs.
          </Text>
        </View>
      )}

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <KeyboardAwareOverlay style={styles.overlay} scroll={false}>
          <View style={[styles.sheet, { paddingBottom: sheetPad }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Choisir une devise</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Rechercher (nom ou code)…"
                placeholderTextColor={COLORS.textSecondary}
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => {
                const active = item.code === value;
                const noRate = flagMissing(item.code);
                return (
                  <TouchableOpacity
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => { onChange(item.code); setOpen(false); setSearch(''); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${item.name} (${item.code})${noRate ? ', sans taux de conversion' : ''}`}
                  >
                    <Text style={styles.rowSymbol}>{item.symbol}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowCode}>
                        {item.code}
                        {noRate && <Text style={styles.rowNoRate}>{'  ·  sans taux de conversion'}</Text>}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={COLORS.emerald} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </KeyboardAwareOverlay>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    trigger: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    },
    triggerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    triggerSymbol: { fontSize: 18, fontWeight: '800', color: c.emerald, minWidth: 28 },
    triggerText: { fontSize: 15, color: c.text, flex: 1 },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
      ...sheetWidth,
      backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingTop: 12, paddingHorizontal: 20, maxHeight: '80%', borderTopWidth: 1, borderColor: c.cardBorder,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    closeBtn: { padding: 4 },
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12,
    },
    searchInput: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 12 },
    list: { marginBottom: 8 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12,
      paddingHorizontal: 8, borderRadius: 10,
    },
    rowActive: { backgroundColor: c.card },
    rowSymbol: { fontSize: 16, fontWeight: '700', color: c.text, minWidth: 40 },
    rowName: { fontSize: 15, color: c.text },
    rowCode: { fontSize: 12, color: c.textSecondary },
    rowNoRate: { fontSize: 12, color: c.orange, fontWeight: '600' },
    warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.orange + '55', backgroundColor: c.orange + '14' },
    warnText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: c.orange },
  });
}
