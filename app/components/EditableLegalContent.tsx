/**
 * EditableLegalContent (§P9) — affiche le contenu d'une page légale et, pour les admins,
 * un bouton « Modifier » qui ouvre une édition INLINE (état local : seul l'admin qui édite voit
 * le champ ; les autres voient le texte publié). À l'enregistrement, le texte remplace le contenu
 * par défaut pour tout le monde.
 *
 * - Pas d'override en base → on affiche `children` (contenu par défaut structuré).
 * - Override présent → on l'affiche en blocs (séparés par lignes vides).
 * - Édition → zone de texte pré-remplie avec l'override ou le texte par défaut (seedText).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { useLegalContent, useSaveLegalContent, type LegalContent } from '../hooks/useLegalContent';

interface Props {
  which: keyof LegalContent;     // 'privacy' | 'legal'
  seedText: string;              // texte par défaut pré-rempli à la 1ʳᵉ édition
  children: React.ReactNode;     // contenu par défaut structuré (affiché si pas d'override)
}

export default function EditableLegalContent({ which, seedText, children }: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const { user } = useAuth();
  const isAdmin = (useProfile(user?.id).data?.is_admin ?? (user?.email === 'maxcellens@gmail.com'));
  const { data: content } = useLegalContent();
  const save = useSaveLegalContent();
  const override = content?.[which];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const startEdit = () => { setDraft((override && override.trim()) || seedText); setMsg(null); setEditing(true); };
  const persist = async () => {
    setMsg(null);
    try {
      await save.mutateAsync({ ...(content ?? {}), [which]: draft.trim() || undefined });
      setEditing(false);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erreur'); }
  };

  if (editing) {
    return (
      <View>
        <TextInput
          style={styles.area}
          value={draft}
          onChangeText={setDraft}
          multiline
          textAlignVertical="top"
          autoFocus
        />
        {msg && <Text style={styles.err}>{msg}</Text>}
        <View style={styles.editActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)} disabled={save.isPending}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={persist} disabled={save.isPending}>
            {save.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Enregistrer</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      {isAdmin && (
        <TouchableOpacity style={styles.editBtn} onPress={startEdit} activeOpacity={0.85}>
          <Ionicons name="create-outline" size={16} color={COLORS.emerald} />
          <Text style={styles.editBtnText}>Modifier (admin)</Text>
        </TouchableOpacity>
      )}
      {override && override.trim()
        ? override.trim().split(/\n\s*\n/).map((block, i) => (
            <View key={i} style={styles.card}><Text style={styles.body}>{block.trim()}</Text></View>
          ))
        : children}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    editBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '12',
      borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginBottom: 14,
    },
    editBtnText: { fontSize: 13, fontWeight: '700', color: c.emerald },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 20, marginBottom: 12 },
    body: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
    area: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 14, lineHeight: 21, minHeight: 320,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    err: { fontSize: 12, color: c.danger, marginTop: 8 },
    editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
    cancelBtn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
    cancelText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    saveBtn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 10, backgroundColor: c.emerald },
    saveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  });
}
