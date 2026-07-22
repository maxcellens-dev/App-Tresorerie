/**
 * Modal « Transactions récurrentes » — vue UNIFIÉE de toutes les récurrences actives (virements,
 * dépenses, recettes). Tap sur une ligne → écran d'édition (qui gère la sémantique de troncature).
 * Ouvert depuis un bouton de la page Transactions et un raccourci du modal « dépenses récurrentes ».
 */
import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';
import { sheetWidth } from '../lib/appLayout';
import { useRecurringTransactions, ruleLabel, type RecurringItem, type RecurKind } from '../hooks/useRecurringTransactions';

const KIND_META: Record<RecurKind, { title: string; icon: string; colorKey: 'blue' | 'danger' | 'green' }> = {
  transfer: { title: 'Virements récurrents', icon: 'swap-horizontal', colorKey: 'blue' },
  expense: { title: 'Dépenses récurrentes', icon: 'arrow-down', colorKey: 'danger' },
  income: { title: 'Recettes récurrentes', icon: 'arrow-up', colorKey: 'green' },
};

export default function RecurringTransactionsModal({ visible, onClose, userId }: { visible: boolean; onClose: () => void; userId: string | undefined }) {
  const c = useAppColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { data: items = [], isLoading, refetch } = useRecurringTransactions(userId);
  // À l'ouverture : on relit → une récurrence créée à l'instant apparaît sans rafraîchir la page.
  useEffect(() => { if (visible) refetch(); }, [visible, refetch]);

  const groups: RecurKind[] = ['transfer', 'expense', 'income'];
  const byKind = (k: RecurKind) => items.filter((i) => i.kind === k);
  const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

  const openEdit = (id: string) => { onClose(); router.push(`/(tabs)/transactions/edit/${id}` as any); };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.grabber} />
          <View style={s.header}>
            <Ionicons name="repeat" size={20} color={c.text} />
            <Text style={s.title}>Transactions récurrentes</Text>
            <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={22} color={c.textSecondary} /></Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator color={c.emerald} style={{ marginVertical: 30 }} />
          ) : items.length === 0 ? (
            <Text style={s.empty}>Aucune transaction récurrente active. Coche « Récurrente » à la saisie pour en créer.</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {groups.map((k) => {
                const list = byKind(k);
                if (!list.length) return null;
                const meta = KIND_META[k];
                const color = (c as any)[meta.colorKey];
                return (
                  <View key={k} style={{ marginBottom: 14 }}>
                    <View style={s.groupHead}>
                      <View style={[s.groupIcon, { backgroundColor: color + '22' }]}>
                        <Ionicons name={meta.icon as any} size={14} color={color} />
                      </View>
                      <Text style={s.groupTitle}>{meta.title}</Text>
                      <Text style={s.groupCount}>{list.length}</Text>
                    </View>
                    {list.map((it: RecurringItem) => (
                      <TouchableOpacity key={it.id} style={s.row} activeOpacity={0.7} onPress={() => openEdit(it.id)}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.rowLabel} numberOfLines={1}>{it.label}</Text>
                          <Text style={s.rowSub} numberOfLines={1}>{ruleLabel(it.rule)}{it.accountName && it.kind !== 'transfer' ? ` · ${it.accountName}` : ''} · prochaine {it.nextDate.slice(8, 10)}/{it.nextDate.slice(5, 7)}</Text>
                        </View>
                        <Text style={[s.rowAmount, { color }]}>{eur(it.amount)}</Text>
                        <Ionicons name="chevron-forward" size={16} color={c.textSecondary} />
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })}
              <Text style={s.hint}>Touche une ligne pour la modifier ou l'arrêter.</Text>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { ...sheetWidth, backgroundColor: c.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 26 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.cardBorder, alignSelf: 'center', marginBottom: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 14 },
    title: { flex: 1, fontSize: 17, fontWeight: '800', color: c.text },
    empty: { fontSize: 13.5, color: c.textSecondary, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
    groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    groupIcon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    groupTitle: { fontSize: 13, fontWeight: '800', color: c.text },
    groupCount: { marginLeft: 'auto', fontSize: 11, color: c.textSecondary, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, marginBottom: 7 },
    rowLabel: { fontSize: 14, fontWeight: '700', color: c.text },
    rowSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    rowAmount: { fontSize: 14, fontWeight: '800' },
    hint: { fontSize: 11.5, color: c.textSecondary, textAlign: 'center', marginTop: 4 },
  });
}
