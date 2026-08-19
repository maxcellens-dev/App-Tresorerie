/**
 * Voile de VERROUILLAGE de l'app (biométrie / code appareil). Monté au niveau racine, au-dessus de
 * tout. Actif seulement si l'utilisateur a activé l'option ET est connecté.
 *
 * DÉCLENCHEMENT : au DÉMARRAGE À FROID uniquement (app fermée puis rouverte → ce composant est
 * monté à neuf). Un simple passage sur une autre app / un retour en avant-plan ne redemande RIEN :
 * tant que Relyka reste vivante en arrière-plan, la session reste déverrouillée. Si l'OS tue le
 * processus en arrière-plan, la réouverture est un démarrage à froid → l'invite revient.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAuth } from '../../contexts/AuthContext';
import { APP_LOCK_SUPPORTED, getAppLockEnabled, runDeviceAuth } from '../../lib/auth/appLock';
import { setAppLocked } from '../../lib/auth/appLockState';

export default function AppLockGate() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  /* On démarre VERROUILLÉ sur les plateformes concernées : la lecture du réglage est asynchrone,
     et pendant ce laps de temps le voile n'existe pas encore. Les sollicitations montées à la
     racine (état des lieux, clôture, succès) en profitaient pour s'ouvrir — et se CONSOMMER —
     avant que l'invite d'empreinte n'apparaisse. On ne relâche donc qu'une fois la réponse connue.
     Sans verrouillage supporté (web), rien ne change : on n'entre jamais dans cet état. */
  const [locked, setLocked] = useState(APP_LOCK_SUPPORTED);
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
      setLocked(on);
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

  /* Le verrou est PUBLIÉ : un voile plein écran cache ce qu'il y a derrière, il ne l'empêche pas de
     vivre. Les sollicitations racine s'y abonnent pour ne rien ouvrir (ni consommer) tant qu'on n'a
     pas déverrouillé — cf. lib/appLockState et hooks/useInterruptSlot.
     On publie sur `locked` (et pas sur `shouldLock`) tant que le réglage n'est pas lu : à cet
     instant on ne sait pas encore si l'app doit se verrouiller, et présumer que non, c'est laisser
     passer précisément ce qu'on veut retenir. */
  const pendingSetting = APP_LOCK_SUPPORTED && locked && !enabled;
  useEffect(() => {
    setAppLocked(shouldLock || pendingSetting);
    return () => setAppLocked(false);
  }, [shouldLock, pendingSetting]);

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
      ...StyleSheet.absoluteFill,
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
