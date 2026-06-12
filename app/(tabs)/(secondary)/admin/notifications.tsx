/**
 * Admin — Notifications manuelles : saisir un titre + un corps, puis pousser la
 * notification à tous les utilisateurs ayant activé les notifications (Paramètres).
 * Historique des envois en dessous (table admin_notifications, migration 063).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { useAppColors } from '../../../hooks/useAppColors';
import { sendPushToAll } from '../../../lib/pushSend';

interface AdminNotification {
  id: string;
  title: string;
  body: string;
  sent_count: number;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminNotifications() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? false;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ['admin_notifications'],
    queryFn: async (): Promise<AdminNotification[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as AdminNotification[];
    },
    enabled: isAdmin,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const t = title.trim();
      const b = body.trim();
      if (!t || !b) throw new Error('Titre et message requis');
      const sentCount = await sendPushToAll(t, b);
      const { error } = await supabase
        .from('admin_notifications')
        .insert({ title: t, body: b, sent_count: sentCount, created_by: user?.id ?? null });
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

  const confirmSend = () => {
    setMsg(null);
    const question = 'Envoyer cette notification à tous les utilisateurs ayant activé les notifications ?';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(question)) sendMutation.mutate();
    } else {
      Alert.alert('Confirmer l\'envoi', question, [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Envoyer', onPress: () => sendMutation.mutate() },
      ]);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const canSend = !!title.trim() && !!body.trim() && !sendMutation.isPending;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>
            Envoi manuel d'une notification push à tous les utilisateurs ayant activé les notifications dans leurs Paramètres.
          </Text>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Titre</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Ex. Nouveauté Relyka 🎉"
              placeholderTextColor={COLORS.textSecondary}
              maxLength={80}
            />
            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput
              style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
              value={body}
              onChangeText={setBody}
              placeholder="Le corps de la notification…"
              placeholderTextColor={COLORS.textSecondary}
              multiline
              maxLength={400}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !canSend && { opacity: 0.5 }]}
              onPress={confirmSend}
              disabled={!canSend}
              activeOpacity={0.85}
            >
              {sendMutation.isPending
                ? <ActivityIndicator size="small" color={COLORS.bg} />
                : <Ionicons name="paper-plane-outline" size={16} color={COLORS.bg} />}
              <Text style={styles.sendBtnText}>Envoyer à tous</Text>
            </TouchableOpacity>
            {msg && (
              <Text style={[styles.msg, { color: msg.startsWith('Échec') ? COLORS.danger : COLORS.emerald }]}>{msg}</Text>
            )}
            <Text style={styles.note}>
              Seuls les appareils mobiles (app installée) reçoivent le push. Les utilisateurs ayant désactivé les notifications sont exclus.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Historique des envois</Text>
          {history.length === 0 ? (
            <Text style={styles.empty}>Aucune notification envoyée pour le moment.</Text>
          ) : (
            history.map((n) => (
              <View key={n.id} style={styles.histCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histTitle}>{n.title}</Text>
                  <Text style={styles.histBody} numberOfLines={3}>{n.body}</Text>
                  <Text style={styles.histMeta}>{formatDate(n.created_at)} · {n.sent_count} appareil{n.sent_count > 1 ? 's' : ''}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
    title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 6 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16, lineHeight: 18 },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 24 },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    input: {
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 14,
    },
    sendBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 13,
    },
    sendBtnText: { fontSize: 15, fontWeight: '700', color: c.bg },
    msg: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 12 },
    note: { fontSize: 11, color: c.textSecondary, marginTop: 12, lineHeight: 15 },
    sectionLabel: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 },
    empty: { fontSize: 13, color: c.textSecondary, fontStyle: 'italic' },
    histCard: {
      flexDirection: 'row', backgroundColor: c.card, borderRadius: 12, borderWidth: 1,
      borderColor: c.cardBorder, padding: 14, marginBottom: 10,
    },
    histTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    histBody: { fontSize: 13, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
    histMeta: { fontSize: 11, color: c.textSecondary, marginTop: 6 },
    text: { color: c.text, padding: 20 },
  });
}
