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
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../lib/platform/supabase';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/data/useProfile';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { sendPushToTarget, type NotifTarget, type PushSendResult } from '../../../../lib/platform/pushSend';
import PushDiagnostics from '../../../../components/admin/PushDiagnostics';
import { formatDateFrench, parseDateFromFrench } from '../../../../lib/dateUtils';
import { SYSTEM_NOTIFICATIONS, isSystemNotificationEnabled } from '../../../../lib/platform/systemNotifications';
import { sheetWidth } from '../../../../lib/ui/appLayout';
import { useSystemNotificationsConfig, useSaveSystemNotificationsConfig } from '../../../../hooks/pilotage/useReliability';
import { useCrashNotifyConfig, useSaveCrashNotifyConfig, useAdminNotifTemplates, useSaveAdminNotifTemplate, type AdminNotifTemplateKind } from '../../../../hooks/platform/useSecurity';
import { useAdminNotifPrefs, useSaveAdminNotifPref, type AdminNotifKind } from '../../../../hooks/admin/useUnreadBadges';
import KeyboardAwareOverlay from '../../../../components/layout/KeyboardAwareOverlay';

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
  if (source === 'crash') return 'Crash / erreur';
  if (source === 'ai_ticket') return 'Ticket IA';
  return 'Manuel'; // 'manual' ou null (anciens envois)
}

