/**
 * SupportThreadModal — fil de discussion d'une demande d'assistance.
 * Partagé entre l'écran utilisateur et le panneau admin.
 */
import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useSupportMessages, useAddSupportMessage, useMarkSupportRead, useSetSupportStatus, useSupportRequest } from '../hooks/useSupport';

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
  const scrollRef = useRef<ScrollView>(null);

  // Marque la demande comme lue à l'ouverture (efface le drapeau du rôle courant).
  useEffect(() => {
    if (visible && requestId) markRead.mutate({ requestId, side: role });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, requestId]);

  useEffect(() => {
    if (messages.length) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, [messages.length]);

  const send = () => {
    if (!text.trim() || !requestId) return;
    addMessage.mutate({ requestId, role, authorId, body: text.trim() });
    setText('');
  };

  const isClosed = liveStatus === 'closed';

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
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
            <TouchableOpacity onPress={onClose} style={{ padding: 4, marginLeft: 8 }}>
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
                      <Text style={[styles.bubbleText, mine && { color: '#fff' }]}>{m.body}</Text>
                      <Text style={[styles.bubbleTime, mine && { color: 'rgba(255,255,255,0.7)' }]}>{formatTime(m.created_at)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={isClosed ? 'Répondre rouvre la demande…' : 'Votre message…'}
              placeholderTextColor={COLORS.textSecondary}
              multiline
            />
            <TouchableOpacity style={[styles.sendBtn, (!text.trim() || addMessage.isPending) && { opacity: 0.5 }]} onPress={send} disabled={!text.trim() || addMessage.isPending}>
              <Ionicons name="send" size={18} color={COLORS.bg} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, height: '85%' },
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
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderColor: c.cardBorder },
    input: { flex: 1, maxHeight: 120, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: Platform.OS === 'web' ? 10 : 8, fontSize: 15, color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
  });
}
