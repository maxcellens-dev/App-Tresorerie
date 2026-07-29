/**
 * QuickAddButton — gros bouton « + » rond et SURÉLEVÉ dans la barre d'onglets (son centre est posé
 * sur le bord haut de la barre). Au tap, il déploie en arc, juste au-dessus, 4 actions de saisie
 * (Solde, Virement, Dépense, Recette) avec une animation d'apparition/disparition. Un tap ailleurs
 * referme.
 *
 * « Mettre à jour mon solde » est la 4ᵉ action, et un APPUI LONG sur le « + » y va directement.
 * Ce n'est pas un ajout cosmétique : c'est le seul geste qui VÉRIFIE les données (régularisation +
 * recalibrage de la confiance), donc celui qui remet tous les chiffres d'aplomb. Il n'était
 * atteignable que par Comptes → un compte → « Nouveau Solde », ce qui le rendait invisible.
 *
 * Position réglable (Paramètres) : 'right' (défaut, entre Pilotage et Projets), 'left' (entre Pilotage
 * et Transactions). Il n'est plus masquable par l'utilisateur : seul l'admin peut le désactiver
 * globalement. Rendu en overlay dans le layout (tabs) → flotte au-dessus de la barre.
 */
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Pressable, useWindowDimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useQuickAddPref } from '../hooks/useUiPrefs';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { APP_MAX_WIDTH } from '../lib/appLayout';

const FAB_SIZE = 56;          // plus GROS et repérable (était 42 : passait inaperçu)
const ACTION_SIZE = 54;       // actions plus grosses et lisibles
// Largeur d'une ligne d'action : libellé (pastille) + gouttière + bouton rond.
// « Mettre à jour mon solde » est le plus long libellé et doit tenir sans coupure.
const ACTION_W = 250;
const BAR_CONTENT = 70;       // hauteur du contenu de la barre d'onglets (hors inset bas)

// Pulse d'attention : une seule fois par session d'app (pas en boucle — juste « je suis là »).
let pulsedThisSession = false;

/** Assombrit une couleur hex (#RRGGBB) vers le noir (facteur 0..1) — pour les dégradés d'action. */
function darkenHex(hex: string, f: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const g = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - f)).toString(16).padStart(2, '0');
  return `#${g(1)}${g(3)}${g(5)}`;
}

