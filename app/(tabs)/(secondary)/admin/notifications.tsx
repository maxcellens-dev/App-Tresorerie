/**
 * Admin — Notifications :
 *  - Envoi MANUEL immédiat (titre + corps → push à tous).
 *  - Notifications PLANIFIÉES (ponctuelles date+heure, ou périodiques quotidien/hebdo/mensuel).
 *    La gestion (CRUD) est ici ; le DÉCLENCHEMENT est fait par l'Edge Function
 *    `send-scheduled-notifications` appelée chaque minute par cron-job.org.
 *  - Historique des envois (table admin_notifications).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, Switch, Modal, Pressable } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { sendPushToTarget, type NotifTarget } from '../../../../lib/pushSend';
import { formatDateFrench, parseDateFromFrench } from '../../../../lib/dateUtils';

interface AdminNotification { id: string; title: string; body: string; sent_count: number; created_at: string; source: string | null; target_label: string | null }
interface GroupRow { id: string; name: string }

function targetLabelOf(t: NotifTarget, groups: GroupRow[]): string {
  if (t.kind === 'premium') return 'Premium';
  if (t.kind === 'normal') return 'Normal';
  if (t.kind === 'group') return `Groupe : ${groups.find((g) => g.id === t.groupId)?.name ?? '?'}`;
  return 'Tous';
}

function sourceLabel(source: string | null): string {
  if (source === 'once') return 'Ponctuelle';
  if (source === 'recurring') return 'Périodique';
  return 'Manuel'; // 'manual' ou null (anciens envois)
}

type Recurrence = 'daily' | 'weekly' | 'monthly';
interface ScheduledNotif {
  id: string; title: string; body: string; kind: 'once' | 'recurring';
  trigger_at: string | null; recurrence: Recurrence | null; time_of_day: string | null;
  day_of_week: number | null; day_of_month: number | null; timezone: string;
  active: boolean; last_sent_at: string | null; created_at: string;
  target_kind: NotifTarget['kind']; target_group_id: string | null;
}

const WEEKDAYS = [
  { label: 'Lun', v: 1 }, { label: 'Mar', v: 2 }, { label: 'Mer', v: 3 }, { label: 'Jeu', v: 4 },
  { label: 'Ven', v: 5 }, { label: 'Sam', v: 6 }, { label: 'Dim', v: 0 },
];
const WEEKDAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function scheduleSummary(s: ScheduledNotif): string {
  const t = s.time_of_day ?? '';
  if (s.kind === 'once') {
    if (!s.trigger_at) return 'Ponctuelle';
    const d = new Date(s.trigger_at);
    return `Le ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (s.recurrence === 'daily') return `Tous les jours à ${t}`;
  if (s.recurrence === 'weekly') return `Tous les ${WEEKDAY_NAMES[s.day_of_week ?? 1]}s à ${t}`;
  if (s.recurrence === 'monthly') return `Le ${s.day_of_month} de chaque mois à ${t}`;
  return 'Périodique';
}

const EMPTY_FORM = {
  id: null as string | null, title: '', body: '', kind: 'recurring' as 'once' | 'recurring',
  recurrence: 'daily' as Recurrence, timeOfDay: '09:00', dayOfWeek: 1, dayOfMonth: '1', dateInput: '',
  targetKind: 'all' as NotifTarget['kind'], targetGroupId: null as string | null,
};

export default function AdminNotifications() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? false;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<NotifTarget>({ kind: 'all' });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: groups = [] } = useQuery({
    queryKey: ['user_groups_min'],
    queryFn: async (): Promise<GroupRow[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('user_groups').select('id, name').order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as GroupRow[];
    },
    enabled: isAdmin,
  });

  // Sélecteur de cible (chips) — réutilisé pour l'envoi immédiat et le formulaire de planification.
  const renderTargetChips = (value: NotifTarget, onChange: (t: NotifTarget) => void) => (
    <View style={styles.chipRow}>
      {([['all', 'Tous'], ['premium', 'Premium'], ['normal', 'Normal']] as const).map(([k, lbl]) => (
        <TouchableOpacity key={k} style={[styles.chip, value.kind === k && styles.chipActive]} onPress={() => onChange({ kind: k })}>
          <Text style={[styles.chipText, value.kind === k && styles.chipTextActive]}>{lbl}</Text>
        </TouchableOpacity>
      ))}
      {groups.map((g) => {
        const on = value.kind === 'group' && value.groupId === g.id;
        return (
          <TouchableOpacity key={g.id} style={[styles.chip, on && styles.chipActive]} onPress={() => onChange({ kind: 'group', groupId: g.id })}>
            <Text style={[styles.chipText, on && styles.chipTextActive]}>{g.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const { data: history = [] } = useQuery({
    queryKey: ['admin_notifications'],
    queryFn: async (): Promise<AdminNotification[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('admin_notifications').select('*').order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as AdminNotification[];
    },
    enabled: isAdmin,
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['scheduled_notifications'],
    queryFn: async (): Promise<ScheduledNotif[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('scheduled_notifications').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ScheduledNotif[];
    },
    enabled: isAdmin,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const t = title.trim(); const b = body.trim();
      if (!t || !b) throw new Error('Titre et message requis');
      const sentCount = await sendPushToTarget(sendTarget, t, b);
      const { error } = await supabase.from('admin_notifications').insert({ title: t, body: b, sent_count: sentCount, created_by: user?.id ?? null, source: 'manual', target_label: targetLabelOf(sendTarget, groups) });
      if (error) throw error;
      return sentCount;
    },
    onSuccess: (sentCount) => {
      setTitle(''); setBody('');
      setMsg(`Notification envoyée à ${sentCount} appareil${sentCount > 1 ? 's' : ''}.`);
      qc.invalidateQueries({ queryKey: ['admin_notifications'] });
    },
    onError: (e: any) => setMsg(`Échec : ${e?.message ?? 'erreur inconnue'}`),
  });

  const saveSchedule = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const t = form.title.trim(); const b = form.body.trim();
      if (!t || !b) throw new Error('Titre et message requis');
      if (!/^\d{2}:\d{2}$/.test(form.timeOfDay)) throw new Error('Heure invalide (HH:MM)');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
      if (form.targetKind === 'group' && !form.targetGroupId) throw new Error('Choisis un groupe cible');
      let row: any = {
        title: t, body: b, timezone: tz, active: true,
        target_kind: form.targetKind, target_group_id: form.targetKind === 'group' ? form.targetGroupId : null,
      };
      if (form.kind === 'once') {
        const parsed = parseDateFromFrench(form.dateInput); // YYYY-MM-DD
        if (!parsed) throw new Error('Date invalide (jj-mm-aaaa)');
        const [hh, mm] = form.timeOfDay.split(':').map(Number);
        const [y, m, d] = parsed.split('-').map(Number);
        const dt = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
        if (Number.isNaN(dt.getTime())) throw new Error('Date/heure invalide');
        row = { ...row, kind: 'once', trigger_at: dt.toISOString(), recurrence: null, time_of_day: null, day_of_week: null, day_of_month: null, last_sent_at: null };
      } else {
        const dom = Math.min(31, Math.max(1, parseInt(form.dayOfMonth, 10) || 1));
        row = {
          ...row, kind: 'recurring', trigger_at: null, recurrence: form.recurrence, time_of_day: form.timeOfDay,
          day_of_week: form.recurrence === 'weekly' ? form.dayOfWeek : null,
          day_of_month: form.recurrence === 'monthly' ? dom : null,
        };
      }
      if (form.id) {
        const { error } = await supabase.from('scheduled_notifications').update(row).eq('id', form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('scheduled_notifications').insert({ ...row, created_by: user?.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => { setShowForm(false); setForm(EMPTY_FORM); qc.invalidateQueries({ queryKey: ['scheduled_notifications'] }); },
    onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'),
  });

  const toggleActive = useMutation({
    mutationFn: async (s: ScheduledNotif) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('scheduled_notifications').update({ active: !s.active }).eq('id', s.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled_notifications'] }),
  });

  const deleteSchedule = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('scheduled_notifications').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled_notifications'] }),
  });

  // Envoi immédiat d'une planification (test sans attendre le cron) — même envoi + historique.
  const sendNow = useMutation({
    mutationFn: async (s: ScheduledNotif) => {
      if (!supabase) throw new Error('Backend indisponible');
      const target: NotifTarget = { kind: s.target_kind ?? 'all', groupId: s.target_group_id };
      const count = await sendPushToTarget(target, s.title, s.body);
      await supabase.from('admin_notifications').insert({ title: s.title, body: s.body, sent_count: count, created_by: user?.id ?? null, scheduled_id: s.id, source: s.kind, target_label: targetLabelOf(target, groups) });
      return count;
    },
    onSuccess: (count) => { Alert.alert('Envoyée', `Notification envoyée à ${count} appareil${count > 1 ? 's' : ''}.`); qc.invalidateQueries({ queryKey: ['admin_notifications'] }); },
    onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'),
  });

  const clearHistory = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('admin_notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_notifications'] }),
    onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'),
  });

  const openNew = () => { setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (s: ScheduledNotif) => {
    setForm({
      id: s.id, title: s.title, body: s.body, kind: s.kind,
      recurrence: s.recurrence ?? 'daily', timeOfDay: s.time_of_day ?? '09:00',
      dayOfWeek: s.day_of_week ?? 1, dayOfMonth: String(s.day_of_month ?? 1),
      dateInput: s.trigger_at ? formatDateFrench(s.trigger_at.slice(0, 10)) : '',
      targetKind: s.target_kind ?? 'all', targetGroupId: s.target_group_id ?? null,
    });
    setShowForm(true);
  };
  const confirmSend = () => {
    setMsg(null);
    Alert.alert('Confirmer l\'envoi', `Envoyer à « ${targetLabelOf(sendTarget, groups)} » (utilisateurs ayant activé les notifications) ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Envoyer', onPress: () => sendMutation.mutate() },
    ]);
  };
  const confirmDelete = (s: ScheduledNotif) => {
    Alert.alert('Supprimer', `Supprimer la planification « ${s.title} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteSchedule.mutate(s.id) },
    ]);
  };
  const confirmSendNow = (s: ScheduledNotif) => {
    Alert.alert('Envoyer maintenant', `Envoyer « ${s.title} » à tous les utilisateurs maintenant ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Envoyer', onPress: () => sendNow.mutate(s) },
    ]);
  };
  const confirmClear = () => {
    Alert.alert('Vider l\'historique', 'Supprimer tout l\'historique des envois ? (n\'annule pas les notifications déjà reçues)', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Vider', style: 'destructive', onPress: () => clearHistory.mutate() },
    ]);
  };

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const canSend = !!title.trim() && !!body.trim() && !sendMutation.isPending;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          <Text style={styles.title}>Notifications</Text>

          {/* ── Envoi immédiat ── */}
          <Text style={styles.sectionLabel}>Envoi immédiat</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Titre</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Ex. Nouveauté Relyka 🎉" placeholderTextColor={COLORS.textSecondary} maxLength={80} />
            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} value={body} onChangeText={setBody} placeholder="Le corps de la notification…" placeholderTextColor={COLORS.textSecondary} multiline maxLength={400} />
            <Text style={styles.fieldLabel}>Cible</Text>
            {renderTargetChips(sendTarget, setSendTarget)}
            <TouchableOpacity style={[styles.sendBtn, !canSend && { opacity: 0.5 }]} onPress={confirmSend} disabled={!canSend} activeOpacity={0.85}>
              {sendMutation.isPending ? <ActivityIndicator size="small" color={COLORS.bg} /> : <Ionicons name="paper-plane-outline" size={16} color={COLORS.bg} />}
              <Text style={styles.sendBtnText}>Envoyer ({targetLabelOf(sendTarget, groups)})</Text>
            </TouchableOpacity>
            {msg && <Text style={[styles.msg, { color: msg.startsWith('Échec') ? COLORS.danger : COLORS.emerald }]}>{msg}</Text>}
          </View>

          {/* ── Planifications ── */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>Notifications planifiées</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openNew} activeOpacity={0.8}>
              <Ionicons name="add" size={18} color={COLORS.bg} />
              <Text style={styles.addBtnText}>Ajouter</Text>
            </TouchableOpacity>
          </View>
          {schedules.length === 0 ? (
            <Text style={styles.empty}>Aucune planification. Ajoutez-en une (ponctuelle ou périodique).</Text>
          ) : (
            schedules.map((s) => (
              <View key={s.id} style={[styles.histCard, { opacity: s.active ? 1 : 0.55 }]}>
                <View style={[styles.schedIcon, { backgroundColor: (s.kind === 'once' ? COLORS.blue : COLORS.emerald) + '22' }]}>
                  <Ionicons name={s.kind === 'once' ? 'calendar-outline' : 'repeat-outline'} size={16} color={s.kind === 'once' ? COLORS.blue : COLORS.emerald} />
                </View>
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => openEdit(s)}>
                  <Text style={styles.histTitle} numberOfLines={1}>{s.title}</Text>
                  <Text style={styles.histBody} numberOfLines={2}>{s.body}</Text>
                  <Text style={styles.histMeta}>{scheduleSummary(s)} · {targetLabelOf({ kind: s.target_kind ?? 'all', groupId: s.target_group_id }, groups)}</Text>
                </TouchableOpacity>
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Switch value={s.active} onValueChange={() => toggleActive.mutate(s)} trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }} thumbColor="#fff" />
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <TouchableOpacity onPress={() => confirmSendNow(s)} hitSlop={8} disabled={sendNow.isPending}>
                      <Ionicons name="paper-plane-outline" size={18} color={COLORS.emerald} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmDelete(s)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}

          {/* ── Historique ── */}
          <View style={[styles.sectionRow, { marginTop: 24 }]}>
            <Text style={styles.sectionLabel}>Historique des envois</Text>
            {history.length > 0 && (
              <TouchableOpacity style={styles.clearBtn} onPress={confirmClear} activeOpacity={0.8} disabled={clearHistory.isPending}>
                <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                <Text style={styles.clearBtnText}>Vider</Text>
              </TouchableOpacity>
            )}
          </View>
          {history.length === 0 ? (
            <Text style={styles.empty}>Aucune notification envoyée pour le moment.</Text>
          ) : (
            history.map((n) => {
              const src = sourceLabel(n.source);
              const srcColor = n.source === 'once' ? COLORS.blue : n.source === 'recurring' ? COLORS.emerald : COLORS.textSecondary;
              return (
                <View key={n.id} style={styles.histCard}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.histTitleRow}>
                      <View style={[styles.srcBadge, { backgroundColor: srcColor + '22' }]}>
                        <Text style={[styles.srcBadgeText, { color: srcColor }]}>{src}</Text>
                      </View>
                      <Text style={[styles.histTitle, { flex: 1 }]} numberOfLines={1}>{n.title}</Text>
                    </View>
                    <Text style={styles.histBody} numberOfLines={3}>{n.body}</Text>
                    <Text style={styles.histMeta}>{n.target_label ? n.target_label + ' · ' : ''}{formatDate(n.created_at)} · {n.sent_count} appareil{n.sent_count > 1 ? 's' : ''}</Text>
                  </View>
                </View>
              );
            })
          )}
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* ── Formulaire de planification ── */}
      <Modal visible={showForm} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowForm(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowForm(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{form.id ? 'Modifier' : 'Nouvelle planification'}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
              <Text style={styles.fieldLabel}>Titre</Text>
              <TextInput style={styles.input} value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} placeholder="Titre" placeholderTextColor={COLORS.textSecondary} maxLength={80} />
              <Text style={styles.fieldLabel}>Message</Text>
              <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.body} onChangeText={(v) => setForm((f) => ({ ...f, body: v }))} placeholder="Message" placeholderTextColor={COLORS.textSecondary} multiline maxLength={400} />

              {/* Type */}
              <Text style={styles.fieldLabel}>Type</Text>
              <View style={styles.chipRow}>
                {([['recurring', 'Périodique'], ['once', 'Ponctuelle']] as const).map(([k, lbl]) => (
                  <TouchableOpacity key={k} style={[styles.chip, form.kind === k && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, kind: k }))}>
                    <Text style={[styles.chipText, form.kind === k && styles.chipTextActive]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {form.kind === 'once' ? (
                <>
                  <Text style={styles.fieldLabel}>Date</Text>
                  <TextInput style={styles.input} value={form.dateInput} onChangeText={(v) => setForm((f) => ({ ...f, dateInput: v }))} placeholder="jj-mm-aaaa" placeholderTextColor={COLORS.textSecondary} />
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Fréquence</Text>
                  <View style={styles.chipRow}>
                    {([['daily', 'Quotidien'], ['weekly', 'Hebdo'], ['monthly', 'Mensuel']] as const).map(([k, lbl]) => (
                      <TouchableOpacity key={k} style={[styles.chip, form.recurrence === k && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, recurrence: k }))}>
                        <Text style={[styles.chipText, form.recurrence === k && styles.chipTextActive]}>{lbl}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {form.recurrence === 'weekly' && (
                    <>
                      <Text style={styles.fieldLabel}>Jour</Text>
                      <View style={styles.chipRow}>
                        {WEEKDAYS.map((d) => (
                          <TouchableOpacity key={d.v} style={[styles.chipSm, form.dayOfWeek === d.v && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, dayOfWeek: d.v }))}>
                            <Text style={[styles.chipText, form.dayOfWeek === d.v && styles.chipTextActive]}>{d.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                  {form.recurrence === 'monthly' && (
                    <>
                      <Text style={styles.fieldLabel}>Jour du mois (1–31)</Text>
                      <TextInput style={styles.input} value={form.dayOfMonth} onChangeText={(v) => setForm((f) => ({ ...f, dayOfMonth: v.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" placeholder="1" placeholderTextColor={COLORS.textSecondary} maxLength={2} />
                    </>
                  )}
                </>
              )}

              <Text style={styles.fieldLabel}>Cible</Text>
              {renderTargetChips({ kind: form.targetKind, groupId: form.targetGroupId }, (t) => setForm((f) => ({ ...f, targetKind: t.kind, targetGroupId: t.groupId ?? null })))}

              <Text style={styles.fieldLabel}>Heure (HH:MM)</Text>
              <TextInput style={styles.input} value={form.timeOfDay} onChangeText={(v) => setForm((f) => ({ ...f, timeOfDay: v.replace(/[^0-9:]/g, '') }))} placeholder="09:00" placeholderTextColor={COLORS.textSecondary} maxLength={5} />

              <TouchableOpacity style={[styles.sendBtn, saveSchedule.isPending && { opacity: 0.5 }]} onPress={() => saveSchedule.mutate()} disabled={saveSchedule.isPending} activeOpacity={0.85}>
                {saveSchedule.isPending ? <ActivityIndicator size="small" color={COLORS.bg} /> : <Ionicons name="checkmark" size={16} color={COLORS.bg} />}
                <Text style={styles.sendBtnText}>{form.id ? 'Enregistrer' : 'Créer la planification'}</Text>
              </TouchableOpacity>
              <Text style={styles.note}>
                Heure locale ({Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'}). Le déclenchement réel dépend du cron serveur (toutes les minutes).
              </Text>
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
    title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 16 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 8 },
    sectionLabel: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 8 },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6, marginTop: 6 },
    input: {
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 4,
    },
    sendBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 13, marginTop: 14,
    },
    sendBtnText: { fontSize: 15, fontWeight: '700', color: c.bg },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
    addBtnText: { fontSize: 13, fontWeight: '700', color: c.bg },
    clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: c.danger + '44', backgroundColor: c.danger + '12' },
    clearBtnText: { fontSize: 13, fontWeight: '700', color: c.danger },
    histTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    srcBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    srcBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
    msg: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 12 },
    note: { fontSize: 11, color: c.textSecondary, marginTop: 12, lineHeight: 15 },
    empty: { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', marginBottom: 8 },
    histCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.cardBorder, padding: 14, marginBottom: 10,
    },
    schedIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    histTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    histBody: { fontSize: 13, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
    histMeta: { fontSize: 11, color: c.textSecondary, marginTop: 6, fontWeight: '600' },
    text: { color: c.text, padding: 20 },
    /* Modal */
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '88%', borderWidth: 1, borderColor: c.cardBorder },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
    chipSm: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
    chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    chipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    chipTextActive: { color: c.bg },
  });
}
