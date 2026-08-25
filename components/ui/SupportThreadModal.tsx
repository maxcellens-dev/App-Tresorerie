/**
 * SupportThreadModal — fil de discussion d'une demande d'assistance.
 * Partagé entre l'écran utilisateur et le panneau admin.
 */
import { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TextInput, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView, KeyboardEvents } from 'react-native-keyboard-controller';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useSupportMessages, useAddSupportMessage, useMarkSupportRead, useSetSupportStatus, useSupportRequest, SUPPORT_MAX_BODY } from '../../hooks/admin/useSupport';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { sheetWidth } from '../../lib/ui/appLayout';

interface Props {
  visible: boolean;
  requestId: string | null;
  subject: string;
  status: 'open' | 'closed';
  role: 'user' | 'admin';
  authorId?: string;
  onClose: () => void;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function SupportThreadModal({ visible, requestId, subject, status, role, authorId, onClose }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: liveRequest } = useSupportRequest(visible ? requestId ?? undefined : undefined);
  const liveStatus: 'open' | 'closed' = liveRequest?.status ?? status;
  const { data: messages = [], isLoading } = useSupportMessages(visible ? requestId ?? undefined : undefined);
  const addMessage = useAddSupportMessage();
  const markRead = useMarkSupportRead();
  const setStatus = useSetSupportStatus();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = useSubmitLock();
  const scrollRef = useRef<ScrollView>(null);
  // Clavier : KeyboardAvoidingView de react-native-keyboard-controller (voir le JSX). La lib attache
  // son écouteur à la fenêtre du Modal (ModalAttachedWatcher) → hauteur juste, bandeaux compris.
  // Ici on recolle seulement le fil en bas quand le clavier s'ouvre.
  useEffect(() => {
    const sub = KeyboardEvents.addListener('keyboardDidShow', () => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => sub.remove();
  }, []);

  /* Marque la demande comme lue à l'ouverture ET à l'arrivée d'un message pendant qu'on la lit.
     Sans la seconde partie, une réponse reçue fil ouvert rallumait la pastille « non lu » sous les
     yeux de la personne en train de la lire — et elle y restait jusqu'à une réouverture. */
  const unreadForMe = role === 'user' ? liveRequest?.user_unread : liveRequest?.admin_unread;
  useEffect(() => {
    if (!visible || !requestId) return;
    if (unreadForMe === false) return; // déjà à jour : pas d'écriture inutile
    markRead.mutate({ requestId, side: role });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, requestId, unreadForMe, messages.length]);

  useEffect(() => {
    if (messages.length) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, [messages.length]);

  /**
   * ENVOI D'UN MESSAGE — le brouillon n'est effacé qu'une fois le message parti.
   *
   * Avant : `mutate(...)` puis `setText('')` dans la foulée. Le champ était donc vidé AVANT toute
   * confirmation, et l'erreur n'était nulle part : un envoi qui échouait (réseau coupé, demande
   * supprimée entre-temps) faisait disparaître le message qu'on venait d'écrire — parfois long,
   * parfois le seul endroit où il existait. Rien à l'écran ne le signalait ; on croyait avoir
   * envoyé.
   *
   * Le verrou est synchrone : `disabled={isPending}` ne s'applique qu'au rendu suivant, donc deux
   * appuis rapprochés envoyaient deux fois le même message.
   */
  const send = async () => {
    const body = text.trim();
    if (!body || !requestId) return;
    if (!submit.acquire()) return;
    setError(null);
    try {
      await addMessage.mutateAsync({ requestId, role, authorId, body });
      setText('');
    } catch (e: any) {
      setError(e?.message?.includes('trop long')
        ? `Message trop long (maximum ${SUPPORT_MAX_BODY} caractères).`
        : "Le message n'est pas parti. Vérifie ta connexion — ton texte est conservé.");
    } finally {
      submit.release();
    }
  };

  const isClosed = liveStatus === 'closed';

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {/* KeyboardAvoidingView de la LIB, à la racine du Modal : sa frame = la fenêtre entière du
          Modal, la seule position où son calcul (onLayout relatif au parent) est juste. Le
          paddingTop '9%' reste sur une View SIMPLE : posé sur le SafeAreaView natif, il était
          avalé et l'en-tête passait sous la barre d'état. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{subject || 'Demande d’assistance'}</Text>
              <View style={[styles.statusPill, { backgroundColor: (isClosed ? COLORS.textSecondary : COLORS.green) + '22' }]}>
                <Text style={[styles.statusText, { color: isClosed ? COLORS.textSecondary : COLORS.green }]}>
                  {isClosed ? 'Clôturée' : 'En cours'}
                </Text>
              </View>
            </View>
            {role === 'admin' && requestId && (
              <TouchableOpacity
                style={styles.statusBtn}
                onPress={() => setStatus.mutate({ requestId, status: isClosed ? 'open' : 'closed' })}
              >
                <Ionicons name={isClosed ? 'refresh-outline' : 'checkmark-done-outline'} size={16} color={COLORS.text} />
                <Text style={styles.statusBtnText}>{isClosed ? 'Rouvrir' : 'Clôturer'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ padding: 4, marginLeft: 8 }}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={{ padding: 16, gap: 10 }} showsVerticalScrollIndicator={false}>
            {isLoading ? (
              <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 24 }} />
            ) : messages.length === 0 ? (
              <Text style={styles.empty}>Aucun message.</Text>
            ) : (
              messages.map((m) => {
                const mine = m.sender_role === role;
                return (
                  <View key={m.id} style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                      {!mine && (
                        <Text style={styles.bubbleAuthor}>{m.sender_role === 'admin' ? 'Assistance' : 'Utilisateur'}</Text>
                      )}
                      {/* La bulle « moi » est peinte à la couleur d'accent, qui est CHOISIE par
                          l'utilisateur (Apparence) : un texte blanc en dur y devenait illisible dès
                          que la teinte était claire — jaune, cyan, lime. */}
                      <Text style={[styles.bubbleText, mine && { color: COLORS.onAccent }]}>{m.body}</Text>
                      <Text style={[styles.bubbleTime, mine && { color: COLORS.onAccent, opacity: 0.7 }]}>{formatTime(m.created_at)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* SafeAreaView NATIF (edges bottom) : mesure les insets de SA fenêtre (celle du Modal) →
              la saisie reste au-dessus de la barre de navigation, clavier fermé comme ouvert.
              (useSafeAreaInsets lirait le provider de la fenêtre PRINCIPALE : toujours faux ici.) */}
          <SafeAreaView edges={['bottom']}>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={(v) => { setText(v); if (error) setError(null); }}
                placeholder={isClosed ? 'Répondre rouvre la demande…' : 'Ton message…'}
                placeholderTextColor={COLORS.textSecondary}
                multiline
                maxLength={SUPPORT_MAX_BODY}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 350)}
              />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Envoyer" style={[styles.sendBtn, (!text.trim() || addMessage.isPending) && { opacity: 0.5 }]} onPress={send} disabled={!text.trim() || addMessage.isPending}>
                <Ionicons name="send" size={18} color={COLORS.onAccent} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', paddingTop: '9%' },
    // flex:1 (au lieu d'une hauteur fixe) → la feuille se rétrécit par le bas quand le clavier
    // remonte (KeyboardAvoidingView) ou que la barre de navigation existe (SafeAreaView bottom).
    sheet: { ...sheetWidth, flex: 1, backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder },
    header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: c.cardBorder, gap: 8 },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
    statusText: { fontSize: 11, fontWeight: '700' },
    statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    statusBtnText: { fontSize: 12, fontWeight: '700', color: c.text },
    thread: { flex: 1 },
    empty: { color: c.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 14 },
    bubbleRow: { flexDirection: 'row' },
    bubbleRowMine: { justifyContent: 'flex-end' },
    bubbleRowOther: { justifyContent: 'flex-start' },
    bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
    bubbleMine: { backgroundColor: c.emerald, borderBottomRightRadius: 4 },
    bubbleOther: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderBottomLeftRadius: 4 },
    bubbleAuthor: { fontSize: 11, fontWeight: '700', color: c.emerald },
    bubbleText: { fontSize: 14, color: c.text, lineHeight: 19 },
    bubbleTime: { fontSize: 10, color: c.textSecondary, marginTop: 2, alignSelf: 'flex-end' },
    error: { fontSize: 12.5, fontWeight: '600', color: c.danger, paddingHorizontal: 14, paddingTop: 10, lineHeight: 17 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderColor: c.cardBorder },
    input: { flex: 1, maxHeight: 120, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: Platform.OS === 'web' ? 10 : 8, fontSize: 15, color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
  });
}
