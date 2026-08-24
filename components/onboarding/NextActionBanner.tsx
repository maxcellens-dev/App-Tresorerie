// Bandeau « prochain geste » — overlay en HAUT de l'écran (sous le header), non bloquant.
// Affiche l'UNIQUE action prioritaire (moteur d'état). Dismissable ; réapparaît à la prochaine
// ouverture de l'app tant que l'action reste pertinente (dismiss = mémoire de SESSION uniquement).
// Visible UNIQUEMENT sur le Pilotage (jamais par-dessus un écran de saisie).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Animated, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAppState } from '../../hooks/engagement/useAppState';
import { useAppLockPrompt } from '../../hooks/platform/useAppLockPrompt';
import type { AppAction, AppActionType } from '../../lib/engagement/appStateEngine';
import { openClosureModal } from '../closure/MonthlyClosure';

// Dismiss de SESSION : réinitialisé au prochain lancement de l'app (module rechargé) → l'action
// pertinente réapparaît. Ne pas persister (c'est voulu).
const dismissedThisSession = new Set<string>();

// Persistance légère (web : localStorage ; natif : repli mémoire de session).
const memoryFlags = new Set<string>();
function flagGet(key: string): boolean {
  if (memoryFlags.has(key)) return true;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key) === '1';
  } catch {}
  return false;
}
function flagSet(key: string): void {
  memoryFlags.add(key);
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(key, '1');
  } catch {}
}

