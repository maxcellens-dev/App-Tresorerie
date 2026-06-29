/**
 * AccountImpactSection (#5) — réglage du % d'impact d'un compte partagé/joint dans l'app.
 *
 * Chaque participant (owner + chaque membre) a un %. NULL = part égale auto = 100 / N (N = owner +
 * membres). N'importe quel participant RÉEL peut éditer le % de tout le monde (RPC acct_set_impact).
 * Le % détermine la fraction de l'activité du compte qui compte dans l'app du participant.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useAccountMembers, useSetAccountImpact } from '../hooks/useSharedAccounts';
import { effectiveImpactPct, autoEqualPct } from '../lib/sharedImpact';
import type { Account } from '../types/database';

export default function AccountImpactSection({ account }: { account: Account }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: members = [] } = useAccountMembers(account.id);
  const setImpact = useSetAccountImpact(account.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const isShared = !!account.is_joint || account._role !== 'owner' || members.length > 0;
  if (!isShared) return null;

  const N = 1 + members.length;            // owner + tous les membres
  const auto = autoEqualPct(N);

  // Lignes : owner d'abord, puis membres. memberId = null pour l'owner.
  const rows: { key: string; memberId: string | null; label: string; explicit: number | null | undefined; isMe: boolean }[] = [
    { key: 'owner', memberId: null, label: account._role === 'owner' ? 'Moi (propriétaire)' : 'Propriétaire', explicit: account.owner_impact_pct, isMe: account._role === 'owner' },
    ...members.map((m) => ({ key: m.id, memberId: m.id, label: m.display_name + (m.user_id ? '' : ' (hors app)'), explicit: m.impact_pct, isMe: false })),
  ];

  const save = (memberId: string | null) => {
    const t = draft.trim();
    const pct = t === '' ? null : Math.max(0, Math.min(100, Math.round(Number(t.replace(',', '.')))));
    if (t !== '' && Number.isNaN(pct as number)) { setEditing(null); return; }
    setImpact.mutate({ memberId, pct });
    setEditing(null);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Ionicons name="pie-chart-outline" size={18} color={COLORS.text} />
        <Text style={styles.title}>Impact dans l'app (%)</Text>
      </View>
      <Text style={styles.hint}>
        Part de l'activité de ce compte (soldes, dépenses, virements…) prise en compte dans l'app de chacun.
        Vide = part égale automatique ({auto}% pour {N} {N > 1 ? 'participants' : 'participant'}).
      </Text>
      {rows.map((r) => {
        const eff = effectiveImpactPct(r.explicit, N);
        return (
          <View key={r.key} style={styles.row}>
            <Text style={[styles.name, r.isMe && { fontWeight: '800', color: COLORS.text }]} numberOfLines={1}>{r.label}</Text>
            {editing === r.key ? (
              <View style={styles.editWrap}>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  keyboardType="number-pad"
                  autoFocus
                  placeholder={String(auto)}
                  placeholderTextColor={COLORS.textSecondary}
                  onSubmitEditing={() => save(r.memberId)}
                  maxLength={3}
                />
                <TouchableOpacity onPress={() => save(r.memberId)} style={styles.okBtn}>
                  {setImpact.isPending ? <ActivityIndicator size="small" color={COLORS.text} /> : <Ionicons name="checkmark" size={18} color={COLORS.text} />}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.pctBadge}
                onPress={() => { setEditing(r.key); setDraft(r.explicit != null ? String(r.explicit) : ''); }}
              >
                <Text style={styles.pctText}>{eff}%{r.explicit == null ? ' · auto' : ''}</Text>
                <Ionicons name="pencil" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { marginTop: 18, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    title: { fontSize: 15, fontWeight: '800', color: c.text },
    hint: { fontSize: 11.5, color: c.textSecondary, marginBottom: 10, lineHeight: 16 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, gap: 10 },
    name: { flex: 1, fontSize: 14, color: c.text },
    pctBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg },
    pctText: { fontSize: 13, fontWeight: '700', color: c.text },
    editWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    input: { width: 56, borderWidth: 1, borderColor: c.text, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, color: c.text, textAlign: 'center' },
    okBtn: { padding: 4 },
  });
}