export default function QuickAddButton() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  // Sur web bureau, l'app est confinée dans une colonne centrée de APP_MAX_WIDTH (cf. webColumn dans
  // app/_layout). Le FAB est ancré DANS cette colonne : sa position horizontale doit se calculer sur
  // la largeur de la colonne, pas sur celle du navigateur — sinon il est projeté hors champ à droite.
  const width = Platform.OS === 'web' ? Math.min(winWidth, APP_MAX_WIDTH) : winWidth;
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

  // Pulse UNE fois par session à l'arrivée sur le Pilotage : attire l'œil sans agacer.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (pulsedThisSession || !/pilotage/.test(pathname ?? '')) return;
    pulsedThisSession = true;
    const t = setTimeout(() => {
      Animated.sequence([
        Animated.spring(pulse, { toValue: 1.18, useNativeDriver: true, tension: 120, friction: 4 }),
        Animated.spring(pulse, { toValue: 1, useNativeDriver: true, tension: 120, friction: 5 }),
        Animated.spring(pulse, { toValue: 1.12, useNativeDriver: true, tension: 120, friction: 4 }),
        Animated.spring(pulse, { toValue: 1, useNativeDriver: true, tension: 120, friction: 6 }),
      ]).start();
    }, 900);
    return () => clearTimeout(t);
  }, [pathname, pulse]);

  // Intention d'ouverture, mise à jour SYNCHRONEMENT (pas au rendu suivant) : elle sert à la fois
  // aux callbacks d'animation et à l'arbitrage des taps rapprochés, qui ne peuvent pas attendre
  // le prochain rendu pour savoir dans quel sens basculer.
  const openRef = useRef(false);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (unmountTimer.current) clearTimeout(unmountTimer.current); }, []);

  const run = (to: number, cb?: (result: { finished: boolean }) => void) =>
    Animated.spring(anim, { toValue: to, useNativeDriver: true, friction: 6, tension: 90 }).start(cb);
  const openMenu = () => {
    if (unmountTimer.current) { clearTimeout(unmountTimer.current); unmountTimer.current = null; }
    openRef.current = true;
    setMounted(true); setOpen(true); run(1);
  };
  const close = () => {
    openRef.current = false;
    setOpen(false);
    // Démonter dès que l'animation finit… ET filet de sécurité : si elle est INTERROMPUE, le
    // callback n'arrive jamais → les boutons restaient montés, avec leur ombre native (elevation)
    // toujours visible à l'écran. Le timer garantit le démontage dans tous les cas.
    const unmountIfStillClosed = () => { if (!openRef.current) setMounted(false); };
    run(0, unmountIfStillClosed);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(unmountIfStillClosed, 400);
  };
  // On lit openRef, pas `open` : deux taps dans la MÊME frame capturent le même `open` périmé et
  // déclenchent deux fois la même branche → état désynchronisé de l'animation.
  const toggle = () => { if (openRef.current) close(); else openMenu(); };

  const go = (route: string) => { close(); setTimeout(() => router.push(route as any), 60); };

  const enabled = flags?.quick_add_enabled !== false;      // admin : défaut activé
  const isBubble = (flags?.quick_add_mode ?? 'tabbar') === 'bubble';
  // Plus de masquage par l'utilisateur : le bouton porte la mise à jour du solde (le geste qui
  // vérifie les données). Seul l'admin peut encore le désactiver globalement.
  if (!enabled) return null;
  // Mode bulle : visible sur le Pilotage (l'écran d'accueil sur lequel on atterrit au démarrage),
  // sur les écrans « Comptes » (liste + détail d'un compte) et
  // sur la liste des « Transactions » (où il remplace les 3 boutons du haut). Jamais sur un écran de
  // SAISIE (add / edit) : y proposer une saisie n'aurait aucun sens.
  const path = pathname ?? '';
  // Jamais sur un écran de SAISIE — y compris la mise à jour de solde, qui EST une saisie.
  if (/\/(add|edit|solde)(\/|$)/.test(path)) return null;
  if (isBubble && !/(pilotage|comptes|transactions)/.test(path)) return null;

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

  // Actions EMPILÉES verticalement au-dessus du bouton (et non plus en arc) : à trois actions
  // l'arc restait lisible, à quatre les pastilles se chevauchaient et la cible devenait imprécise.
  // Une colonne se lit d'un coup d'œil et donne des zones tactiles franches.
  // Ordre de lecture : « Solde » le plus près du pouce (l'action la plus fréquente, la seule qui
  // VÉRIFIE les données), puis les saisies.
  const soldeRoute = `/(tabs)/comptes/solde${pathname ? `?origin=${encodeURIComponent(pathname)}` : ''}`;
  const ACTIONS = [
    { key: 'income', label: 'Recette', icon: 'arrow-up', color: COLORS.green ?? COLORS.emerald, route: `/(tabs)/transactions/add?type=income${acctParam}${originParam}` },
    { key: 'expense', label: 'Dépense', icon: 'arrow-down', color: COLORS.danger, route: `/(tabs)/transactions/add?type=expense${acctParam}${originParam}` },
    { key: 'transfer', label: 'Virement', icon: 'swap-horizontal', color: COLORS.blue, route: `/(tabs)/transactions/add?type=transfer${acctParam}${originParam}` },
    { key: 'balance', label: 'Mettre à jour mon solde', icon: 'refresh', color: COLORS.emerald, route: soldeRoute },
  ] as const;
  const ROW_H = ACTION_SIZE + 12;   // hauteur d'une ligne (bouton + gouttière)

  // ⚠️ TOUTES les interpolations sont BORNÉES. `anim` est un ressort : il dépasse hors de [0, 1],
  // et des taps rapprochés lui transmettent la vélocité du ressort précédent — le dépassement
  // s'amplifie. Non borné, cela donnait une opacité négative (boutons invisibles) alors que
  // `pointerEvents` restait actif : on ne voyait plus rien mais on cliquait toujours.
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'], extrapolate: 'clamp' });
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const actionOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

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
        {mounted && ACTIONS.map((a, i) => {
          // Empilement vertical : la dernière du tableau est la plus proche du « + ».
          const fromBottom = ACTIONS.length - i;
          // Position FINALE statique (cible tactile fiable sur Android) : on n'anime que scale + opacity.
          const top = -(fromBottom * ROW_H) + (FAB_SIZE - ACTION_SIZE) / 2;
          // Le menu s'ouvre vers la GAUCHE en mode bulle (le FAB colle au bord droit), et centré
          // sur le bouton en mode barre — dans les deux cas la colonne reste dans l'écran.
          const left = isBubble
            ? FAB_SIZE - ACTION_W
            : FAB_SIZE / 2 - ACTION_SIZE / 2 - (ACTION_W - ACTION_SIZE);
          const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1], extrapolate: 'clamp' });
          return (
            <Animated.View
              key={a.key}
              // Cliquable UNIQUEMENT si le menu est ouvert — et, le menu ouvert, l'opacité bornée
              // converge forcément vers 1 : « invisible mais cliquable » n'est plus atteignable.
              pointerEvents={open ? 'auto' : 'none'}
              style={[styles.action, { left, top, opacity: actionOpacity, transform: [{ scale }] }]}
            >
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => go(a.route)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                <Text style={[styles.actionLabel, { color: a.color, borderColor: a.color + '55' }]} numberOfLines={1}>
                  {a.label}
                </Text>
                <View
                  // ⚠️ Android : l'ombre `elevation` est dessinée NATIVEMENT et NE SUIT PAS l'opacité
                  // animée du parent → pendant la fermeture, le bouton devient transparent mais son
                  // ombre reste. On la coupe DÈS le début de la fermeture (`open` passe à false).
                  style={[
                    styles.actionBtn,
                    open
                      ? { shadowColor: a.color }
                      : { shadowColor: 'transparent', shadowOpacity: 0, elevation: 0 },
                  ]}
                >
                  <LinearGradient
                    colors={[a.color, darkenHex(a.color, 0.22)]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.actionGradient}
                  >
                    <Ionicons name={a.icon as any} size={24} color={'#fff'} />
                  </LinearGradient>
                </View>
              </TouchableOpacity>
            </Animated.View>
          );
        })}

        {/* Le bouton « + » — dégradé de marque + halo coloré + pulse d'attention (1×/session) */}
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          {/* Anneau de mise en avant, tracé DANS la boîte du bouton (aucune position mesurée) :
              la présentation du bouton + peut ainsi le DÉSIGNER à l'écran au lieu d'en parler
              dans le vide. Voir lib/guideHighlight. */}
          <TouchableOpacity
            style={styles.fab}
            onPress={toggle}
            // Appui long = raccourci vers la mise à jour du solde, sans passer par le menu.
            onLongPress={() => { close(); setTimeout(() => router.push(soldeRoute as any), 60); }}
            delayLongPress={400}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Saisie rapide — appui long pour mettre à jour ton solde"
          >
            <LinearGradient
              colors={[COLORS.emerald, COLORS.teal ?? COLORS.emerald]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.fabGradient}
            >
              <Animated.View style={{ transform: [{ rotate }] }}>
                <Ionicons name="add" size={36} color={'#fff'} />
              </Animated.View>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    anchor: { position: 'absolute', width: FAB_SIZE, height: FAB_SIZE, alignItems: 'center', justifyContent: 'center', zIndex: 50 },
    fab: {
      width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      // Halo COLORÉ (emerald) au lieu d'une ombre noire → le bouton « rayonne », immédiatement repérable.
      shadowColor: c.emerald, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 10,
      borderWidth: 3, borderColor: c.bg,
    },
    fabGradient: {
      width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center',
    },
    action: {
      position: 'absolute',
      width: ACTION_W,          // libellé à gauche + pastille à droite, sur une ligne
      alignItems: 'flex-end',
    },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    actionBtn: {
      width: ACTION_SIZE, height: ACTION_SIZE, borderRadius: ACTION_SIZE / 2,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      // Halo de la COULEUR de l'action (posé dynamiquement via shadowColor) → chaque bouton « rayonne ».
      shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 9, elevation: 8,
      borderWidth: 2.5, borderColor: c.bg,
    },
    actionGradient: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
    actionLabel: {
      fontSize: 12.5, fontWeight: '800',
      backgroundColor: c.cardSolid ?? c.card, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
      overflow: 'hidden', borderWidth: 1,
    },
  });
}
