/**
 * QuickAddButton — gros bouton « + » rond et SURÉLEVÉ dans la barre d'onglets (son centre est posé
 * sur le bord haut de la barre). Au tap, il déploie en arc, juste au-dessus, 3 actions de saisie
 * (Virement, Dépense, Recette) avec une animation d'apparition/disparition. Un tap ailleurs referme.
 *
 * Position réglable (Paramètres) : 'right' (défaut, entre Pilotage et Projets), 'left' (entre Pilotage
 * et Transactions) ou 'hidden'. Rendu en overlay dans le layout (tabs) → flotte au-dessus de la barre.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useQuickAddPref } from '../hooks/useUiPrefs';
import { useFeatureFlags } from '../hooks/useFeatureFlags';

const FAB_SIZE = 42;
const ACTION_SIZE = 48;
const ACTION_W = 92;          // largeur du conteneur d'action (pour afficher le libellé en entier)
const RADIUS = 98;            // distance d'expansion des actions
const BAR_CONTENT = 70;       // hauteur du contenu de la barre d'onglets (hors inset bas)

export default function QuickAddButton() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { position } = useQuickAddPref(user?.id);
  const { data: flags } = useFeatureFlags();

  const [open, setOpen] = useState(false);
  // `mounted` garde les boutons d'action dans l'arbre PENDANT l'animation, puis les démonte à la
  // fermeture → sinon leur ombre (elevation Android) reste visible même à opacity 0.
  const [mounted, setMounted] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const run = (to: number, cb?: (result: { finished: boolean }) => void) =>
    Animated.spring(anim, { toValue: to, useNativeDriver: true, friction: 6, tension: 90 }).start(cb);
  const openMenu = () => { setMounted(true); setOpen(true); run(1); };
  const close = () => { setOpen(false); run(0, ({ finished }) => { if (finished) setMounted(false); }); };
  const toggle = () => { if (open) close(); else openMenu(); };
  const go = (route: string) => { close(); setTimeout(() => router.push(route as any), 60); };

  const enabled = flags?.quick_add_enabled !== false;      // admin : défaut activé
  const isBubble = (flags?.quick_add_mode ?? 'tabbar') === 'bubble';
  if (!enabled || position === 'hidden') return null;
  // Mode bulle : visible sur le Pilotage — y compris l'écran d'accueil « home » (entête « Bonjour … »)
  // sur lequel on atterrit au démarrage — ET sur les écrans « Comptes » (liste + détail d'un compte).
  if (isBubble && !/(pilotage|home|comptes)/.test(pathname ?? '')) return null;

  // Sur le détail d'un compte (/comptes/<uuid>), on pré-sélectionne ce compte comme source de la saisie.
  const acctMatch = (pathname ?? '').match(/\/comptes\/([0-9a-fA-F-]{36})/);
  const acctParam = acctMatch ? `&account=${acctMatch[1]}` : '';
  // La saisie est poussée dans l'onglet Transactions (navigation inter-onglets) → le « Retour » in-app
  // remonterait la pile Transactions au lieu de l'écran d'origine. On transmet donc l'origine.
  const originParam = pathname ? `&origin=${encodeURIComponent(pathname)}` : '';

  const barHeight = BAR_CONTENT + Math.max(insets.bottom, 8);
  // Placement de l'ancre selon le mode.
  const anchorBottom = isBubble ? barHeight + 12 : barHeight - FAB_SIZE / 2; // bulle au-dessus du menu ; barre = centre sur le bord
  const anchorLeft = isBubble ? width - 16 - FAB_SIZE : width * (position === 'left' ? 0.4 : 0.6) - FAB_SIZE / 2;

  // Arc des actions : vers le haut en mode barre ; vers le haut-gauche en mode bulle (coin bas-droite).
  const ANG = isBubble
    ? { transfer: 180, expense: 138, income: 96 }
    : { transfer: 150, expense: 90, income: 30 };
  const ACTIONS = [
    { key: 'transfer', label: 'Virement', icon: 'swap-horizontal', deg: ANG.transfer, color: COLORS.blue, route: `/(tabs)/transactions/add?type=transfer${acctParam}${originParam}` },
    { key: 'expense', label: 'Dépense', icon: 'arrow-down', deg: ANG.expense, color: COLORS.danger, route: `/(tabs)/transactions/add?type=expense${acctParam}${originParam}` },
    { key: 'income', label: 'Recette', icon: 'arrow-up', deg: ANG.income, color: COLORS.emerald, route: `/(tabs)/transactions/add?type=income${acctParam}${originParam}` },
  ] as const;

  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <>
      {/* Backdrop plein écran : capte les taps extérieurs pour refermer */}
      {open && (
        <Pressable style={StyleSheet.absoluteFill} onPress={close}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#00000055', opacity: backdropOpacity }]} />
        </Pressable>
      )}

      {/* Ancre carrée à l'emplacement du FAB ; box-none → seuls les boutons captent les taps */}
      <View pointerEvents="box-none" style={[styles.anchor, { bottom: anchorBottom, left: anchorLeft }]}>
        {mounted && ACTIONS.map((a) => {
          const rad = (a.deg * Math.PI) / 180;
          // Position FINALE statique (cible tactile fiable sur Android) : on n'anime que scale + opacity.
          const left = FAB_SIZE / 2 + RADIUS * Math.cos(rad) - ACTION_W / 2;
          const top = FAB_SIZE / 2 - RADIUS * Math.sin(rad) - ACTION_SIZE / 2;
          const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
          return (
            <Animated.View
              key={a.key}
              pointerEvents={open ? 'auto' : 'none'}
              style={[styles.action, { left, top, opacity: anim, transform: [{ scale }] }]}
            >
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: a.color }]} onPress={() => go(a.route)} activeOpacity={0.85}>
                <Ionicons name={a.icon as any} size={20} color={'#fff'} />
              </TouchableOpacity>
              <Text style={styles.actionLabel} numberOfLines={1}>{a.label}</Text>
            </Animated.View>
          );
        })}

        {/* Le bouton « + » */}
        <TouchableOpacity style={styles.fab} onPress={toggle} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="Saisie rapide">
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="add" size={34} color={'#fff'} />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    anchor: { position: 'absolute', width: FAB_SIZE, height: FAB_SIZE, alignItems: 'center', justifyContent: 'center', zIndex: 50 },
    fab: {
      width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2, backgroundColor: c.emerald,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
      borderWidth: 3, borderColor: c.bg,
    },
    action: {
      position: 'absolute',
      width: ACTION_W, // large pour afficher le libellé complet ; le cercle reste centré
      alignItems: 'center',
    },
    actionBtn: {
      width: ACTION_SIZE, height: ACTION_SIZE, borderRadius: ACTION_SIZE / 2,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.28, shadowRadius: 6, elevation: 6,
    },
    actionLabel: {
      marginTop: 4, fontSize: 11, fontWeight: '700', color: c.text,
      backgroundColor: c.cardSolid ?? c.card, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
      overflow: 'hidden',
    },
  });
}
