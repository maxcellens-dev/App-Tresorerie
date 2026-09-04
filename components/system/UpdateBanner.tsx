/**
 * UpdateBanner — bandeau « mise à jour disponible » qui descend du haut de l'écran.
 *
 * Compare la version RÉELLEMENT INSTALLÉE à `latest_version` (config admin app_config.features).
 * - latest_version > installée  → bandeau informatif (fermable).
 * - min_version > installée      → bandeau OBLIGATOIRE (non fermable).
 * Le bouton « Mettre à jour » ouvre la fiche du store.
 *
 * ⚠️ IL COMPARAIT LA VERSION DU BUNDLE (`Constants.expoConfig.version`), c'est-à-dire celle
 * déclarée au moment où l'OTA a été publiée — pas celle du binaire installé. Comme cette valeur
 * monte à chaque OTA, elle rattrapait mécaniquement `latest_version` : le bandeau ne s'affichait
 * JAMAIS sur le parc existant, précisément parce qu'il recevait les mises à jour. C'est
 * `APP_VERSION` (lue au natif) qui fait foi, et `shouldOfferStoreUpdate` qui tranche — la même
 * fonction que la ligne « Mise à jour » des réglages, pour que les deux ne puissent pas diverger.
 *
 * Natif uniquement (le web est toujours à jour). La fermeture est mémorisée par version.
 */
import { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform, Linking, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFeatureFlags } from '../../hooks/config/useFeatureFlags';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { APP_VERSION, NATIVE_VERSION_KNOWN, isNewerVersion, shouldOfferStoreUpdate } from '../../lib/platform/appVersion';

const ANDROID_PACKAGE = 'com.relyka.myapp';
const DISMISS_KEY = 'update_dismissed_version';

export default function UpdateBanner() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  const { data: flags } = useFeatureFlags();
  const slide = useRef(new Animated.Value(-200)).current;   // vertical (show/hide + swipe haut)
  const slideX = useRef(new Animated.Value(0)).current;     // horizontal (swipe latéral)
  const [dismissed, setDismissed] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const latest = flags?.latest_version;
  const min = flags?.min_version;

  /* OBLIGATOIRE (non fermable) : uniquement sur une version installée CONNUE. On ne bloque jamais
     quelqu'un sur une déduction — c'est la différence assumée avec `shouldOfferStoreUpdate`, qui,
     lui, ose proposer quand la version native est hors de portée. */
  const required = NATIVE_VERSION_KNOWN && !!min && isNewerVersion(min, APP_VERSION);
  const available = shouldOfferStoreUpdate(latest);
  const targetVersion = (required ? min : latest) ?? '';

  /* Tant que la fermeture précédente n'a pas été LUE, on n'affiche pas : sinon le bandeau
     apparaissait puis repartait à chaque démarrage chez quelqu'un qui l'avait déjà écarté — un
     clignotement qui donne l'impression d'un bug, et qui use le geste. */
  const [dismissLoaded, setDismissLoaded] = useState(false);
  const shouldShow =
    Platform.OS !== 'web' &&
    (required || available) &&
    (required || (dismissLoaded && !dismissed && dismissedVersion !== targetVersion));

  // Charge la version déjà « fermée » (pour ne pas re-nudger la même version).
  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY)
      .then((v) => setDismissedVersion(v))
      .catch(() => {})
      .finally(() => setDismissLoaded(true));
  }, []);

  useEffect(() => {
    if (shouldShow) slideX.setValue(0); // réaffichage centré (au cas où un swipe latéral l'a décalé)
    Animated.timing(slide, {
      toValue: shouldShow ? 0 : -200,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [shouldShow, slide, slideX]);

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

  // Rien à afficher (web ou pas de MAJ) — APRÈS tous les hooks : un return conditionnel AVANT un
  // hook change le nombre de hooks entre deux rendus (masqué → affiché quand une version plus récente
  // est publiée) → crash « Rendered more hooks than during the previous render ». (Bug corrigé.)
  if (Platform.OS === 'web' || (!required && !available)) return null;

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
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
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
    updateText: { fontSize: 12.5, fontWeight: '800', color: c.onAccent },
    close: { padding: 2 },
  });
}
