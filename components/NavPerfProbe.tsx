/**
 * NavPerfProbe — badge « ⚡ NNN ms » de réactivité de navigation, ADMIN uniquement, monté à la
 * racine → mesure TOUTES les pages (onglets + pages secondaires + modaux), pas seulement les
 * onglets. À retirer quand la perf est ok.
 *
 * La mesure est scindée en TROIS phases, car un total seul ne dit pas où passe le temps — et parce
 * qu'un simple « tap → commit » mélange la plomberie de navigation avec le rendu React :
 *
 *   • « envoi » = tap → PREMIER RENDU avec la nouvelle route. C'est la latence de dispatch :
 *                 traitement du geste, React Navigation, planification de la mise à jour, et (sur
 *                 web) synchronisation de l'URL via l'History API. Aucun code d'écran n'y tourne.
 *   • « rendu » = premier rendu → commit (l'effet ci-dessous). C'est le coût réel de construction
 *                 de l'arbre : providers, hooks, composants de la page de destination.
 *   • « peint » = commit → 2 frames plus tard ≈ peinture effective (~1 à 2 frames par nature).
 *
 * Lecture : « envoi » élevé + « rendu » faible = plomberie de navigation (côté web, souvent la
 * synchro d'URL), pas une page lente. « rendu » élevé = vrai coût applicatif, qui touchera aussi
 * le mobile.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { consumeNavTap, consumeNavDispatched, nowMs } from '../lib/navPerf';

export default function NavPerfProbe() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const enabled = (profile as any)?.is_admin === true;
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [calc, setCalc] = useState<number | null>(null);
  const [wait, setWait] = useState<number | null>(null);
  const [render, setRender] = useState<number | null>(null);
  const [paint, setPaint] = useState<number | null>(null);
  const [route, setRoute] = useState('');
  const firstRef = useRef(true);

  // Horodatage du PREMIER rendu portant la nouvelle route. Volontairement fait pendant le rendu
  // (et non dans un effet) : c'est le seul moyen de dater le début du travail React, l'effet ne
  // s'exécutant qu'après le commit. La sonde est montée à la racine, donc elle rend tôt.
  const renderStartRef = useRef(0);
  const lastPathRef = useRef(pathname);
  if (lastPathRef.current !== pathname) {
    lastPathRef.current = pathname;
    renderStartRef.current = nowMs();
  }

  useEffect(() => {
    if (!enabled) return;
    // Ignore le tout premier montage (pas une navigation).
    if (firstRef.current) { firstRef.current = false; return; }

    const committedAt = nowMs();
    const renderStart = renderStartRef.current || committedAt;
    const tap = consumeNavTap();
    const dispatched = consumeNavDispatched();

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        // `calc` = travail synchrone du dispatch ; `wait` = attente avant que React ne rende.
        // Sans marquage de dispatch (navigation non instrumentée), tout est reporté sur `wait`.
        setCalc(tap && dispatched ? Math.round(dispatched - tap) : null);
        setWait(tap ? Math.round(renderStart - (dispatched || tap)) : null);
        setRender(Math.round(committedAt - renderStart));
        setPaint(Math.round(nowMs() - committedAt));
        setRoute((pathname.split('/').filter(Boolean).pop() || 'accueil').slice(0, 14));
      });
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [pathname, enabled]);

  if (!enabled || render == null || paint == null) return null;
  // La couleur suit le RENDU (le coût applicatif réel), pas le total : « envoi » dépend de la
  // plomberie de navigation (web : synchro d'URL) et n'est pas représentatif du mobile.
  const color = render < 100 ? '#059669' : render < 250 ? '#d97706' : '#dc2626';
  const label = wait == null
    ? `⚡ rdu ${render} + pnt ${paint} ms · ${route}`
    : `⚡ ${(calc ?? 0) + wait + render + paint} ms · calc ${calc ?? '?'} / att ${wait} / rdu ${render} / pnt ${paint} · ${route}`;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 44 }]}>
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.txt}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 9999 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  txt: { fontSize: 11, fontWeight: '800', color: '#fff' },
});
