/**
 * Admin — modèles d'e-mail : une LISTE DÉROULANTE, pas une grille de cartes.
 *
 * Les trois cartes prenaient un tiers de l'écran pour trois éléments qu'on choisit une fois et qu'on
 * ne relit jamais. Ici : une ligne repliée, qui s'ouvre sur la liste, et des actions explicites —
 * copier dans la zone de préparation, modifier, renommer, dupliquer, supprimer, créer.
 *
 * « Copier dans la préparation » est SÉPARÉ de « modifier » à dessein : écrire une campagne à partir
 * d'un modèle ne doit pas risquer de modifier le modèle, et corriger un modèle ne doit pas écraser
 * la campagne en cours de rédaction.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { sheetWidth } from '../../lib/ui/appLayout';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import {
  useEmailTemplates, useSaveEmailTemplate, useDeleteEmailTemplate, makeTemplateId,
  type AdminEmailTemplate,
} from '../../hooks/admin/useEmailTemplates';

interface Props {
  /** Recopie le modèle dans les champs Objet + Message de la campagne en cours. */
  onApply: (t: { subject: string; body: string }) => void;
}

/** Brouillon d'édition d'un modèle (`null` = aucune modale ouverte). */
interface Draft { id: string; label: string; hint: string; subject: string; body: string; isNew: boolean }

