/**
 * UpdateBanner — bandeau « mise à jour disponible » qui descend du haut de l'écran.
 *
 * Compare la version installée (app.json) à `latest_version` (config admin app_config.features).
 * - latest_version > installée  → bandeau informatif (fermable).
 * - min_version > installée      → bandeau OBLIGATOIRE (non fermable).
 * Le bouton « Mettre à jour » ouvre la fiche du store.
 *
 * Natif uniquement (le web est toujours à jour). La fermeture est mémorisée par version.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform, Linking, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useAppColors } from '../hooks/useAppColors';

const ANDROID_PACKAGE = 'com.relyka.myapp';
const DISMISS_KEY = 'update_dismissed_version';

/** Renvoie >0 si a est une version plus récente que b ("1.0.2" vs "1.0.1"). */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export default function UpdateBanner() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const insets = useSafeAreaInsets();
  const { data: flags } = useFeatureFlags();
  const slide = useRef(new Animated.Value(-200)).current;   // vertical (show/hide + swipe haut)
  const slideX = useRef(new Animated.Value(0)).current;     // horizontal (swipe latéral)
  const [dismissed, setDismissed] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const current = Constants.expoConfig?.version ?? '0.0.0';
  const latest = flags?.latest_version;
  const min = flags?.min_version;

  // Mise à jour requise (non fermable) ou simplement disponible (fermable).
  const required = !!min && isNewer(min, current);
  const available = !!latest && isNewer(latest, current);
  const targetVersion = (required ? min : latest) ?? '';

  // Sur web, ou si pas de MAJ, on n'affiche rien.
  const shouldShow =
    Platform.OS !== 'web' &&
    (required || available) &&
    (required || (!dismissed && dismissedVersion !== targetVersion));

  // Charge la version déjà « fermée » (pour ne pas re-nudger la même version).
  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY).then((v) => setDismissedVersion(v)).catch(() => {});
  }, []);

  useEffect(() => {
    if (shouldShow) slideX.setValue(0); // réaffichage centré (au cas où un swipe latéral l'a décalé)
    Animated.timing(slide, {
      toValue: shouldShow ? 0 : -200,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [shouldShow, slide, slideX]);

  if (Platform.OS === 'web' || (!required && !available)) return null;

  const openStore = () => {
    const url = Platform.OS === 'ios'
      ? (flags?.update_url_ios || 'https://apps.apple.com/')
      : (flags?.update_url_android || `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`);
    Linking.openURL(url).catch(() => {});
  };

  const dismiss = () => {
    if (required) return; // obligatoire → non fermable
    setDismissed(true);
    AsyncStorage.setItem(DISMISS_KEY, targetVersion).catch(() => {});
  };

  // Valeurs « fraîches » lues au moment du geste (le PanResponder est créé une seule fois).
  const requiredRef = useRef(required);
  const targetRef = useRef(targetVersion);
  useEffect(() => { requiredRef.current = required; targetRef.current = targetVersion; });

  // Swipe pour fermer (haut OU latéral), uniquement si la MAJ n'est PAS obligatoire.
  const closeAndDismiss = (anim: Animated.CompositeAnimation) => {
    anim.start(() => {
      setDismissed(true);
      AsyncStorage.setItem(DISMISS_KEY, targetRef.current).catch(() => {});
    });
  };
  const panResponder = useRef(
    PanResponder.create({
      // On capture le geste dès qu'il bouge nettement vers le haut OU sur les côtés.
      onMoveShouldSetPanResponder: (_e, g) =>
        !requiredRef.current && (Math.abs(g.dx) > 8 || (g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx))),
      onPanResponderMove: (_e, g) => {
        // Axe dominant : horizontal → on suit le doigt latéralement ; vertical (vers le haut) sinon.
        if (Math.abs(g.dx) > Math.abs(g.dy)) slideX.setValue(g.dx);
        else if (g.dy < 0) slide.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        const horizontal = Math.abs(g.dx) > Math.abs(g.dy);
        if (horizontal && (Math.abs(g.dx) > 90 || Math.abs(g.vx) > 0.5)) {
          // Sort sur le côté du geste.
          const to = g.dx > 0 ? 600 : -600;
          closeAndDismiss(Animated.timing(slideX, { toValue: to, duration: 180, useNativeDriver: true }));
        } else if (!horizontal && (g.dy < -40 || g.vy < -0.5)) {
          closeAndDismiss(Animated.timing(slide, { toValue: -240, duration: 180, useNativeDriver: true }));
        } else {
          // Pas assez loin → on remet en place (les deux axes).
          Animated.spring(slideX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    }),
  ).current;

  return (
    <Animated.View
      pointerEvents="box-none"
      {...panResponder.panHandlers}
      style={[styles.wrap, { paddingTop: insets.top + 8, transform: [{ translateY: slide }, { translateX: slideX }] }]}
    >
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="arrow-up-circle" size={20} color={COLORS.emerald} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{required ? 'Mise à jour requise' : 'Mise à jour disponible'}</Text>
          <Text style={styles.text} numberOfLines={2}>
            {required
              ? 'Une nouvelle version est nécessaire pour continuer.'
              : 'Une nouvelle version de Relyka est disponible sur le store.'}
          </Text>
        </View>
        <TouchableOpacity style={styles.updateBtn} onPress={openStore} activeOpacity={0.85}>
          <Text style={styles.updateText}>Mettre à jour</Text>
        </TouchableOpacity>
        {!required && (
          <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
            <Ionicons name="close" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2000, paddingHorizontal: 10 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.emerald + '66',
      borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
    },
    iconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.emerald + '22', alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 13.5, fontWeight: '800', color: c.text },
    text: { fontSize: 11.5, color: c.textSecondary, marginTop: 1, lineHeight: 15 },
    updateBtn: { backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    updateText: { fontSize: 12.5, fontWeight: '800', color: c.bg },
    close: { padding: 2 },
  });
}
