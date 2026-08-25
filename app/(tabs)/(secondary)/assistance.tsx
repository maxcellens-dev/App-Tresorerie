import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Platform, ActivityIndicator } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useAuth } from '../../../contexts/AuthContext';
import { useMySupportRequests, useCreateSupportRequest, SUPPORT_MAX_BODY, SUPPORT_MAX_SUBJECT, type SupportRequest } from '../../../hooks/admin/useSupport';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import { useFeatureFlags } from '../../../hooks/config/useFeatureFlags';
import { sheetWidth, useSheetBottomPadding } from '../../../lib/ui/appLayout';
import SupportThreadModal from '../../../components/ui/SupportThreadModal';
import KeyboardAwareOverlay from '../../../components/layout/KeyboardAwareOverlay';


/** `?? ''` : une date manquante affichait « 1 janv. 1970 » plutôt que rien. */
function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Questions fréquentes — au tutoiement, et à jour des écrans réels.
 *
 * Volontairement courtes et vérifiées : chaque réponse pointe un endroit qui existe VRAIMENT dans
 * l'app d'aujourd'hui. Une FAQ qui décrit une version précédente envoie l'utilisateur chercher un
 * réglage introuvable, puis écrire à l'assistance pour la même raison.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Comment ajouter un compte ?',
    a: 'Ouvre l’onglet « Comptes », puis touche « Compte » en haut pour en créer un nouveau.',
  },
  {
    q: 'À quoi correspond le montant du Pilotage ?',
    a: 'Il part de ton solde courant et retire ce qui est déjà engagé : dépenses fixes à venir, budget variable, projets en cours, et ta marge de sécurité. Cette marge se règle depuis le Pilotage, sur la carte concernée.',
  },
  {
    q: 'Les opérations récurrentes sont-elles automatiques ?',
    a: 'Oui. Une fois créée, une opération récurrente se reporte toute seule sur les mois suivants dans ta trésorerie et ta projection.',
  },
  {
    q: 'Comment changer les couleurs de l’app ?',
    a: 'Profil › Apparence : mode clair ou sombre, couleur d’accent, et les cosmétiques que tu as débloqués.',
  },
];

