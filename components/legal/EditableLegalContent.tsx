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
import { isGardenPalette as isGardenPaletteF } from '../../lib/garden/gardenPalette';
import { gardenFormStyles } from '../../lib/garden/legacyStyles';
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePublicColors } from '../../hooks/theme/usePublicColors';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/data/useProfile';
import { useLegalContent, useSaveLegalContent, type LegalContent } from '../../hooks/config/useLegalContent';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';

interface Props {
  which: keyof LegalContent;     // 'privacy' | 'legal'
  seedText: string;              // texte par défaut pré-rempli à la 1ʳᵉ édition
  children: React.ReactNode;     // contenu par défaut structuré (affiché si pas d'override)
}

export default function EditableLegalContent({ which, seedText, children }: Props) {
  const COLORS = usePublicColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user } = useAuth();
  const isAdmin = useProfile(user?.id).data?.is_admin === true;
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
        ? override.trim().split(/\n\s*\n/).map((block, i) => {
            // 1ʳᵉ ligne d'un bloc de plusieurs lignes = son titre (même dessin que le contenu par défaut).
            const [head, ...rest] = block.trim().split('\n');
            return (
              <View key={i} style={styles.card}>
                {rest.length ? <Text style={styles.title}>{head.trim()}</Text> : null}
                <Text style={styles.body}>{(rest.length ? rest.join('\n') : head).trim()}</Text>
              </View>
            );
          })
        : children}
    </View>
  );
}

function makeStyles(c: any) {
  const base = makeBaseStyles(c);
  // JARDIN : même écran, habillé comme le reste de l'app (cf. lib/garden/legacyStyles › gardenFormStyles).
  return isGardenPaletteF(c as any) ? gardenFormStyles(base) : base;
}

function makeBaseStyles(c: any) {
  return StyleSheet.create({
    editBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '12',
      borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginBottom: 14,
    },
    editBtnText: { fontFamily: GF.bodyBold, fontSize: 13, fontWeight: 'normal', color: c.emerald },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 20, marginBottom: 12 },
    title: { fontFamily: GF.bodyHeavy, fontWeight: 'normal', fontSize: 15, color: c.emerald, marginBottom: 8 },
    body: { fontFamily: GF.body, fontSize: 14, color: c.textSecondary, lineHeight: 21 },
    area: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 14, lineHeight: 21, minHeight: 320,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    err: { fontFamily: GF.body, fontSize: 12, color: c.danger, marginTop: 8 },
    editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
    cancelBtn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
    cancelText: { fontFamily: GF.bodyBold, fontSize: 14, fontWeight: 'normal', color: c.textSecondary },
    saveBtn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 10, backgroundColor: c.emerald },
    saveText: { fontFamily: GF.bodyBold, fontSize: 14, fontWeight: 'normal', color: c.onAccent },
  });
}
