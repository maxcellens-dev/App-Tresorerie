/**
 * Admin — ENVOIS E-MAIL RÉCURRENTS (migration 169).
 *
 * Pendant exact des « Notifications planifiées » : quotidien / hebdomadaire / mensuel, heure locale,
 * même ciblage. La différence est invisible pour l'admin mais essentielle en dessous : une
 * planification n'envoie JAMAIS elle-même — à chaque échéance, le cron engendre une campagne neuve.
 * C'est ce qui donne à chaque occurrence son propre registre d'envois ; sans ça, dès la deuxième
 * échéance, tout le monde passerait pour « déjà servi » et plus personne ne recevrait rien.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, Switch, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { sheetWidth } from '../../lib/ui/appLayout';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import {
  useEmailSchedules, useSaveEmailSchedule, useDeleteEmailSchedule, useToggleEmailSchedule,
  describeEmailRecurrence,
  type EmailSchedule, type EmailAudience, type EmailRecurrence,
} from '../../hooks/admin/useEmailCampaigns';

const AUDIENCES: [EmailAudience, string][] = [
  ['all', 'Tous'], ['premium', 'Premium'], ['free', 'Gratuits'], ['group', 'Un groupe'],
];
const RECURRENCES: [EmailRecurrence, string][] = [
  ['daily', 'Chaque jour'], ['weekly', 'Chaque semaine'], ['monthly', 'Chaque mois'],
];
const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

interface Draft {
  id?: string;
  subject: string; body: string;
  audience: EmailAudience; group_id: string | null;
  recurrence: EmailRecurrence; time_of_day: string;
  day_of_week: number; day_of_month: string; lastDay: boolean;
}

const EMPTY: Draft = {
  subject: '', body: '', audience: 'all', group_id: null,
  recurrence: 'monthly', time_of_day: '09:00', day_of_week: 1, day_of_month: '1', lastDay: false,
};

export default function EmailSchedulesSection({ groups }: { groups: { id: string; name: string }[] }) {
  const COLORS = useAppColors();
  const s = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: schedules = [] } = useEmailSchedules();
  const save = useSaveEmailSchedule();
  const remove = useDeleteEmailSchedule();
  const toggle = useToggleEmailSchedule();
  const [draft, setDraft] = useState<Draft | null>(null);

  const openEdit = (x: EmailSchedule) => setDraft({
    id: x.id, subject: x.subject, body: x.body, audience: x.audience, group_id: x.group_id,
    recurrence: x.recurrence, time_of_day: x.time_of_day,
    day_of_week: x.day_of_week ?? 1,
    day_of_month: String(x.day_of_month ?? 1),
    lastDay: x.day_of_month === 0,
  });

  const commit = () => {
    if (!draft) return;
    if (draft.subject.trim().length < 3) { Alert.alert('Envoi récurrent', 'Donne un objet à l’e-mail.'); return; }
    if (draft.body.trim().length < 5) { Alert.alert('Envoi récurrent', 'Écris le message.'); return; }
    if (!/^\d{2}:\d{2}$/.test(draft.time_of_day)) { Alert.alert('Envoi récurrent', 'Heure invalide (HH:MM).'); return; }
    if (draft.audience === 'group' && !draft.group_id) { Alert.alert('Envoi récurrent', 'Choisis un groupe cible.'); return; }
    save.mutate(
      {
        id: draft.id, subject: draft.subject, body: draft.body,
        audience: draft.audience, group_id: draft.group_id,
        recurrence: draft.recurrence, time_of_day: draft.time_of_day,
        day_of_week: draft.day_of_week,
        // 0 = « dernier jour du mois », résolu au dernier jour réel côté serveur (28/29/30/31).
        day_of_month: draft.lastDay ? 0 : Math.min(31, Math.max(1, parseInt(draft.day_of_month, 10) || 1)),
      },
      { onSuccess: () => setDraft(null), onError: (e: any) => Alert.alert('Échec', e?.message ?? 'Erreur') },
    );
  };

  const confirmDelete = (x: EmailSchedule) => Alert.alert(
    'Supprimer l’envoi récurrent',
    `« ${x.subject} » ne partira plus. Les e-mails déjà envoyés ne sont pas affectés.`,
    [{ text: 'Annuler', style: 'cancel' }, { text: 'Supprimer', style: 'destructive', onPress: () => remove.mutate(x.id) }],
  );

  const audienceLabel = (x: EmailSchedule) =>
    x.audience === 'group' ? (groups.find((g) => g.id === x.group_id)?.name ?? 'Groupe')
      : (AUDIENCES.find(([k]) => k === x.audience)?.[1] ?? 'Tous');

  return (
    <>
      <View style={s.sectionRow}>
        <Text style={s.sectionLabel}>Envois récurrents</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => setDraft({ ...EMPTY })} activeOpacity={0.8}>
          <Ionicons name="add" size={17} color={COLORS.bg} />
          <Text style={s.addBtnTxt}>Ajouter</Text>
        </TouchableOpacity>
      </View>

      {schedules.length === 0 ? (
        <Text style={s.hint}>
          Aucun envoi récurrent. Utile pour une newsletter mensuelle ou un conseil hebdomadaire :
          l’e-mail part tout seul, à l’heure choisie.
        </Text>
      ) : schedules.map((x) => (
        <View key={x.id} style={s.card}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.cardTitle} numberOfLines={1}>{x.subject}</Text>
            <Text style={s.cardSub} numberOfLines={2}>
              {describeEmailRecurrence(x)} · {audienceLabel(x)}
              {x.last_sent_at ? ` · dernier envoi ${new Date(x.last_sent_at).toLocaleDateString('fr-FR')}` : ' · jamais envoyé'}
            </Text>
          </View>
          <Switch
            value={x.active}
            onValueChange={() => toggle.mutate(x)}
            trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
            thumbColor="#ffffff"
          />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Modifier la planification" onPress={() => openEdit(x)} style={s.iconBtn}>
            <Ionicons name="create-outline" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la planification" onPress={() => confirmDelete(x)} style={s.iconBtn}>
            <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
          </TouchableOpacity>
        </View>
      ))}

      {/* ── Création / édition ── */}
      <Modal visible={!!draft} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setDraft(null)}>
        <KeyboardAwareOverlay style={s.overlay} scroll={false}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{draft?.id ? 'Modifier l’envoi récurrent' : 'Nouvel envoi récurrent'}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setDraft(null)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={s.sheetScroll} keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Objet</Text>
              <TextInput
                style={s.input} value={draft?.subject ?? ''}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, subject: v } : d))}
                placeholder="Ex. La lettre Relyka du mois" placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={s.label}>Message</Text>
              <TextInput
                style={[s.input, s.textarea]} value={draft?.body ?? ''}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, body: v } : d))}
                multiline autoCapitalize="none" autoCorrect={false}
                placeholder={'Texte simple (une ligne vide = un paragraphe), ou HTML.\nLe logo, le bouton et le lien de désinscription sont ajoutés autour.'}
                placeholderTextColor={COLORS.textSecondary}
              />

              <Text style={s.label}>Fréquence</Text>
              <View style={s.chipRow}>
                {RECURRENCES.map(([k, lbl]) => (
                  <TouchableOpacity
                    key={k}
                    style={[s.chip, draft?.recurrence === k && s.chipOn]}
                    onPress={() => setDraft((d) => (d ? { ...d, recurrence: k } : d))}
                  >
                    <Text style={[s.chipTxt, draft?.recurrence === k && s.chipTxtOn]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {draft?.recurrence === 'weekly' && (
                <View style={s.chipRow}>
                  {WEEKDAYS.map((lbl, i) => (
                    <TouchableOpacity
                      key={lbl}
                      style={[s.chipSmall, draft?.day_of_week === i && s.chipOn]}
                      onPress={() => setDraft((d) => (d ? { ...d, day_of_week: i } : d))}
                    >
                      <Text style={[s.chipTxt, draft?.day_of_week === i && s.chipTxtOn]}>{lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {draft?.recurrence === 'monthly' && (
                <View style={s.row}>
                  <TextInput
                    style={[s.input, { flex: 1, marginBottom: 0, opacity: draft.lastDay ? 0.45 : 1 }]}
                    value={draft.day_of_month}
                    editable={!draft.lastDay}
                    onChangeText={(v) => setDraft((d) => (d ? { ...d, day_of_month: v.replace(/[^0-9]/g, '') } : d))}
                    keyboardType="number-pad" placeholder="Jour (1-31)" placeholderTextColor={COLORS.textSecondary}
                  />
                  <TouchableOpacity
                    style={[s.chip, draft.lastDay && s.chipOn]}
                    onPress={() => setDraft((d) => (d ? { ...d, lastDay: !d.lastDay } : d))}
                  >
                    <Text style={[s.chipTxt, draft.lastDay && s.chipTxtOn]}>Dernier jour</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={s.label}>Heure</Text>
              <TextInput
                style={s.input} value={draft?.time_of_day ?? ''}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, time_of_day: v } : d))}
                placeholder="09:00" placeholderTextColor={COLORS.textSecondary}
              />

              <Text style={s.label}>Destinataires</Text>
              <View style={s.chipRow}>
                {AUDIENCES.map(([k, lbl]) => (
                  <TouchableOpacity
                    key={k}
                    style={[s.chip, draft?.audience === k && s.chipOn]}
                    onPress={() => setDraft((d) => (d ? { ...d, audience: k } : d))}
                  >
                    <Text style={[s.chipTxt, draft?.audience === k && s.chipTxtOn]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {draft?.audience === 'group' && (
                <View style={s.chipRow}>
                  {groups.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={[s.chip, draft?.group_id === g.id && s.chipOn]}
                      onPress={() => setDraft((d) => (d ? { ...d, group_id: g.id } : d))}
                    >
                      <Text style={[s.chipTxt, draft?.group_id === g.id && s.chipTxtOn]}>{g.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {groups.length === 0 && <Text style={s.hint}>Aucun groupe. Crée-en un dans Utilisateurs → Groupes.</Text>}
                </View>
              )}

              <Text style={s.note}>
                À chaque échéance, une campagne neuve est créée et apparaît dans l’historique. Si le
                quota d’envoi du jour ne suffit pas, elle se met en pause et reprend toute seule.
              </Text>
            </ScrollView>
            <TouchableOpacity style={[s.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={commit} disabled={save.isPending}>
              {save.isPending ? <ActivityIndicator color={COLORS.bg} size="small" /> : <Text style={s.saveTxt}>Enregistrer</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareOverlay>
      </Modal>
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 8 },
    sectionLabel: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.emerald, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
    addBtnTxt: { color: c.bg, fontWeight: '800', fontSize: 12.5 },
    hint: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginBottom: 8 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    cardTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    cardSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    iconBtn: { padding: 5 },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    // Plafond sur la FEUILLE elle-même : une View a `flexShrink: 0`, un parent plafonné ne la
    // rétrécirait pas et le bouton « Enregistrer » sortirait de l'écran.
    sheet: {
      ...sheetWidth, maxHeight: '92%',
      backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderColor: c.cardBorder, padding: 20, paddingBottom: 16,
    },
    sheetScroll: { flexGrow: 0, flexShrink: 1 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    label: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary, marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text },
    textarea: { minHeight: 130, textAlignVertical: 'top', fontSize: 12.5, lineHeight: 18 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    chipSmall: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    chipOn: { backgroundColor: c.emerald, borderColor: c.emerald },
    chipTxt: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },
    chipTxtOn: { color: c.bg, fontWeight: '800' },
    note: { fontSize: 11.5, color: c.textSecondary, fontStyle: 'italic', lineHeight: 16, marginTop: 14 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
    saveTxt: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