export default function AssistanceScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(32);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { user, isImpersonating } = useAuth();
  const { data: requests = [], isLoading, isError } = useMySupportRequests(user?.id);
  const createRequest = useCreateSupportRequest(user?.id);
  /* Verrou de soumission : `disabled={isPending}` ne prend effet qu'au rendu SUIVANT, donc deux
     appuis rapprochés créaient DEUX demandes identiques — que l'équipe devait ensuite démêler. */
  const submit = useSubmitLock();
  /* Horaires et délai de réponse : administrés. Sans valeur saisie, la carte ne s'affiche pas —
     mieux vaut ne rien promettre que promettre à tort. */
  const { data: flags } = useFeatureFlags();
  const supportHours = (flags?.support_hours ?? '').trim();
  const supportDelay = (flags?.support_response_time ?? '').trim();

  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<SupportRequest | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  /* Consultation d'un autre compte : les demandes lues appartiennent à la personne visitée, et
     écrire ici créerait une demande EN SON NOM. On regarde, on n'écrit pas. */
  const readOnly = isImpersonating;

  // Une demande clôturée ET dont la réponse a été vue (user_unread = false) part aux archives.
  const isArchived = (r: SupportRequest) => r.status === 'closed' && !r.user_unread;
  const archived = requests.filter(isArchived);
  const active = requests.filter((r) => !isArchived(r));
  const visibleList = showArchived ? archived : active;

  const submitNew = async () => {
    if (!body.trim() || readOnly) return;
    if (!submit.acquire()) return;
    setSendError(null);
    try {
      const req = await createRequest.mutateAsync({ subject, body });
      /* Le brouillon n'est effacé qu'APRÈS confirmation du serveur. Il était vidé d'abord : un
         envoi qui échouait emportait avec lui le texte qu'on venait d'écrire, sans un mot. */
      setSubject(''); setBody(''); setShowNew(false);
      setOpenRequest(req);
    } catch (e: any) {
      // L'échec était avalé par un `catch` vide : on restait devant un bouton qui ne faisait rien.
      setSendError(e?.message?.includes('Trop de demandes')
        ? 'Trop de demandes ouvertes aujourd’hui. Réponds plutôt dans une demande existante.'
        : "L'envoi a échoué. Vérifie ta connexion — ton message est conservé.");
    } finally {
      submit.release();
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right']}>
        <ScreenHeader title="Assistance" onBack={goBack} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Tutoiement : c'est la règle dans toute l'application — cette page était restée au
              vouvoiement (« Échangez », « Allez dans l'onglet », « appuyez sur »). */}
          <Text style={styles.subtitle}>
            Une question, un souci, une idée ? Écris-nous directement depuis l'app, on te répond ici.
          </Text>

          {readOnly && (
            <View style={styles.notice}>
              <Ionicons name="eye-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.noticeText}>
                Consultation seule : tu es connecté en tant qu'un autre utilisateur. Écrire ici
                créerait une demande en son nom.
              </Text>
            </View>
          )}

          {/* Contacter l'assistance */}
          <View style={styles.card}>
            <Ionicons name="chatbubbles-outline" size={28} color={COLORS.emerald} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>Besoin d'aide ?</Text>
            <Text style={styles.cardText}>
              Décris ta demande : on te répond directement ici, et tu es prévenu dès qu'une réponse
              arrive.
            </Text>
            <TouchableOpacity
              style={[styles.btn, readOnly && { opacity: 0.45 }]}
              onPress={() => { setSendError(null); setShowNew(true); }}
              disabled={readOnly}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={COLORS.onAccent} />
              <Text style={styles.btnText}>Contacter l'assistance</Text>
            </TouchableOpacity>
          </View>

          {/* Mes demandes. `isError` fait partie des cas où la carte doit apparaître : sans lui,
              une lecture en échec laissait une page SANS aucune mention de tes demandes — ni liste,
              ni explication. On croyait n'en avoir aucune. */}
          {(isLoading || isError || requests.length > 0) && (
            <View style={styles.card}>
              <View style={styles.reqHeaderRow}>
                <Text style={[styles.cardTitle, { textAlign: 'left', marginBottom: 0 }]}>{showArchived ? 'Archives' : 'Mes demandes'}</Text>
                {(archived.length > 0 || showArchived) && (
                  <TouchableOpacity style={styles.archiveBtn} onPress={() => setShowArchived((v) => !v)} activeOpacity={0.7}>
                    <Ionicons name={showArchived ? 'arrow-back' : 'archive-outline'} size={14} color={COLORS.emerald} />
                    <Text style={styles.archiveBtnText}>{showArchived ? 'Demandes' : `Archives${archived.length ? ` (${archived.length})` : ''}`}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {isLoading ? (
                <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 12 }} />
              ) : isError ? (
                /* « Aucune demande » est une AFFIRMATION : on ne la fait pas quand la lecture a
                   échoué — quelqu'un qui attend une réponse croirait sa demande perdue. */
                <Text style={[styles.reqEmpty, { color: COLORS.danger }]}>
                  Tes demandes n'ont pas pu être chargées. Vérifie ta connexion.
                </Text>
              ) : visibleList.length === 0 ? (
                <Text style={styles.reqEmpty}>{showArchived ? 'Aucune demande archivée.' : 'Aucune demande en cours.'}</Text>
              ) : (
                visibleList.map((r) => (
                  <TouchableOpacity key={r.id} style={styles.reqRow} activeOpacity={0.7} onPress={() => setOpenRequest(r)} accessibilityRole="button">
                    <View style={[styles.reqDot, { backgroundColor: r.status === 'closed' ? COLORS.textSecondary : COLORS.green }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reqSubject} numberOfLines={1}>{r.subject}</Text>
                      <Text style={styles.reqMeta}>{r.status === 'closed' ? 'Clôturée' : 'En cours'} · {formatDate(r.last_message_at)}</Text>
                    </View>
                    {r.user_unread && <View style={styles.unreadBadge}><Text style={styles.unreadText}>1</Text></View>}
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {/* ── FAQ ──────────────────────────────────────────────────────────────────────────
              Trois réponses écrites au VOUVOIEMENT (« Allez dans l'onglet », « appuyez sur »), et
              l'une d'elles envoyait vers un réglage qui n'y est plus : la marge de sécurité a
              quitté les Paramètres pour le Pilotage. Une aide qui indique le mauvais endroit fait
              perdre plus de temps qu'elle n'en fait gagner — et finit en demande d'assistance. */}
          <View style={styles.card}>
            <Ionicons name="help-circle-outline" size={28} color={COLORS.blue} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>Questions fréquentes</Text>
            {FAQ.map((f) => (
              <View key={f.q} style={styles.faqItem}>
                <Text style={styles.faqQ}>{f.q}</Text>
                <Text style={styles.faqA}>{f.a}</Text>
              </View>
            ))}
          </View>

          {/* Disponibilité de l'équipe : administrée (Admin › Mise à jour de l'app), parce qu'un
              engagement écrit en dur dans le code devient faux le jour où il change — et qu'il
              faut alors publier une version de l'app pour corriger une phrase. */}
          {(supportHours || supportDelay) && (
            <View style={styles.card}>
              <Ionicons name="time-outline" size={28} color={COLORS.orange} style={{ alignSelf: 'center', marginBottom: 12 }} />
              <Text style={styles.cardTitle}>Nos disponibilités</Text>
              <Text style={[styles.cardText, { textAlign: 'center' }]}>
                {[supportHours, supportDelay].filter(Boolean).join('\n')}
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Nouvelle demande */}
      <Modal visible={showNew} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowNew(false)}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
          <View style={[styles.modalBox, { paddingBottom: sheetPad }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Contacter l'assistance</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setShowNew(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>Sujet (optionnel)</Text>
            <TextInput
              style={styles.modalInput}
              value={subject}
              onChangeText={setSubject}
              placeholder="Ex. Problème de synchronisation"
              placeholderTextColor={COLORS.textSecondary}
              maxLength={SUPPORT_MAX_SUBJECT}
            />
            <View style={styles.labelRow}>
              <Text style={styles.modalLabel}>Ton message</Text>
              {/* Le compteur n'apparaît qu'à l'approche de la limite : le serveur refuse au-delà,
                  et découvrir un plafond au moment de l'envoi est la pire façon de l'apprendre. */}
              {body.length > SUPPORT_MAX_BODY - 500 && (
                <Text style={[styles.counter, body.length >= SUPPORT_MAX_BODY && { color: COLORS.danger }]}>
                  {body.length} / {SUPPORT_MAX_BODY}
                </Text>
              )}
            </View>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              value={body}
              onChangeText={setBody}
              placeholder="Décris ta demande en détail…"
              placeholderTextColor={COLORS.textSecondary}
              multiline
              autoFocus
              maxLength={SUPPORT_MAX_BODY}
            />
            {!!sendError && <Text style={styles.modalError}>{sendError}</Text>}
            <TouchableOpacity
              style={[styles.modalSend, (!body.trim() || createRequest.isPending) && { opacity: 0.5 }]}
              onPress={submitNew}
              disabled={!body.trim() || createRequest.isPending}
              accessibilityRole="button"
              accessibilityState={{ disabled: !body.trim() || createRequest.isPending }}
            >
              {createRequest.isPending ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.modalSendText}>Envoyer la demande</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      <SupportThreadModal
        visible={!!openRequest}
        requestId={openRequest?.id ?? null}
        subject={openRequest?.subject ?? ''}
        status={openRequest?.status ?? 'open'}
        role="user"
        authorId={user?.id}
        onClose={() => setOpenRequest(null)}
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 16 },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: c.textSecondary },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { fontSize: 11, fontWeight: '700', color: c.textSecondary, marginTop: 8 },
  modalError: { fontSize: 12.5, fontWeight: '600', color: c.danger, marginTop: 10, lineHeight: 17 },
  card: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 20, marginBottom: 16, gap: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 8, textAlign: 'center' },
  cardText: { fontSize: 14, color: c.textSecondary, lineHeight: 20, textAlign: 'center' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.emerald, paddingVertical: 13, borderRadius: 12, marginTop: 14,
  },
  btnText: { fontSize: 15, fontWeight: '700', color: c.onAccent },
  reqHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  archiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: c.emerald + '44', backgroundColor: c.emerald + '14' },
  archiveBtnText: { fontSize: 12, fontWeight: '700', color: c.emerald },
  reqEmpty: { fontSize: 13, color: c.textSecondary, paddingVertical: 14, textAlign: 'center' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: c.cardBorder },
  reqDot: { width: 8, height: 8, borderRadius: 4 },
  reqSubject: { fontSize: 14, fontWeight: '600', color: c.text },
  reqMeta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  unreadBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  faqItem: { marginTop: 12, gap: 4 },
  faqQ: { fontSize: 14, fontWeight: '600', color: c.text },
  faqA: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  // Modal nouvelle demande
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalBox: { ...sheetWidth, backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, padding: 22, paddingBottom: 32, gap: 6 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  modalLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginTop: 8, marginBottom: 6 },
  modalInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  modalTextarea: { minHeight: 110, textAlignVertical: 'top' },
  modalSend: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  modalSendText: { fontSize: 16, fontWeight: '700', color: c.onAccent },
});
}
