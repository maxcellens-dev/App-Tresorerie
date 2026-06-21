/**
 * AppDialogHost — rend les dialogues in-app (§7) et reroute `Alert.alert` vers ce système,
 * pour supprimer toutes les pop-ups natives du navigateur. À monter une seule fois, haut
 * dans l'arbre (au-dessus des écrans).
 */
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Alert, TextInput } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';
import { registerDialogHost, alertCompat, type DialogRequest, type DialogButton } from '../lib/appDialog';

// Reroute global de Alert.alert dès le chargement du module (tous les appels existants en profitent).
(Alert as any).alert = alertCompat;

export default function AppDialogHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [inputVal, setInputVal] = useState('');

  useEffect(() => {
    registerDialogHost((r) => setReq(r));
    return () => registerDialogHost(null);
  }, []);

  // Pré-remplit le champ de saisie à chaque nouveau dialogue (modifiable ensuite).
  useEffect(() => { setInputVal(req?.input?.defaultValue ?? ''); }, [req]);

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
      <Pressable style={styles.overlay} onPress={() => onPress(cancelBtn ?? { text: 'OK' })}>
        <Pressable style={styles.box} onPress={() => {}}>
          {!!req.title && <Text style={styles.title}>{req.title}</Text>}
          {!!req.message && <Text style={styles.message}>{req.message}</Text>}
          {!!req.input && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                defaultValue={req.input.defaultValue}
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
        </Pressable>
      </Pressable>
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
    actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 16 },
    btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
    btnText: { fontSize: 14, fontWeight: '700' },
  });
}
