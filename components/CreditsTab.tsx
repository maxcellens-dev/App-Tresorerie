/**
 * CreditsTab (#6 module Crédit) — onglet « Crédits ». Liste des crédits (CRD + mensualité), section
 * « Crédits partagés » (reçus d'autres users), invitations en attente, et création perso/partagé.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../hooks/useAppColors';
import { useCredits } from '../hooks/useCredits';
import { useCreditInvitations, useRespondCreditInvitation, useSharedCreditsRealtime } from '../hooks/useSharedCredits';
import { computeAmortization } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import type { Credit } from '../types/database';

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
  const { data: invitations = [] } = useCreditInvitations(userId);
  const respond = useRespondCreditInvitation(userId);
  useSharedCreditsRealtime(userId);
  const [showType, setShowType] = useState(false);
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  const today = todayISO();

  const own = credits.filter((c) => !c._role || c._role === 'owner');
  const shared = credits.filter((c) => c._role && c._role !== 'owner');
  const totalCRD = useMemo(() => own.filter((c) => c.is_active && !c.is_simulation).reduce((s, c) => s + computeAmortization(c).crdAtDate(today), 0), [credits, today]);

  const row = (c: Credit, idx: number, isShared: boolean) => {
    const a = computeAmortization(c);
    const meta = TYPE_META[c.type] ?? TYPE_META.autre;
    return (
      <TouchableOpacity key={c.id} style={[styles.row, idx > 0 && styles.rowBorder]} activeOpacity={0.7} onPress={() => router.push(`/(tabs)/comptes/credit/${c.id}` as any)}>
        <View style={[styles.icon, { backgroundColor: COLORS.blue + '1A' }]}><Ionicons name={meta.icon as any} size={18} color={COLORS.blue} /></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.name} numberOfLines={1}>{c.label}</Text>
            {c.is_simulation && <View style={styles.simTag}><Text style={styles.simTagText}>Simu</Text></View>}
            {isShared && <View style={styles.shareTag}><Text style={styles.shareTagText}>{c._role === 'read' ? 'Consult.' : 'Partagé'}</Text></View>}
          </View>
          <Text style={styles.sub}>{meta.label} · {a.paidCountAtDate(today)}/{c.duration_months} échéances · {fmt(a.monthlyWithInsurance)}/mois</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.crd}>{fmt(a.crdAtDate(today))}</Text>
          <Text style={styles.crdLabel}>restant dû</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrap}>
      {own.length > 0 && (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Capital restant dû</Text>
          <Text style={styles.summaryValue}>{fmt(totalCRD)}</Text>
        </View>
      )}

      {/* Invitations en attente */}
      {invitations.map((inv) => (
        <View key={inv.invite_id} style={styles.inviteCard}>
          <Ionicons name="card-outline" size={20} color={COLORS.blue} />
          <View style={{ flex: 1 }}>
            <Text style={styles.inviteName} numberOfLines={1}>{inv.credit_label}</Text>
            <Text style={styles.inviteSub}>{inv.from_name} t'invite ({inv.role === 'read' ? 'consultation' : 'écriture'})</Text>
          </View>
          <TouchableOpacity onPress={() => respond.mutate({ inviteId: inv.invite_id, accept: true })}><Ionicons name="checkmark-circle" size={26} color={COLORS.emerald} /></TouchableOpacity>
          <TouchableOpacity onPress={() => respond.mutate({ inviteId: inv.invite_id, accept: false })}><Ionicons name="close-circle" size={26} color={COLORS.danger} /></TouchableOpacity>
        </View>
      ))}

      {isLoading ? null : credits.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: COLORS.blue + '1A' }]}><Ionicons name="card-outline" size={26} color={COLORS.blue} /></View>
          <Text style={styles.emptyTitle}>Aucun crédit pour l'instant</Text>
          <Text style={styles.emptyText}>Suis tes crédits immobilier, conso, auto… : capital restant dû, tableau d'amortissement, impact trésorerie.</Text>
        </View>
      ) : (
        <>
          {own.length > 0 && <View style={styles.list}>{own.map((c, i) => row(c, i, false))}</View>}
          {shared.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Crédits partagés</Text>
              <View style={styles.list}>{shared.map((c, i) => row(c, i, true))}</View>
            </>
          )}
        </>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setShowType(true)} accessibilityRole="button">
        <Ionicons name="add" size={18} color={COLORS.bg} />
        <Text style={styles.addBtnLabel}>Ajouter un crédit</Text>
      </TouchableOpacity>

      {/* Modal type de crédit (perso / partagé) */}
      <Modal visible={showType} transparent animationType="fade" onRequestClose={() => setShowType(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowType(false)}>
          <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.cardTitle}>Quel type de crédit ?</Text>
            <TouchableOpacity style={styles.opt} onPress={() => { setShowType(false); router.push('/(tabs)/comptes/credit-add' as any); }}>
              <View style={[styles.optIcon, { backgroundColor: COLORS.emerald + '22' }]}><Ionicons name="person" size={22} color={COLORS.emerald} /></View>
              <View style={{ flex: 1 }}><Text style={styles.optTitle}>Personnel</Text><Text style={styles.optSub}>Un crédit à toi.</Text></View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.opt} onPress={() => { setShowType(false); router.push('/(tabs)/comptes/credit-add?shared=1' as any); }}>
              <View style={[styles.optIcon, { backgroundColor: '#3b82f6' + '22' }]}><Ionicons name="people" size={22} color="#3b82f6" /></View>
              <View style={{ flex: 1 }}><Text style={styles.optTitle}>Partagé</Text><Text style={styles.optSub}>Visible par d'autres users. Tu enverras les invitations après création.</Text></View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 16, paddingTop: 8 },
    summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, marginBottom: 12 },
    summaryLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    summaryValue: { fontSize: 18, fontWeight: '800', color: c.text },
    sectionLabel: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginTop: 16, marginBottom: 8, paddingHorizontal: 4 },
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
    shareTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: c.blue + '1A', borderWidth: 1, borderColor: c.blue + '44' },
    shareTagText: { fontSize: 9.5, fontWeight: '700', color: c.blue },
    inviteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.blue + '55', backgroundColor: c.blue + '0D', marginBottom: 10 },
    inviteName: { fontSize: 14, fontWeight: '700', color: c.text },
    inviteSub: { fontSize: 11.5, color: c.textSecondary },
    emptyCard: { alignItems: 'center', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, gap: 8 },
    emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    emptyTitle: { fontSize: 16, fontWeight: '800', color: c.text },
    emptyText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.emerald, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, marginTop: 14 },
    addBtnLabel: { color: c.bg, fontWeight: '800', fontSize: 14 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 22 },
    card: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 20, gap: 12 },
    cardTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14 },
    optIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    optTitle: { fontSize: 15, fontWeight: '800', color: c.text },
    optSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });
}
