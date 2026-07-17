/**
 * NavPerfProbe — badge « ⚡ NNN ms » de réactivité de navigation, ADMIN uniquement, monté à la
 * racine → mesure TOUTES les pages (onglets + pages secondaires + modaux), pas seulement les
 * onglets. Mesure : tap marqué (lib/navPerf) → 2 frames après le changement de route ≈ ce que
 * l'utilisateur perçoit entre son geste et l'apparition de la page. À retirer quand la perf est ok.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { consumeNavTap } from '../lib/navPerf';

export default function NavPerfProbe() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const enabled = (profile as any)?.is_admin === true;
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [ms, setMs] = useState<number | null>(null);
  const [route, setRoute] = useState('');
  const firstRef = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    // Ignore le tout premier montage (pas une navigation).
    if (firstRef.current) { firstRef.current = false; return; }
    const tap = consumeNavTap();
    const start = tap || Date.now(); // pas de tap marqué → coût de rendu de la destination seul
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        setMs(Date.now() - start);
        setRoute((pathname.split('/').filter(Boolean).pop() || 'accueil').slice(0, 14));
      });
      // @ts-ignore — nettoyage best-effort
      raf2;
    });
    return () => cancelAnimationFrame(raf1);
  }, [pathname, enabled]);

  if (!enabled || ms == null) return null;
  const color = ms < 200 ? '#059669' : ms < 400 ? '#d97706' : '#dc2626';
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 44 }]}>
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.txt}>⚡ {ms} ms · {route}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 9999 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  txt: { fontSize: 11, fontWeight: '800', color: '#fff' },
});