/** « Tout est à jour » : montré UNE fois par mois. */
function okSeenKey(): string {
  const n = new Date();
  return `relyka_ok_banner_${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
/** « Compte commun à découvert » : max 1 fois par semaine et par compte (clé = lundi de la semaine). */
function weekKey(): string {
  const d = new Date();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

const ICONS: Record<AppActionType, string> = {
  setup: 'construct-outline',
  shared_mode: 'people-outline',
  app_lock: 'finger-print',
  soft_close: 'lock-closed-outline',
  check_balance: 'wallet-outline',
  joint_low: 'warning-outline',
};

/**
 * Carte du bandeau (présentation pure) — partagée entre l'overlay réel et l'aperçu admin
 * (admin/banners-preview) pour que l'aperçu reste EXACTEMENT le rendu de production.
 */
export function ActionBannerCard({ action, onPress, onDismiss }: {
  action: AppAction;
  onPress?: () => void;
  onDismiss?: () => void;
}) {
  const COLORS = useAppColors();
  const styles = React.useMemo(() => makeStyles(COLORS), [COLORS]);
  const accent = action.type === 'joint_low' ? COLORS.orange
    : action.positive ? COLORS.green : COLORS.emerald;

  /* ── DEUX ACTIONS CÔTE À CÔTE, JAMAIS L'UNE DANS L'AUTRE ────────────────────────────────────────
     La carte entière portait l'action principale, et la croix de fermeture vivait DEDANS. Sur
     react-native-web, `accessibilityRole="button"` produit un vrai `<button>` : on obtenait donc un
     bouton imbriqué dans un bouton, ce que le HTML interdit — React le signale à chaque rendu, et la
     navigation au clavier n'atteint plus la croix.
     La carte redevient donc un simple conteneur, et ses deux actions sont SŒURS : la zone principale
     (icône + textes + chevron) et la croix. Aucune des deux ne perd son rôle — le correctif habituel
     de l'app (`insidePressable`, cf. components/ui/InfoDot) sacrifie le rôle de l'élément intérieur ;
     ici la croix est une vraie action, elle doit rester un bouton.
     Le rendu ne bouge pas : la carte garde son fond, sa bordure et ses marges intérieures, la zone
     principale reprend la même rangée (`flex: 1`, même espacement). */
  const content = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: accent + '22' }]}>
        <Ionicons name={ICONS[action.type] as any} size={23} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{action.title}</Text>
        {/* Message complet, jamais tronqué (peut faire plusieurs lignes). */}
        <Text style={styles.reason}>
          {action.reason}{action.eta ? ` · ${action.eta}` : ''}
        </Text>
      </View>
      {(action.deeplink || action.interactive) && !action.positive && (
        <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
      )}
    </>
  );

  return (
    <View style={[styles.banner, action.positive && styles.bannerPositive, { borderColor: accent + '55' }]}>
      {/* Sans geste à proposer (bandeau purement informatif), pas de bouton du tout : un `<button>`
          qui ne fait rien est annoncé comme cliquable par les lecteurs d'écran. */}
      {onPress ? (
        <TouchableOpacity
          style={styles.main}
          activeOpacity={(action.deeplink || action.interactive) ? 0.85 : 1}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={action.title}
        >
          {content}
        </TouchableOpacity>
      ) : (
        <View style={styles.main}>{content}</View>
      )}
      {onDismiss && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.close}>
          <Ionicons name="close" size={16} color={COLORS.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function NextActionBanner() {
  const COLORS = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const action = useAppState();
  const appLock = useAppLockPrompt();
  const [, force] = useState(0);
  const styles = React.useMemo(() => makeStyles(COLORS), [COLORS]);

  // Animation d'entrée (slide-down + fade) à chaque nouvelle action affichée.
  const anim = useRef(new Animated.Value(0)).current;
  const lastKey = useRef<string | null>(null);

  // Auto-effacement : état positif ~5 s (marqué « vu ce mois-ci ») ; « Vérifie ton solde » 15 s
  // (ne reste jamais à l'infini — il reviendra à la prochaine ouverture tant que non vérifié).
  useEffect(() => {
    if (!action) return;
    if (action.positive) {
      flagSet(okSeenKey());
      const id = setTimeout(() => { dismissedThisSession.add(action.dismissKey); force((n) => n + 1); }, 5000);
      return () => clearTimeout(id);
    }
    if (action.type === 'check_balance') {
      const id = setTimeout(() => { dismissedThisSession.add(action.dismissKey); force((n) => n + 1); }, 15000);
      return () => clearTimeout(id);
    }
    if (action.type === 'joint_low') {
      flagSet(`relyka_jl_${action.dismissKey}_${weekKey()}`);
    }
  }, [action?.dismissKey, action?.positive, action?.type]);

  // Uniquement sur le Pilotage (jamais par-dessus une saisie ou un autre écran).
  const onPilotage = segments[segments.length - 1] === 'pilotage';

  const visible = (() => {
    if (!action || !onPilotage) return false;
    /* CLÔTURE : c'est la BANNIÈRE INTÉGRÉE au Pilotage qui porte cette invitation, pas ce bandeau
       flottant. Les deux disaient la même chose et ouvraient la même modale — mais celui-ci se
       superpose au tableau de bord, et sur l'écran qui compte le plus il masque justement les
       chiffres qu'on vient consulter. La bannière intégrée, elle, prend sa place dans le flux :
       elle pousse le contenu vers le bas au lieu de le recouvrir. Une seule invitation, et c'est
       celle qui ne gêne pas la lecture. */
    if (action.type === 'soft_close') return false;
    if (dismissedThisSession.has(action.dismissKey)) return false;
    // « Tout est à jour » déjà vu ce mois-ci (session précédente) → pas de ré-affichage.
    if (action.positive && flagGet(okSeenKey()) && !memoryFlags.has(`shown_${okSeenKey()}`)) return false;
    // « Compte commun à découvert » déjà signalé cette semaine (session précédente) → silence.
    if (action.type === 'joint_low' && flagGet(`relyka_jl_${action.dismissKey}_${weekKey()}`)
      && !memoryFlags.has(`shown_jl_${action.dismissKey}_${weekKey()}`)) return false;
    return true;
  })();

  useEffect(() => {
    if (visible && action && lastKey.current !== action.dismissKey) {
      lastKey.current = action.dismissKey;
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }).start();
    }
  }, [visible, action?.dismissKey, anim]);

  if (!visible || !action) return null;
  if (action.positive) memoryFlags.add(`shown_${okSeenKey()}`);           // affiché CETTE session → laisser finir le timer
  if (action.type === 'joint_low') memoryFlags.add(`shown_jl_${action.dismissKey}_${weekKey()}`);

  const onPress = () => {
    // Proposition du verrouillage : le tap DÉCLENCHE l'activation (invite OS) au lieu de naviguer.
    // Invite annulée → on ne marque rien, le bandeau reste (l'utilisateur pourra le fermer).
    if (action.type === 'app_lock') {
      appLock.activate().then((ok) => {
        if (ok) {
          Alert.alert(
            'Verrouillage activé',
            "Relyka te demandera ton empreinte / Face ID (ou le code de ton téléphone) au prochain lancement. Tu peux le désactiver à tout moment dans Paramètres.",
          );
        }
      }).catch(() => {});
      return;
    }
    /* Clôture : la modale vit sur le Pilotage, c'est-à-dire là où ce bandeau s'affiche. Naviguer
       vers la même route ne la rouvre donc pas — on l'ouvre directement. Repli sur le deeplink si
       elle n'est pas montée (bandeau affiché depuis un autre écran). */
    if (action.type === 'soft_close' && openClosureModal()) return;
    if (action.deeplink) router.push(action.deeplink as any);
  };
  const onDismiss = () => {
    // Fermeture manuelle de la proposition de verrouillage → définitive (drapeau local à l'appareil).
    if (action.type === 'app_lock') appLock.dismiss().catch(() => {});
    dismissedThisSession.add(action.dismissKey);
    force((n) => n + 1);
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        { top: insets.top + 58 }, // sous le header (ne recouvre plus l'avatar / les flammes)
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] },
      ]}
      pointerEvents="box-none"
    >
      <ActionBannerCard action={action} onPress={onPress} onDismiss={onDismiss} />
    </Animated.View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    // WEB : le bandeau est monté à la RACINE, donc hors de toute colonne d'app. Sur un écran
    // d'ordinateur, `left/right: 12` l'étirait sur toute la fenêtre (un bandeau de 1900 px de large
    // avec 40 caractères dedans). On le plafonne et on le recentre — sur mobile, l'écran est plus
    // étroit que 620 px, donc le rendu est strictement identique.
    wrap: {
      position: 'absolute', left: 12, right: 12, zIndex: 50, elevation: 50,
      ...(Platform.OS === 'web' ? { maxWidth: 620, alignSelf: 'center', marginHorizontal: 'auto' as any } : {}),
    },
    banner: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.cardSolid ?? c.card, borderWidth: 1.5, borderRadius: 18,
      paddingVertical: 16, paddingHorizontal: 16,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
        android: { elevation: 9 },
        default: { boxShadow: '0 6px 18px rgba(0,0,0,0.18)' } as any,
      }),
    },
    bannerPositive: { opacity: 0.97 },
    /* Zone d'action principale : la MÊME rangée que portait la carte (icône, textes, chevron), pour
       que le rendu soit identique au pixel une fois la croix sortie du bouton. */
    main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    reason: { fontSize: 13, color: c.textSecondary, marginTop: 2, lineHeight: 18 },
    close: { padding: 4, marginLeft: 2 },
  });
}
