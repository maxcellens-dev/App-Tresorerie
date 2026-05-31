/**
 * Sélecteur de devise — bouton qui ouvre un modal avec recherche.
 * Ne change que le symbole d'affichage (aucune conversion).
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCIES, currencySymbolFor } from '../lib/currency';

interface Props {
  value: string;                       // code ISO sélectionné
  onChange: (code: string) => void;
  label?: string;
}

export default function CurrencyPicker({ value, onChange, label }: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

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

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Choisir une devise</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
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
                return (
                  <TouchableOpacity
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => { onChange(item.code); setOpen(false); setSearch(''); }}
                  >
                    <Text style={styles.rowSymbol}>{item.symbol}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowCode}>{item.code}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={COLORS.emerald} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
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
  });
}
