/**
 * AppDialogHost — rend les dialogues in-app (§7) et reroute `Alert.alert` vers ce système,
 * pour supprimer toutes les pop-ups natives du navigateur. À monter une seule fois, haut
 * dans l'arbre (au-dessus des écrans).
 */
import { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { registerDialogHost, alertCompat, type DialogRequest, type DialogButton } from '../../lib/ui/appDialog';

// Reroute global de Alert.alert dès le chargement du module (tous les appels existants en profitent).
(Alert as any).alert = alertCompat;

export default function AppDialogHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [inputVal, setInputVal] = useState('');

  useEffect(() => {
    // On initialise la valeur du champ EN MÊME TEMPS que la demande (même batch de rendu) → le
    // champ est correct dès le 1ᵉʳ rendu, sans fenêtre où un tap renverrait une valeur vide.
    registerDialogHost((r) => { setReq(r); setInputVal(r?.input?.defaultValue ?? ''); });
    return () => registerDialogHost(null);
  }, []);

  const close = () => setReq(null);
  // La valeur du champ (le cas échéant) est transmise au handler du bouton (cf. appPrompt).
  const onPress = (b: DialogButton) => { const v = inputVal; close(); b.onPress?.(v); };

  // Couleur d'un bouton selon son style.
  const btnColor = (b: DialogButton) =>
    b.style === 'destructive' ? COLORS.danger : b.style === 'cancel' ? COLORS.textSecondary : COLORS.emerald;

  const cancelBtn = req?.buttons.find((b) => b.style === 'cancel');

  // On ne monte le Modal que lorsqu'un dialogue est demandé : son portail est alors ajouté EN
  // DERNIER dans le DOM → toujours au-dessus des autres modaux déjà ouverts (sinon la confirmation
  // s'affichait sous le modal courant, §P6).
  if (!req) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => onPress(cancelBtn ?? { text: 'OK' })}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.overlay} onPress={() => onPress(cancelBtn ?? { text: 'OK' })}>
        <Pressable style={styles.box} onPress={() => {}}>
          {!!req.title && <Text style={styles.title}>{req.title}</Text>}
          {!!req.message && <Text style={styles.message}>{req.message}</Text>}
          {!!req.input && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={inputVal}
                onChangeText={setInputVal}
                placeholder={req.input.placeholder}
                placeholderTextColor={COLORS.textSecondary}
                keyboardType={req.input.keyboardType ?? 'default'}
                autoFocus
                selectTextOnFocus
              />
              {!!req.input.suffix && <Text style={styles.inputSuffix}>{req.input.suffix}</Text>}
            </View>
          )}
          {/* Choix ILLUSTRÉS : chaque carte montre le résultat de l'option et se valide d'un tap. */}
          {req.options?.length ? (
            <View style={styles.options}>
              {req.options.map((o, i) => {
                const col = o.tone === 'danger' ? COLORS.danger : o.tone === 'neutral' ? COLORS.blue : COLORS.emerald;
                return (
                  <Pressable
                    key={i}
                    style={[styles.option, { borderColor: col + '66', backgroundColor: col + '12' }]}
                    onPress={() => { close(); o.onPress(); }}
                  >
                    <View style={styles.optionHead}>
                      {!!o.icon && (
                        <View style={[styles.optionIcon, { backgroundColor: col + '22' }]}>
                          <Ionicons name={o.icon as any} size={16} color={col} />
                        </View>
                      )}
                      <Text style={styles.optionLabel}>{o.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={col} />
                    </View>
                    {!!o.hint && <Text style={styles.optionHint}>{o.hint}</Text>}
                    {!!o.result && (
                      <View style={styles.optionResult}>
                        <Text style={[styles.optionResultValue, { color: col }]}>{o.result}</Text>
                        {!!o.resultHint && <Text style={styles.optionResultHint}>{o.resultHint}</Text>}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.actions}>
              {req.buttons.map((b, i) => (
                <Pressable
                  key={i}
                  style={[styles.btn, { borderColor: btnColor(b) + '55', backgroundColor: btnColor(b) + '12' }]}
                  onPress={() => onPress(b)}
                >
                  <Text style={[styles.btnText, { color: btnColor(b) }]}>{b.text}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    box: { width: '100%', maxWidth: 420, backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 20, gap: 6 },
    title: { fontSize: 17, fontWeight: '800', color: c.text },
    message: { fontSize: 14, color: c.textSecondary, lineHeight: 20, marginTop: 2 },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14 },
    input: { flex: 1, fontSize: 16, color: c.text, paddingVertical: 12 },
    inputSuffix: { fontSize: 15, fontWeight: '700', color: c.textSecondary },
    options: { gap: 10, marginTop: 14 },
    option: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12, gap: 6 },
    optionHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    optionIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    optionLabel: { flex: 1, fontSize: 14.5, fontWeight: '800', color: c.text },
    optionHint: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    optionResult: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 2 },
    optionResultValue: { fontSize: 17, fontWeight: '800' },
    optionResultHint: { fontSize: 11.5, color: c.textSecondary },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 16 },
    btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
    btnText: { fontSize: 14, fontWeight: '700' },
  });
}
