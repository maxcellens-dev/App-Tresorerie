/**
 * Voile de VERROUILLAGE de l'app (biométrie / code appareil). Monté au niveau racine, au-dessus de
 * tout. Actif seulement si l'utilisateur a activé l'option ET est connecté.
 *
 * DÉCLENCHEMENT : au DÉMARRAGE À FROID uniquement (app fermée puis rouverte → ce composant est
 * monté à neuf). Un simple passage sur une autre app / un retour en avant-plan ne redemande RIEN :
 * tant que Relyka reste vivante en arrière-plan, la session reste déverrouillée. Si l'OS tue le
 * processus en arrière-plan, la réouverture est un démarrage à froid → l'invite revient.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { APP_LOCK_SUPPORTED, getAppLockEnabled, runDeviceAuth } from '../lib/appLock';

export default function AppLockGate() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const authing = useRef(false);

  // Lit le réglage local + verrouille d'emblée si actif. UNIQUE point de verrouillage : ce montage
  // n'a lieu qu'au lancement de l'app (démarrage à froid). Aucun re-verrouillage sur AppState :
  // basculer vers une autre app puis revenir ne doit PAS redemander l'empreinte.
  useEffect(() => {
    if (!APP_LOCK_SUPPORTED) return;
    let cancelled = false;
    getAppLockEnabled().then((on) => {
      if (cancelled) return;
      setEnabled(on);
      if (on) setLocked(true);
    });
    return () => { cancelled = true; };
  }, []);

  const unlock = useCallback(async () => {
    if (authing.current) return;
    authing.current = true;
    const ok = await runDeviceAuth('Déverrouille Relyka');
    authing.current = false;
    if (ok) setLocked(false);
  }, []);

  // Invite automatiquement dès que le voile s'affiche (connecté + verrouillé).
  const shouldLock = APP_LOCK_SUPPORTED && enabled && !!user && locked;
  useEffect(() => {
    if (shouldLock) unlock();
  }, [shouldLock, unlock]);

  if (!shouldLock) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed" size={34} color={COLORS.emerald} />
      </View>
      <Text style={styles.title}>Relyka est verrouillée</Text>
      <Text style={styles.sub}>Déverrouille avec {Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'ton empreinte'} ou le code de ton téléphone.</Text>
      <Pressable style={styles.btn} onPress={unlock} accessibilityRole="button">
        <Ionicons name="finger-print" size={18} color={COLORS.bg} />
        <Text style={styles.btnTxt}>Déverrouiller</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.bg,
      alignItems: 'center', justifyContent: 'center', padding: 28,
      zIndex: 200000, elevation: 200000,
    },
    iconWrap: {
      width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 22,
    },
    title: { fontSize: 22, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 10 },
    sub: { fontSize: 14.5, color: c.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: 26, maxWidth: 320 },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
    btnTxt: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
