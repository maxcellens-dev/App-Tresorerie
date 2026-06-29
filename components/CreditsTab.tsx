/**
 * CreditsTab (#6 module Crédit) — contenu de l'onglet « Crédits » de la page Comptes.
 * Liste des crédits avec capital restant dû (CRD) + mensualité, et accès à la création.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../hooks/useAppColors';
import { useCredits } from '../hooks/useCredits';
import { computeAmortization } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';

const TYPE_META: Record<string, { label: string; icon: string }> = {
  immobilier: { label: 'Immobilier', icon: 'home-outline' },
  consommation: { label: 'Consommation', icon: 'cart-outline' },
  auto: { label: 'Crédit auto', icon: 'car-outline' },
  autre: { label: 'Autre', icon: 'ellipsis-horizontal' },
};

export default function CreditsTab({ userId }: { userId?: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { data: credits = [], isLoading } = useCredits(userId);
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  const today = todayISO();

  const totalCRD = useMemo(() => credits.filter((c) => c.is_active && !c.is_simulation).reduce((s, c) => {
    const a = computeAmortization(c);
    return s + a.crdAtDate(today);
  }, 0), [credits, today]);

  return (
    <View style={styles.wrap}>
      {credits.length > 0 && (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Capital restant dû</Text>
          <Text style={styles.summaryValue}>{fmt(totalCRD)}</Text>
        </View>
      )}

      {isLoading ? null : credits.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: COLORS.blue + '1A' }]}>
            <Ionicons name="card-outline" size={26} color={COLORS.blue} />
          </View>
          <Text style={styles.emptyTitle}>Aucun crédit pour l'instant</Text>
          <Text style={styles.emptyText}>
            Suis tes crédits immobilier, conso, auto… : capital restant dû, tableau d'amortissement, et
            impact automatique sur ta trésorerie.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {credits.map((c, idx) => {
            const a = computeAmortization(c);
            const crd = a.crdAtDate(today);
            const paid = a.paidCountAtDate(today);
            const meta = TYPE_META[c.type] ?? TYPE_META.autre;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.row, idx > 0 && styles.rowBorder]}
                activeOpacity={0.7}
                onPress={() => router.push(`/(tabs)/comptes/credit/${c.id}` as any)}
              >
                <View style={[styles.icon, { backgroundColor: COLORS.blue + '1A' }]}>
                  <Ionicons name={meta.icon as any} size={18} color={COLORS.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.name} numberOfLines={1}>{c.label}</Text>
                    {c.is_simulation && <View style={styles.simTag}><Text style={styles.simTagText}>Simu</Text></View>}
                  </View>
                  <Text style={styles.sub}>{meta.label} · {paid}/{c.duration_months} échéances · {fmt(a.monthlyWithInsurance)}/mois</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.crd}>{fmt(crd)}</Text>
                  <Text style={styles.crdLabel}>restant dû</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/(tabs)/comptes/credit-add' as any)} accessibilityRole="button">
        <Ionicons name="add" size={18} color={COLORS.bg} />
        <Text style={styles.addBtnLabel}>Ajouter un crédit</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 16, paddingTop: 8 },
    summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, marginBottom: 12 },
    summaryLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    summaryValue: { fontSize: 18, fontWeight: '800', color: c.text },
    list: { borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder },
    icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    name: { fontSize: 15, fontWeight: '700', color: c.text, flexShrink: 1 },
    sub: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    crd: { fontSize: 15, fontWeight: '800', color: c.text },
    crdLabel: { fontSize: 10, color: c.textSecondary },
    simTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: c.orange + '1A', borderWidth: 1, borderColor: c.orange + '44' },
    simTagText: { fontSize: 9.5, fontWeight: '700', color: c.orange },
    emptyCard: { alignItems: 'center', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, gap: 8 },
    emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    emptyTitle: { fontSize: 16, fontWeight: '800', color: c.text },
    emptyText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.emerald, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, marginTop: 14 },
    addBtnLabel: { color: c.bg, fontWeight: '800', fontSize: 14 },
  });
}
