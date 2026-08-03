/**
 * Admin — E-MAILS PONCTUELS.
 *
 * Écrire un message, voir COMBIEN de personnes le recevront, cibler comme les notifications push
 * (tous / Premium / gratuits / un groupe), et l'envoyer maintenant ou à une date choisie.
 *
 * Deux garde-fous assumés :
 *  • le nombre de destinataires est compté CÔTÉ SERVEUR (RPC email_audience_count) — l'admin n'a
 *    pas à lire tout le parc pour afficher un chiffre ;
 *  • l'admin écrit du TEXTE, jamais du HTML : la mise en forme (logo, bouton, pied de page avec le
 *    lien de désinscription) est appliquée par l'Edge Function, identique pour tous les envois.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform, Alert, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import ScreenGradient from '../../../../components/ScreenGradient';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { supabase } from '../../../../lib/supabase';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../../../lib/dateUtils';
import {
  useEmailCampaigns, useEmailAudienceCount, useSaveEmailCampaign,
  useSendEmailCampaign, useDeleteEmailCampaign,
  type EmailAudience,
} from '../../../../hooks/useEmailCampaigns';
// Le MÊME rendu que celui de l'Edge Function : l'aperçu montre donc l'e-mail réel, pas une imitation.
import {
  renderRelykaEmail, looksLikeHtml, EMAIL_TEMPLATES,
} from '../../../../supabase/functions/_shared/emailTemplate';

const AUDIENCES: [EmailAudience, string][] = [
  ['all', 'Tous'], ['premium', 'Premium'], ['free', 'Gratuits'], ['group', 'Un groupe'],
];

export default function AdminEmails() {
  const COLORS = useAppColors();
  const s = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<EmailAudience>('all');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [dateInput, setDateInput] = useState(formatDateFrench(todayISO()));
  const [timeInput, setTimeInput] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  /** Charge un gabarit — en écrasant, mais jamais sans prévenir si quelque chose est déjà écrit. */
  const applyTemplate = (t: typeof EMAIL_TEMPLATES[number]) => {
    const load = () => { setSubject(t.subject); setBody(t.body); };
    if (!subject.trim() && !body.trim()) { load(); return; }
    Alert.alert(
      'Remplacer ce que tu as écrit ?',
      `Le gabarit « ${t.label} » va prendre la place de l’objet et du message actuels.`,
      [{ text: 'Annuler', style: 'cancel' }, { text: 'Remplacer', style: 'destructive', onPress: load }],
    );
  };

  const groups = useQuery({
    queryKey: ['user_groups_min'],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('user_groups').select('id, name').order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: isAdmin,
  });

  const { data: audienceCount = 0, isLoading: countLoading } = useEmailAudienceCount(audience, groupId);
  const { data: campaigns = [] } = useEmailCampaigns();
  const saveCampaign = useSaveEmailCampaign();
  const sendCampaign = useSendEmailCampaign();
  const deleteCampaign = useDeleteEmailCampaign();

  if (!isAdmin) {
    return <View style={s.root}><SafeAreaView style={s.safe} edges={['top']}><Text style={s.text}>Accès réservé aux administrateurs.</Text></SafeAreaView></View>;
  }

  /** Date/heure d'envoi en ISO, ou null pour un envoi immédiat. */
  const scheduledAt = (): string | null => {
    if (!schedule) return null;
    const iso = parseDateFromFrench(dateInput);
    if (!iso) return null;
    const [h, m] = timeInput.split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(h)) return null;
    const d = new Date(`${iso}T00:00:00`);
    d.setHours(h, Number.isNaN(m) ? 0 : m, 0, 0);
    return d.toISOString();
  };

  const bodyIsHtml = looksLikeHtml(body);
  /** L'e-mail COMPLET tel qu'il partira (lien de désinscription d'exemple). */
  const previewHtml = useMemo(
    () => renderRelykaEmail({
      subject: subject.trim() || '(objet à écrire)',
      body,
      unsubUrl: 'https://relyka.app/desinscription?t=apercu',
    }),
    [subject, body],
  );

  const canSubmit = subject.trim().length > 2 && body.trim().length > 5
    && (audience !== 'group' || !!groupId)
    && (!schedule || !!scheduledAt());

  const reset = () => { setSubject(''); setBody(''); setSchedule(false); };

  async function handleSend(now: boolean) {
    if (!canSubmit || busy) return;
    const when = now ? null : scheduledAt();
    setBusy(true);
    try {
      const saved = await saveCampaign.mutateAsync({
        subject, body, audience, group_id: groupId, scheduled_at: when,
      });
      if (now) {
        const r = await sendCampaign.mutateAsync(saved.id);
        Alert.alert('Envoyé', `${r.sent} e-mail(s) partis.`);
      } else {
        Alert.alert('Programmé', `L'envoi partira le ${formatDateFrench(when!.slice(0, 10))} à ${timeInput}.`);
      }
      reset();
    } catch (e: any) {
      Alert.alert('Échec', e?.message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const confirmSendNow = () => {
    Alert.alert(
      `Envoyer à ${audienceCount} personne(s) ?`,
      'Un e-mail parti ne se rattrape pas. Vérifie l’objet et le message.',
      [{ text: 'Annuler', style: 'cancel' }, { text: 'Envoyer', style: 'destructive', onPress: () => handleSend(true) }],
    );
  };

  return (
    <View style={s.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={s.safe} edges={['top']}>
        <TouchableOpacity style={s.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={s.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={s.title}>E-mails</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Points de départ — pas des carcans : tout reste modifiable ensuite. */}
          <Text style={s.label}>Partir d’un gabarit</Text>
          <View style={s.tplRow}>
            {EMAIL_TEMPLATES.map((t) => (
              <TouchableOpacity key={t.id} style={s.tplCard} onPress={() => applyTemplate(t)} activeOpacity={0.8}>
                <Ionicons name="document-text-outline" size={16} color={COLORS.emerald} />
                <Text style={s.tplName}>{t.label}</Text>
                <Text style={s.tplHint}>{t.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Objet</Text>
          <TextInput style={s.input} value={subject} onChangeText={setSubject} placeholder="Ex. Nouveautés de septembre" placeholderTextColor={COLORS.textSecondary} />

          <View style={s.labelRow}>
            <Text style={[s.label, { marginTop: 12 }]}>Message</Text>
            <View style={s.modeTag}>
              <Ionicons name={bodyIsHtml ? 'code-slash-outline' : 'text-outline'} size={12} color={COLORS.textSecondary} />
              <Text style={s.modeTagTxt}>{bodyIsHtml ? 'HTML' : 'Texte simple'}</Text>
            </View>
          </View>
          <TextInput
            style={[s.input, s.textarea, bodyIsHtml && s.textareaMono]} value={body} onChangeText={setBody} multiline
            placeholder={'Écris en texte simple (une ligne vide = un paragraphe), ou colle du HTML pour mettre en forme : titres, listes, gras, encadrés.\n\nLe logo, le bouton et le lien de désinscription sont ajoutés automatiquement autour.'}
            placeholderTextColor={COLORS.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {/* Le rendu réel, pas une approximation : même fonction que celle qui envoie. */}
          <TouchableOpacity
            style={[s.previewBtn, !body.trim() && { opacity: 0.45 }]}
            disabled={!body.trim()}
            onPress={() => setPreview(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="eye-outline" size={16} color={COLORS.emerald} />
            <Text style={s.previewTxt}>Aperçu de l’e-mail</Text>
          </TouchableOpacity>

          <Text style={s.label}>Destinataires</Text>
          <View style={s.chipRow}>
            {AUDIENCES.map(([key, lbl]) => (
              <TouchableOpacity key={key} style={[s.chip, audience === key && s.chipOn]} onPress={() => setAudience(key)}>
                <Text style={[s.chipTxt, audience === key && s.chipTxtOn]}>{lbl}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {audience === 'group' && (
            <View style={s.chipRow}>
              {(groups.data ?? []).map((g) => (
                <TouchableOpacity key={g.id} style={[s.chip, groupId === g.id && s.chipOn]} onPress={() => setGroupId(g.id)}>
                  <Text style={[s.chipTxt, groupId === g.id && s.chipTxtOn]}>{g.name}</Text>
                </TouchableOpacity>
              ))}
              {(groups.data ?? []).length === 0 && <Text style={s.hint}>Aucun groupe. Crée-en un dans Utilisateurs → Groupes.</Text>}
            </View>
          )}

          {/* Le nombre réel de destinataires : ceux qui acceptent les e-mails ET ont une adresse. */}
          <View style={s.countBox}>
            <Ionicons name="people-outline" size={17} color={COLORS.emerald} />
            <Text style={s.countText}>
              {countLoading ? 'Calcul…' : `${audienceCount} destinataire${audienceCount > 1 ? 's' : ''}`}
              <Text style={s.countSub}>{'  '}(e-mails acceptés et adresse renseignée)</Text>
            </Text>
          </View>

          <TouchableOpacity style={s.switchRow} onPress={() => setSchedule((v) => !v)} activeOpacity={0.75}>
            <Ionicons name={schedule ? 'checkbox' : 'square-outline'} size={20} color={schedule ? COLORS.emerald : COLORS.textSecondary} />
            <Text style={s.switchLabel}>Programmer l’envoi</Text>
          </TouchableOpacity>
          {schedule && (
            <View style={s.scheduleRow}>
              <TextInput style={[s.input, { flex: 2, marginBottom: 0 }]} value={dateInput} onChangeText={setDateInput} placeholder="jj-mm-aaaa" placeholderTextColor={COLORS.textSecondary} />
              <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={timeInput} onChangeText={setTimeInput} placeholder="09:00" placeholderTextColor={COLORS.textSecondary} />
            </View>
          )}

          <View style={s.actions}>
            {schedule ? (
              <TouchableOpacity style={[s.primaryBtn, (!canSubmit || busy) && { opacity: 0.45 }]} disabled={!canSubmit || busy} onPress={() => handleSend(false)}>
                {busy ? <ActivityIndicator color={COLORS.bg} /> : <><Ionicons name="time-outline" size={17} color={COLORS.bg} /><Text style={s.primaryTxt}>Programmer</Text></>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[s.primaryBtn, (!canSubmit || busy) && { opacity: 0.45 }]} disabled={!canSubmit || busy} onPress={confirmSendNow}>
                {busy ? <ActivityIndicator color={COLORS.bg} /> : <><Ionicons name="send" size={17} color={COLORS.bg} /><Text style={s.primaryTxt}>Envoyer maintenant</Text></>}
              </TouchableOpacity>
            )}
          </View>

          {/* Historique — c'est là qu'on voit qu'un envoi programmé est bien parti, ou a échoué. */}
          <Text style={[s.label, { marginTop: 26 }]}>Historique</Text>
          {campaigns.length === 0 && <Text style={s.hint}>Aucune campagne pour l’instant.</Text>}
          {campaigns.map((c) => (
            <View key={c.id} style={s.card}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{c.subject}</Text>
                <Text style={s.cardSub} numberOfLines={1}>
                  {c.status === 'sent' ? `Envoyé · ${c.recipients_count} destinataire(s)`
                    : c.status === 'scheduled' ? `Programmé · ${c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('fr-FR') : ''}`
                    : c.status === 'failed' ? `Échec · ${c.error ?? ''}`
                    : c.status === 'sending' ? 'Envoi en cours…' : 'Brouillon'}
                </Text>
              </View>
              {c.status !== 'sent' && c.status !== 'sending' && (
                <TouchableOpacity onPress={() => deleteCampaign.mutate(c.id)} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>

      {/* APERÇU — rendu dans une iframe isolée sur le web : les styles de l'e-mail ne peuvent alors
          ni fuir dans l'app, ni être écrasés par elle. Sur mobile natif il n'y a pas de moteur de
          rendu HTML embarqué (pas de WebView dans le projet) : plutôt que de bricoler une
          approximation qui mentirait sur le résultat, on l'annonce et on montre le HTML brut. */}
      <Modal visible={preview} transparent animationType="fade" onRequestClose={() => setPreview(false)}>
        <View style={s.pvOverlay}>
          <View style={s.pvSheet}>
            <View style={s.pvHead}>
              <Text style={s.pvTitle}>Aperçu de l’e-mail</Text>
              <TouchableOpacity onPress={() => setPreview(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            {Platform.OS === 'web' ? (
              React.createElement('iframe', {
                srcDoc: previewHtml,
                title: 'Aperçu',
                style: { flex: 1, width: '100%', border: 'none', borderRadius: 12, background: '#F4EFE6' },
              })
            ) : (
              <ScrollView style={{ flex: 1 }}>
                <Text style={s.pvNote}>
                  L’aperçu visuel n’est disponible que depuis un navigateur. Voici le contenu qui sera envoyé :
                </Text>
                <Text style={s.pvCode} selectable>{previewHtml}</Text>
              </ScrollView>
            )}
            <Text style={s.pvFoot}>
              Rendu exact de l’envoi, lien de désinscription compris (ici d’exemple — chaque destinataire reçoit le sien).
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 22, fontWeight: '800', color: c.text, marginBottom: 12 },
    text: { color: c.text, padding: 20 },
    label: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 6, marginTop: 12 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 4,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    textarea: { minHeight: 150, textAlignVertical: 'top' },
    // HTML : chasse fixe, plus petit — on lit du balisage, pas de la prose.
    textareaMono: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : Platform.OS === 'android' ? 'monospace' : 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12.5, lineHeight: 18, minHeight: 220,
    },
    labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    modeTag: {
      flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12,
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    },
    modeTagTxt: { fontSize: 10.5, fontWeight: '700', color: c.textSecondary },

    // Gabarits
    tplRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    tplCard: {
      flexGrow: 1, flexBasis: 150, gap: 3, padding: 12, borderRadius: 12,
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    },
    tplName: { fontSize: 13, fontWeight: '800', color: c.text },
    tplHint: { fontSize: 11, color: c.textSecondary, lineHeight: 15 },

    // Aperçu
    previewBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10,
      paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: c.emerald + '66', backgroundColor: c.emerald + '12',
    },
    previewTxt: { fontSize: 13.5, fontWeight: '700', color: c.emerald },
    pvOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', padding: 16, justifyContent: 'center' },
    pvSheet: {
      flex: 1, maxWidth: 700, width: '100%', alignSelf: 'center',
      backgroundColor: c.bg, borderRadius: 18, borderWidth: 1, borderColor: c.cardBorder, padding: 14, gap: 10,
    },
    pvHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pvTitle: { fontSize: 17, fontWeight: '800', color: c.text },
    pvNote: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginBottom: 10 },
    pvCode: { fontSize: 11, color: c.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    pvFoot: { fontSize: 11, color: c.textSecondary, lineHeight: 16, textAlign: 'center' },
    chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
    chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    chipOn: { backgroundColor: c.emerald, borderColor: c.emerald },
    chipTxt: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary },
    chipTxtOn: { color: c.bg },
    countBox: {
      flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10, padding: 12,
      borderRadius: 12, borderWidth: 1, borderColor: c.emerald + '44', backgroundColor: c.emerald + '12',
    },
    countText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: c.text },
    countSub: { fontSize: 11.5, fontWeight: '500', color: c.textSecondary },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16 },
    switchLabel: { fontSize: 14, color: c.text, fontWeight: '600' },
    scheduleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    actions: { marginTop: 18 },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15,
    },
    primaryTxt: { fontSize: 15.5, fontWeight: '800', color: c.bg },
    hint: { fontSize: 12.5, color: c.textSecondary, marginTop: 6 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 13, marginTop: 8,
    },
    cardTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    cardSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });
}
