/**
 * Admin — gestion des conseils du jour (généraux + contextuels).
 * Permet d'activer/désactiver, modifier les messages, ajouter de nouveaux conseils.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { useAllConseils } from '../../../../hooks/useConseils';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import type { Conseil } from '../../../../hooks/useConseils';

export default function AdminConseils() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();
  const qc = useQueryClient();
  const { data: all = [], isLoading } = useAllConseils();
  const [filter, setFilter] = useState<'all' | 'general' | 'contextuel'>('all');
  const [editing, setEditing] = useState<Partial<Conseil> | null>(null);
  const [editMsg, setEditMsg] = useState('');
  const [editActive, setEditActive] = useState(true);

  const generals = all.filter((c) => c.type === 'general');
  const contextuels = all.filter((c) => c.type === 'contextuel');
  const shown = filter === 'general' ? generals : filter === 'contextuel' ? contextuels : all;

  const save = useMutation({
    mutationFn: async (c: Partial<Conseil>) => {
      if (!supabase) return;
      if (c.id) {
        await supabase.from('conseils').update({ message: editMsg, active: editActive }).eq('id', c.id);
      } else {
        await supabase.from('conseils').insert({ type: c.type, message: editMsg, critere_key: c.critere_key ?? null, active: editActive, display_order: all.length + 1 });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conseils'] }); setEditing(null); },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (!supabase) return;
      await supabase.from('conseils').update({ active }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conseils'] }),
  });

  const openEdit = (c: Conseil) => { setEditing(c); setEditMsg(c.message); setEditActive(c.active ?? true); };
  const openNew = (type: 'general' | 'contextuel') => { setEditing({ type }); setEditMsg(''); setEditActive(true); };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={goBack} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Conseils</Text>
        </View>
        <Text style={styles.subtitle}>Gérez les conseils du jour affichés dans le Pilotage.</Text>

        {/* Filtre */}
        <View style={styles.filterRow}>
          {(['all', 'general', 'contextuel'] as const).map((f) => (
            <TouchableOpacity key={f} style={[styles.filterChip, filter === f && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]} onPress={() => setFilter(f)}>
              <Text style={[styles.filterText, filter === f && { color: COLORS.bg }]}>{f === 'all' ? 'Tous' : f === 'general' ? 'Généraux' : 'Contextuels'}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.addBtn} onPress={() => openNew(filter === 'contextuel' ? 'contextuel' : 'general')}>
            <Ionicons name="add" size={18} color={COLORS.emerald} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.emerald }}>Ajouter</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 24 }} /> : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
            {shown.map((c) => (
              <View key={c.id} style={[styles.card, !c.active && { opacity: 0.5 }]}>
                <View style={styles.cardHead}>
                  <View style={[styles.badge, { backgroundColor: c.type === 'general' ? COLORS.yellow + '33' : COLORS.violet + '33' }]}>
                    <Text style={[styles.badgeText, { color: c.type === 'general' ? COLORS.yellow : COLORS.violet }]}>
                      {c.type === 'general' ? 'Général' : 'Contextuel'}
                    </Text>
                  </View>
                  {c.critere_key && <Text style={styles.critereKey}>{c.critere_key}</Text>}
                  <View style={{ flex: 1 }} />
                  <Switch
                    value={c.active}
                    onValueChange={(v) => toggleActive.mutate({ id: c.id, active: v })}
                    trackColor={{ true: COLORS.emerald, false: COLORS.cardBorder }}
                    thumbColor={COLORS.bg}
                  />
                </View>
                <Text style={styles.msgText} numberOfLines={3}>{c.message}</Text>
                <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(c)}>
                  <Ionicons name="pencil" size={14} color={COLORS.textSecondary} />
                  <Text style={styles.editBtnText}>Modifier</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Modal d'édition */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing?.id ? 'Modifier le conseil' : 'Nouveau conseil'}</Text>
              <TouchableOpacity onPress={() => setEditing(null)}><Ionicons name="close" size={22} color={COLORS.text} /></TouchableOpacity>
            </View>
            {editing?.critere_key && (
              <Text style={styles.critereInfo}>Critère : <Text style={{ fontWeight: '700' }}>{editing.critere_key}</Text></Text>
            )}
            <Text style={styles.inputLabel}>Message (utilisez {'{variable}'} pour les valeurs dynamiques)</Text>
            <TextInput
              style={styles.textArea}
              value={editMsg}
              onChangeText={setEditMsg}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              placeholderTextColor={COLORS.textSecondary}
              placeholder="Texte du conseil…"
            />
            <View style={styles.activeRow}>
              <Text style={styles.inputLabel}>Actif</Text>
              <Switch value={editActive} onValueChange={setEditActive} trackColor={{ true: COLORS.emerald, false: COLORS.cardBorder }} thumbColor={COLORS.bg} />
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, (!editMsg.trim() || save.isPending) && { opacity: 0.5 }]}
              onPress={() => editing && save.mutate(editing)}
              disabled={!editMsg.trim() || save.isPending}
            >
              {save.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.saveBtnText}>Enregistrer</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    title: { fontSize: 20, fontWeight: '800', color: c.text },
    subtitle: { fontSize: 12.5, color: c.textSecondary, marginBottom: 14, lineHeight: 17 },
    filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder },
    filterText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.emerald + '66' },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, padding: 14, marginBottom: 10 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
    badgeText: { fontSize: 11, fontWeight: '700' },
    critereKey: { fontSize: 11, color: c.textSecondary, fontFamily: 'monospace' },
    msgText: { fontSize: 12.5, color: c.text, lineHeight: 18, marginBottom: 8 },
    editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
    editBtnText: { fontSize: 12, color: c.textSecondary },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: c.cardSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    modalTitle: { fontSize: 17, fontWeight: '800', color: c.text },
    critereInfo: { fontSize: 12.5, color: c.textSecondary, marginBottom: 10 },
    inputLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    textArea: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, fontSize: 13, color: c.text, minHeight: 120, marginBottom: 14 },
    activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
    saveBtn: { backgroundColor: c.emerald, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    saveBtnText: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