/* ── Carte : titre + message d'un type de notification admin événementiel. ── */
function NotifTemplateCard({ kind, label, icon, COLORS, styles }: { kind: AdminNotifTemplateKind; label: string; icon: string; COLORS: any; styles: any }) {
  const { data: templates } = useAdminNotifTemplates();
  const save = useSaveAdminNotifTemplate();
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    const t = templates?.[kind];
    if (t) { setTitle(t.title); setBody(t.body); }
  }, [templates, kind]);
  if (!templates) return null;
  const doSave = () => save.mutate(
    { kind, title: title.trim(), body: body.trim() },
    { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 1500); } },
  );
  return (
    <View style={[styles.crashCard, { borderColor: COLORS.cardBorder }]}>
      <View style={styles.crashHead}>
        <Ionicons name={icon as any} size={18} color={COLORS.textSecondary} />
        <Text style={styles.crashTitle}>{label}</Text>
      </View>
      <TextInput style={styles.crashInput} value={title} onChangeText={setTitle} placeholder="Titre" placeholderTextColor={COLORS.textSecondary} maxLength={120} />
      <TextInput style={[styles.crashInput, { minHeight: 56, textAlignVertical: 'top' }]} value={body} onChangeText={setBody} placeholder="Message" multiline placeholderTextColor={COLORS.textSecondary} maxLength={240} />
      <TouchableOpacity style={styles.crashSave} onPress={doSave}>
        <Text style={styles.crashSaveTxt}>{saved ? '✓ Enregistré' : 'Enregistrer'}</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ── Carte : alerte admin en cas de crash/erreur (titre + corps éditables). ── */
function CrashNotifyCard({ COLORS, styles }: { COLORS: any; styles: any }) {
  const { data: cfg } = useCrashNotifyConfig();
  const save = useSaveCrashNotifyConfig();
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [throttle, setThrottle] = React.useState('30');
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (!cfg) return;
    setTitle(cfg.title); setBody(cfg.body); setThrottle(String(cfg.throttle_minutes));
  }, [cfg]);
  if (!cfg) return null;
  const doSave = () => save.mutate(
    { title: title.trim(), body: body.trim(), throttle_minutes: Math.max(1, parseInt(throttle, 10) || 30) },
    { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 1500); } },
  );
  return (
    <View style={styles.crashCard}>
      <View style={styles.crashHead}>
        <Ionicons name="bug-outline" size={18} color={COLORS.danger} />
        <Text style={styles.crashTitle}>Alerte crash / erreur</Text>
        <Switch
          style={{ marginLeft: 'auto' }}
          value={cfg.enabled}
          onValueChange={(v) => save.mutate({ enabled: v })}
          trackColor={{ true: COLORS.emerald, false: COLORS.cardBorder }}
        />
      </View>
      <Text style={styles.crashDesc}>
        Quand un appareil remonte une erreur (Centre de sécurité), les admins reçoivent une alerte in-app
        (badge). Anti-flood : une seule alerte par fenêtre. Variables : {'{kind}'} {'{platform}'} {'{version}'}.
      </Text>
      {cfg.enabled && (
        <>
          <TextInput style={styles.crashInput} value={title} onChangeText={setTitle} placeholder="Titre" placeholderTextColor={COLORS.textSecondary} />
          <TextInput style={[styles.crashInput, { minHeight: 60, textAlignVertical: 'top' }]} value={body} onChangeText={setBody} placeholder="Message" multiline placeholderTextColor={COLORS.textSecondary} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.crashDesc}>Anti-flood (minutes) :</Text>
            <TextInput style={[styles.crashInput, { flex: 0, width: 64, marginBottom: 0 }]} value={throttle} onChangeText={setThrottle} keyboardType="number-pad" />
          </View>
          <TouchableOpacity style={styles.crashSave} onPress={doSave}>
            <Text style={styles.crashSaveTxt}>{saved ? '✓ Enregistré' : 'Enregistrer'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
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
  if (s.recurrence === 'monthly') return s.day_of_month === 0 ? `Le dernier jour de chaque mois à ${t}` : `Le ${s.day_of_month} de chaque mois à ${t}`;
  return 'Périodique';
}

const EMPTY_FORM = {
  id: null as string | null, title: '', body: '', kind: 'recurring' as 'once' | 'recurring',
  recurrence: 'daily' as Recurrence, timeOfDay: '09:00', dayOfWeek: 1, dayOfMonth: '1', lastDay: false, dateInput: '',
  targetKind: 'all' as NotifTarget['kind'], targetGroupId: null as string | null,
};

export default function AdminNotifications() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
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

  // Notifications automatiques (système) : activation par identifiant (app_config.system_notifications).
  const { data: sysNotifCfg } = useSystemNotificationsConfig();
  const saveSysNotif = useSaveSystemNotificationsConfig();
  // Onglet : automatiques (système) / manuelles (envoi, planifié, historique) / admin-support.
  const [tab, setTab] = useState<'auto' | 'manuel' | 'support'>('auto');
  // Préférences PAR ADMIN (assistance / suggestions / tickets IA → in-app / push).
  const { data: adminPrefs } = useAdminNotifPrefs(isAdmin);
  const savePref = useSaveAdminNotifPref();
  const prefOf = (adminId: string, kind: AdminNotifKind) =>
    adminPrefs?.prefs.find((p) => p.profile_id === adminId && p.kind === kind) ?? { in_app: true, push: false };
  const KIND_LABELS: { kind: AdminNotifKind; label: string; icon: string }[] = [
    { kind: 'support', label: 'Assistance', icon: 'headset-outline' },
    { kind: 'suggestion', label: 'Suggestions', icon: 'chatbubbles-outline' },
    { kind: 'ai_ticket', label: 'Tickets IA', icon: 'sparkles-outline' },
    { kind: 'crash', label: 'Crashs / erreurs', icon: 'bug-outline' },
  ];

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

  /* L'envoi passe par l'Edge Function `admin-push`, qui écrit ELLE-MÊME la ligne d'historique avec
     le nombre d'envois réellement acceptés par Expo. On n'insère donc plus rien ici : l'ancien code
     enregistrait le nombre de jetons lus en base, un chiffre qui ne prouvait aucun envoi. */
  const sendMutation = useMutation({
    mutationFn: async (): Promise<PushSendResult> => {
      const t = title.trim(); const b = body.trim();
      if (!t || !b) throw new Error('Titre et message requis');
      return sendPushToTarget(sendTarget, t, b);
    },
    onSuccess: (r) => {
      if (r.targeted === 0) { setMsg('Échec : aucun appareil joignable pour cette cible.'); return; }
      if (r.accepted === 0) { setMsg(`Échec : aucun envoi accepté par Expo — ${r.summary}`); return; }
      setTitle(''); setBody('');
      setMsg(
        `Notification acceptée pour ${r.accepted} appareil${r.accepted > 1 ? 's' : ''}`
        + (r.failed > 0 ? ` (${r.failed} en échec — ${r.summary})` : '.'),
      );
      qc.invalidateQueries({ queryKey: ['admin_notifications'] });
      qc.invalidateQueries({ queryKey: ['push_reachability'] });
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
        // day_of_month = 0 → « dernier jour du mois » (l'Edge Function le résout au dernier jour réel).
        const dom = form.lastDay ? 0 : Math.min(31, Math.max(1, parseInt(form.dayOfMonth, 10) || 1));
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
    mutationFn: async (s: ScheduledNotif): Promise<PushSendResult> => {
      const target: NotifTarget = { kind: s.target_kind ?? 'all', groupId: s.target_group_id };
      return sendPushToTarget(target, s.title, s.body);
    },
    onSuccess: (r) => {
      // On dit ce qui s'est passé, y compris quand rien n'est parti : un « Envoyée ✓ » alors que
      // zéro appareil a reçu quoi que ce soit est exactement ce qui masquait la panne.
      if (r.accepted > 0) {
        Alert.alert('Envoyée', `Acceptée par Expo pour ${r.accepted} appareil${r.accepted > 1 ? 's' : ''}.`
          + (r.failed > 0 ? `\n${r.failed} en échec — ${r.summary}` : ''));
      } else if (r.targeted === 0) {
        Alert.alert('Aucun destinataire', 'Aucun appareil joignable pour cette cible.');
      } else {
        Alert.alert('Échec', `Aucun envoi accepté par Expo.\n${r.summary}`);
      }
      qc.invalidateQueries({ queryKey: ['admin_notifications'] });
      qc.invalidateQueries({ queryKey: ['push_reachability'] });
    },
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
      dayOfWeek: s.day_of_week ?? 1, dayOfMonth: String(s.day_of_month && s.day_of_month > 0 ? s.day_of_month : 1), lastDay: s.day_of_month === 0,
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
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Notifications" onBack={goBack} />
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const canSend = !!title.trim() && !!body.trim() && !sendMutation.isPending;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Notifications" onBack={goBack} />

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

          {/* ── Onglets : Automatiques (système) / Manuelles / Admin-Support ── */}
          <View style={styles.tabBar}>
            {([['auto', 'Automatiques', 'flash-outline'], ['manuel', 'Manuelles', 'paper-plane-outline'], ['support', 'Admin', 'shield-outline']] as const).map(([k, lbl, icon]) => (
              <TouchableOpacity key={k} style={[styles.tab, tab === k && styles.tabActive]} onPress={() => setTab(k)} activeOpacity={0.8}>
                <Ionicons name={icon as any} size={15} color={tab === k ? COLORS.bg : COLORS.textSecondary} />
                <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>{lbl}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'support' ? (
          /* ── Notifications ADMIN/SUPPORT : qui reçoit quoi (badge in-app / push) ── */
          <View style={[styles.card, { gap: 10 }]}>
            <Text style={styles.sysIntro}>
              Choisissez, pour chaque admin, les événements qui déclenchent son badge in-app et (bientôt)
              un push : demandes d'assistance, suggestions d'utilisateurs, tickets Conseils IA.
              L'envoi push sera activé avec les crons — le ciblage configuré ici sera respecté.
            </Text>
            {(adminPrefs?.admins ?? []).map((a) => (
              <View key={a.id} style={styles.sysCard}>
                <Text style={styles.sysTitle}>{a.label}</Text>
                {KIND_LABELS.map(({ kind, label, icon }) => {
                  const p = prefOf(a.id, kind);
                  return (
                    <View key={kind} style={styles.prefRow}>
                      <Ionicons name={icon as any} size={15} color={COLORS.textSecondary} />
                      <Text style={styles.prefLabel}>{label}</Text>
                      <View style={styles.prefToggle}>
                        <Text style={styles.prefToggleLabel}>In-app</Text>
                        <Switch
                          value={p.in_app}
                          onValueChange={(v) => savePref.mutate({ profile_id: a.id, kind, in_app: v })}
                          trackColor={{ true: COLORS.emerald, false: COLORS.cardBorder }}
                        />
                      </View>
                      <View style={styles.prefToggle}>
                        <Text style={styles.prefToggleLabel}>Push</Text>
                        <Switch
                          value={p.push}
                          onValueChange={(v) => savePref.mutate({ profile_id: a.id, kind, push: v })}
                          trackColor={{ true: COLORS.blue, false: COLORS.cardBorder }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
            {(adminPrefs?.admins ?? []).length === 0 && (
              <Text style={styles.empty}>Aucun admin trouvé (ou migration 121 non appliquée).</Text>
            )}

            {/* ── Contenu (titre + message) de chaque notification admin ── */}
            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Contenu des notifications admin</Text>
            <Text style={styles.sysIntro}>Le titre et le message envoyés/affichés pour chaque type d'événement.</Text>
            <CrashNotifyCard COLORS={COLORS} styles={styles} />
            <NotifTemplateCard kind="support" label="Assistance" icon="headset-outline" COLORS={COLORS} styles={styles} />
            <NotifTemplateCard kind="suggestion" label="Suggestions" icon="chatbubbles-outline" COLORS={COLORS} styles={styles} />
            <NotifTemplateCard kind="ai_ticket" label="Tickets IA" icon="sparkles-outline" COLORS={COLORS} styles={styles} />
          </View>
          ) : tab === 'auto' ? (
          /* ── Notifications AUTOMATIQUES (système) — catalogue documenté, activables une à une ── */
          <View style={[styles.card, { gap: 10 }]}>
            <Text style={styles.sysIntro}>
              Déclenchées automatiquement dans l'app par le moteur d'état (bandeau « prochain geste »).
              L'envoi PUSH sera branché plus tard via cron — les réglages ci-dessous s'appliqueront aussi au push.
            </Text>
            {SYSTEM_NOTIFICATIONS.map((n) => {
              const enabled = isSystemNotificationEnabled(n.id, sysNotifCfg);
              return (
                <View key={n.id} style={styles.sysCard}>
                  <View style={styles.sysHead}>
                    <Text style={styles.sysTitle}>{n.title}</Text>
                    <Switch
                      value={enabled}
                      onValueChange={(v) => saveSysNotif.mutate({ [n.id]: { enabled: v } })}
                      trackColor={{ true: COLORS.emerald, false: COLORS.cardBorder }}
                    />
                  </View>
                  <Text style={styles.sysId}>{n.id}</Text>
                  <Text style={styles.sysBody}>« {n.bodyExample} »</Text>
                  <Text style={styles.sysMeta}>Quand : {n.condition}</Text>
                  <Text style={styles.sysMeta}>Fréquence max : {n.maxFrequency}</Text>
                </View>
              );
            })}
          </View>
          ) : (
          <>
          {/* ── Diagnostic : qui peut être atteint, et est-ce que la chaîne d'envoi fonctionne ? ──
              Placé AVANT le formulaire : quand un envoi ne donne rien, c'est la première chose à lire. */}
          <Text style={styles.sectionLabel}>Diagnostic</Text>
          <PushDiagnostics />

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
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Envoyer maintenant" onPress={() => confirmSendNow(s)} hitSlop={8} disabled={sendNow.isPending}>
                      <Ionicons name="paper-plane-outline" size={18} color={COLORS.emerald} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la planification" onPress={() => confirmDelete(s)} hitSlop={8}>
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
          </>
          )}
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* ── Formulaire de planification ── */}
      <Modal visible={showForm} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowForm(false)}>
        <KeyboardAwareOverlay style={styles.modalOverlay} onBackdropPress={() => setShowForm(false)} scroll={false}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{form.id ? 'Modifier' : 'Nouvelle planification'}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer le formulaire" onPress={() => setShowForm(false)} style={{ padding: 4 }}>
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
                      <Text style={styles.fieldLabel}>Jour du mois</Text>
                      <View style={styles.chipRow}>
                        <TouchableOpacity style={[styles.chip, !form.lastDay && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, lastDay: false }))}>
                          <Text style={[styles.chipText, !form.lastDay && styles.chipTextActive]}>Jour précis</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.chip, form.lastDay && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, lastDay: true }))}>
                          <Text style={[styles.chipText, form.lastDay && styles.chipTextActive]}>Dernier jour du mois</Text>
                        </TouchableOpacity>
                      </View>
                      {!form.lastDay && (
                        <TextInput style={styles.input} value={form.dayOfMonth} onChangeText={(v) => setForm((f) => ({ ...f, dayOfMonth: v.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" placeholder="1 à 31" placeholderTextColor={COLORS.textSecondary} maxLength={2} />
                      )}
                      <Text style={styles.note}>« Dernier jour » s'adapte automatiquement (28/29/30/31 selon le mois).</Text>
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
        </KeyboardAwareOverlay>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 16 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 8 },
    sectionLabel: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 },
    /* Onglets Automatiques / Manuelles */
    tabBar: { flexDirection: 'row', gap: 8, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 4, marginBottom: 16 },
    tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
    tabActive: { backgroundColor: c.emerald },
    tabText: { fontSize: 13.5, fontWeight: '700', color: c.textSecondary },
    tabTextActive: { color: c.bg },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 8 },
    /* Notifications automatiques (système) */
    sysIntro: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    sysCard: { backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, padding: 12 },
    crashCard: { backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.danger, padding: 12, gap: 8, marginBottom: 4 },
    crashHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    crashTitle: { fontSize: 14, fontWeight: '800', color: c.text },
    crashDesc: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16 },
    crashInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: c.text, marginBottom: 6 },
    crashSave: { backgroundColor: c.emerald, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 2 },
    crashSaveTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
    sysHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sysTitle: { fontSize: 14, fontWeight: '800', color: c.text, flex: 1, marginRight: 10 },
    sysId: { fontSize: 11, fontFamily: 'monospace', color: c.emerald, marginTop: 2 },
    sysBody: { fontSize: 12.5, color: c.text, fontStyle: 'italic', marginTop: 6 },
    sysMeta: { fontSize: 11.5, color: c.textSecondary, marginTop: 4 },
    /* Préférences par admin (onglet Admin/Support) */
    prefRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    prefLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: c.text },
    prefToggle: { alignItems: 'center', gap: 0 },
    prefToggleLabel: { fontSize: 9.5, color: c.textSecondary, fontWeight: '700' },
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
    diagBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    diagBtnText: { fontSize: 13, fontWeight: '700', color: c.text },
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
    modalSheet: { ...sheetWidth, backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '88%', borderWidth: 1, borderColor: c.cardBorder },
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
