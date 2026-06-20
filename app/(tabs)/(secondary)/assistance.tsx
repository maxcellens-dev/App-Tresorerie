import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import ScreenHeader from '../../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/useAppColors';
import { useNavBack } from '../../../hooks/useNavBack';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { useMySupportRequests, useCreateSupportRequest, type SupportRequest } from '../../../hooks/useSupport';
import SupportThreadModal from '../../../components/SupportThreadModal';


function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AssistanceScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: requests = [], isLoading } = useMySupportRequests(user?.id);
  const createRequest = useCreateSupportRequest(user?.id, profile?.email ?? user?.email);

  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [openRequest, setOpenRequest] = useState<SupportRequest | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Une demande clôturée ET dont la réponse a été vue (user_unread = false) part aux archives.
  const isArchived = (r: SupportRequest) => r.status === 'closed' && !r.user_unread;
  const archived = requests.filter(isArchived);
  const active = requests.filter((r) => !isArchived(r));
  const visibleList = showArchived ? archived : active;

  const submitNew = async () => {
    if (!body.trim()) return;
    try {
      const req = await createRequest.mutateAsync({ subject, body });
      setSubject(''); setBody(''); setShowNew(false);
      setOpenRequest(req);
    } catch { /* affiché via état réseau */ }
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScreenHeader title="Assistance" onBack={goBack} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.subtitle}>
            Une question, un bug ou une suggestion ? Échangez directement avec notre équipe depuis l'app.
          </Text>

          {/* Contacter l'assistance */}
          <View style={styles.card}>
            <Ionicons name="chatbubbles-outline" size={28} color={COLORS.emerald} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>Besoin d'aide ?</Text>
            <Text style={styles.cardText}>
              Décrivez votre demande, nous vous répondons directement ici. Vous serez notifié des réponses.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={() => setShowNew(true)} activeOpacity={0.85}>
              <Ionicons name="add" size={18} color={COLORS.bg} />
              <Text style={styles.btnText}>Contacter l'assistance</Text>
            </TouchableOpacity>
          </View>

          {/* Mes demandes */}
          {(isLoading || requests.length > 0) && (
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
              ) : visibleList.length === 0 ? (
                <Text style={styles.reqEmpty}>{showArchived ? 'Aucune demande archivée.' : 'Aucune demande en cours.'}</Text>
              ) : (
                visibleList.map((r) => (
                  <TouchableOpacity key={r.id} style={styles.reqRow} activeOpacity={0.7} onPress={() => setOpenRequest(r)}>
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

          {/* FAQ */}
          <View style={styles.card}>
            <Ionicons name="help-circle-outline" size={28} color={COLORS.blue} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>FAQ</Text>
            <View style={styles.faqItem}>
              <Text style={styles.faqQ}>Comment ajouter un compte ?</Text>
              <Text style={styles.faqA}>Allez dans l'onglet "Comptes" puis appuyez sur le bouton "Compte" pour créer un nouveau compte bancaire.</Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQ}>Comment fonctionne le "Budget libre à allouer" ?</Text>
              <Text style={styles.faqA}>Ce montant prend votre solde courant et déduit les dépenses à venir (fixes, variables prévues, allocations projets et objectifs) ainsi qu'une marge de sécurité configurable dans les Paramètres.</Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQ}>Les transactions récurrentes sont-elles automatiques ?</Text>
              <Text style={styles.faqA}>Oui, une fois créée, une transaction récurrente se projette automatiquement sur les mois futurs dans votre plan de trésorerie.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Ionicons name="time-outline" size={28} color={COLORS.orange} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.cardTitle}>Horaires de support</Text>
            <Text style={[styles.cardText, { textAlign: 'center' }]}>
              Lundi - Vendredi : 9h00 - 18h00 (CET){'\n'}
              Temps de réponse moyen : 24h
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Nouvelle demande */}
      <Modal visible={showNew} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowNew(false)}>
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Contacter l'assistance</Text>
              <TouchableOpacity onPress={() => setShowNew(false)} style={{ padding: 4 }}>
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
            />
            <Text style={styles.modalLabel}>Votre message</Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              value={body}
              onChangeText={setBody}
              placeholder="Décrivez votre demande en détail…"
              placeholderTextColor={COLORS.textSecondary}
              multiline
              autoFocus
            />
            <TouchableOpacity
              style={[styles.modalSend, (!body.trim() || createRequest.isPending) && { opacity: 0.5 }]}
              onPress={submitNew}
              disabled={!body.trim() || createRequest.isPending}
            >
              {createRequest.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.modalSendText}>Envoyer la demande</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
  pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  backBtn: { padding: 4, marginRight: 12 },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
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
  btnText: { fontSize: 15, fontWeight: '700', color: c.bg },
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
  modalBox: { backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, padding: 22, paddingBottom: 32, gap: 6 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  modalLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginTop: 8, marginBottom: 6 },
  modalInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  modalTextarea: { minHeight: 110, textAlignVertical: 'top' },
  modalSend: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  modalSendText: { fontSize: 16, fontWeight: '700', color: c.bg },
});
}