export default function EmailTemplatePicker({ onApply }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: templates = [], isLoading } = useEmailTemplates();
  const save = useSaveEmailTemplate();
  const remove = useDeleteEmailTemplate();

  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const ids = templates.map((t) => t.id);

  const startEdit = (t: AdminEmailTemplate) =>
    setDraft({ id: t.id, label: t.label, hint: t.hint, subject: t.subject, body: t.body, isNew: false });

  const startDuplicate = (t: AdminEmailTemplate) =>
    setDraft({
      id: makeTemplateId(`${t.label} copie`, ids), label: `${t.label} (copie)`,
      hint: t.hint, subject: t.subject, body: t.body, isNew: true,
    });

  const startNew = () =>
    setDraft({ id: makeTemplateId('nouveau modele', ids), label: '', hint: '', subject: '', body: '', isNew: true });

  const commit = () => {
    if (!draft) return;
    if (!draft.label.trim()) { Alert.alert('Modèle', 'Donne un nom au modèle.'); return; }
    // Un modèle créé prend un id dérivé de SON NOM FINAL : renommer avant d'enregistrer ne doit pas
    // laisser un identifiant qui parle d'autre chose.
    const id = draft.isNew ? makeTemplateId(draft.label, ids.filter((i) => i !== draft.id)) : draft.id;
    save.mutate(
      { id, label: draft.label, hint: draft.hint, subject: draft.subject, body: draft.body },
      { onSuccess: () => { setSelectedId(id); setDraft(null); }, onError: (e: any) => Alert.alert('Modèle', e?.message ?? 'Échec') },
    );
  };

  const confirmDelete = (t: AdminEmailTemplate) => {
    const reset = t.builtin;
    Alert.alert(
      reset ? 'Réinitialiser le modèle' : 'Supprimer le modèle',
      reset
        ? `« ${t.label} » revient à sa version d'origine. Tes modifications seront perdues.`
        : `« ${t.label} » sera supprimé définitivement.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: reset ? 'Réinitialiser' : 'Supprimer',
          style: 'destructive',
          onPress: () => remove.mutate(t.id, {
            onSuccess: () => { if (!reset) setSelectedId(null); },
            onError: (e: any) => Alert.alert('Modèle', e?.message ?? 'Échec'),
          }),
        },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      {/* ── Ligne repliée : le modèle courant + le geste principal ── */}
      <View style={styles.row}>
        <TouchableOpacity style={styles.select} onPress={() => setOpen((v) => !v)} activeOpacity={0.75}>
          <Ionicons name="document-text-outline" size={15} color={COLORS.emerald} />
          <Text style={styles.selectText} numberOfLines={1}>
            {isLoading ? 'Chargement…' : selected ? selected.label : 'Choisir un modèle'}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.applyBtn, !selected && { opacity: 0.4 }]}
          disabled={!selected}
          onPress={() => selected && onApply({ subject: selected.subject, body: selected.body })}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-down" size={14} color={COLORS.onAccent} />
          <Text style={styles.applyTxt}>Utiliser</Text>
        </TouchableOpacity>
      </View>

      {/* ── Liste déroulée ── */}
      {open && (
        <View style={styles.list}>
          <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
            {templates.map((t) => {
              const picked = t.id === selectedId;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.item, picked && styles.itemPicked]}
                  onPress={() => setSelectedId(picked ? null : t.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={picked ? 'radio-button-on' : 'radio-button-off'}
                    size={15}
                    color={picked ? COLORS.emerald : COLORS.textSecondary}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.itemHead}>
                      <Text style={styles.itemName} numberOfLines={1}>{t.label}</Text>
                      {!t.builtin && <View style={styles.customTag}><Text style={styles.customTagTxt}>Perso</Text></View>}
                      {t.builtin && t.overridden && <View style={styles.editedTag}><Text style={styles.editedTagTxt}>Modifié</Text></View>}
                    </View>
                    {!!t.hint && <Text style={styles.itemHint} numberOfLines={2}>{t.hint}</Text>}
                  </View>
                  {/* Actions au niveau de la ligne : elles ne concernent QUE ce modèle. */}
                  <TouchableOpacity style={styles.iconBtn} onPress={() => startEdit(t)} accessibilityLabel={`Modifier ${t.label}`}>
                    <Ionicons name="create-outline" size={17} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => startDuplicate(t)} accessibilityLabel={`Dupliquer ${t.label}`}>
                    <Ionicons name="copy-outline" size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  {(t.overridden || !t.builtin) && (
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => confirmDelete(t)}
                      accessibilityLabel={t.builtin ? `Réinitialiser ${t.label}` : `Supprimer ${t.label}`}
                    >
                      <Ionicons name={t.builtin ? 'refresh-outline' : 'trash-outline'} size={16} color={COLORS.danger} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.newBtn} onPress={startNew} activeOpacity={0.8}>
            <Ionicons name="add" size={16} color={COLORS.emerald} />
            <Text style={styles.newTxt}>Nouveau modèle</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Édition / création ── */}
      <Modal visible={!!draft} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setDraft(null)}>
        <KeyboardAwareOverlay style={styles.overlay} scroll={false}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{draft?.isNew ? 'Nouveau modèle' : 'Modifier le modèle'}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setDraft(null)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Nom</Text>
              <TextInput
                style={styles.input} value={draft?.label ?? ''}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, label: v } : d))}
                placeholder="Ex. Relance de fin de mois" placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.label}>À quoi il sert</Text>
              <TextInput
                style={styles.input} value={draft?.hint ?? ''}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, hint: v } : d))}
                placeholder="Une ligne pour le reconnaître sans l'ouvrir"
                placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.label}>Objet par défaut</Text>
              <TextInput
                style={styles.input} value={draft?.subject ?? ''}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, subject: v } : d))}
                placeholder="Ex. Du nouveau dans Relyka" placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.label}>Message</Text>
              <TextInput
                style={[styles.input, styles.textarea]} value={draft?.body ?? ''}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, body: v } : d))}
                multiline autoCapitalize="none" autoCorrect={false}
                placeholder={'Texte simple (une ligne vide = un paragraphe), ou HTML.\nLe logo, le bouton et le lien de désinscription sont ajoutés autour.'}
                placeholderTextColor={COLORS.textSecondary}
              />
              {draft && !draft.isNew && templates.find((t) => t.id === draft.id)?.builtin && (
                <Text style={styles.noteBuiltin}>
                  Modèle du socle : ta version remplacera l'originale. Tu pourras revenir à celle d'origine
                  à tout moment avec « Réinitialiser ».
                </Text>
              )}
            </ScrollView>
            <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={commit} disabled={save.isPending}>
              {save.isPending ? <ActivityIndicator color={COLORS.onAccent} size="small" /> : <Text style={styles.saveTxt}>Enregistrer</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareOverlay>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { gap: 8, marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    select: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
    },
    selectText: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
    applyBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.emerald,
      borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11,
    },
    applyTxt: { fontSize: 13, fontWeight: '800', color: c.onAccent },
    list: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, backgroundColor: c.card, overflow: 'hidden' },
    item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    itemPicked: { backgroundColor: c.emerald + '12' },
    itemHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    itemName: { fontSize: 13.5, fontWeight: '700', color: c.text, flexShrink: 1 },
    itemHint: { fontSize: 11, color: c.textSecondary, marginTop: 1, lineHeight: 15 },
    customTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, flexShrink: 0, backgroundColor: c.blue + '1A', borderWidth: 1, borderColor: c.blue + '44' },
    customTagTxt: { fontSize: 9, fontWeight: '800', color: c.blue },
    editedTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, flexShrink: 0, backgroundColor: c.orange + '1A', borderWidth: 1, borderColor: c.orange + '44' },
    editedTagTxt: { fontSize: 9, fontWeight: '800', color: c.orange },
    iconBtn: { padding: 5 },
    newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 },
    newTxt: { fontSize: 13, fontWeight: '800', color: c.emerald },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    // Plafond sur la FEUILLE elle-même (une View a `flexShrink: 0` : un parent plafonné ne la
    // rétrécirait pas, elle déborderait et emporterait le bouton hors de l'écran).
    sheet: {
      ...sheetWidth, maxHeight: '92%',
      backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderColor: c.cardBorder, padding: 20, paddingBottom: 16, gap: 4,
    },
    sheetScroll: { flexGrow: 0, flexShrink: 1 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    label: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary, marginTop: 12, marginBottom: 5 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text },
    textarea: { minHeight: 160, textAlignVertical: 'top', fontSize: 12.5, lineHeight: 18 },
    noteBuiltin: { fontSize: 11.5, color: c.textSecondary, fontStyle: 'italic', lineHeight: 16, marginTop: 10 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
    saveTxt: { fontSize: 15, fontWeight: '800', color: c.onAccent },
  });
}
