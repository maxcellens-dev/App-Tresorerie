// Bandeau « prochain geste » — overlay en HAUT de l'écran (au-dessus du contenu), non bloquant.
// Affiche l'UNIQUE action prioritaire (moteur d'état). Dismissable ; réapparaît à la prochaine
// ouverture de l'app tant que l'action reste pertinente (dismiss = mémoire de SESSION uniquement).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppColors } from '../hooks/useAppColors';
import { useAppState } from '../hooks/useAppState';
import type { AppActionType } from '../lib/appStateEngine';

// Dismiss de SESSION : réinitialisé au prochain lancement de l'app (module rechargé) → l'action
// pertinente réapparaît. Ne pas persister (c'est voulu).
const dismissedThisSession = new Set<string>();

const ICONS: Record<AppActionType, string> = {
  setup: 'construct-outline',
  shared_mode: 'people-outline',
  soft_close: 'lock-closed-outline',
  check_balance: 'wallet-outline',
  joint_low: 'warning-outline',
  ok: 'checkmark-circle',
};

export default function NextActionBanner() {
  const COLORS = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const action = useAppState();
  const [, force] = useState(0);
  const styles = React.useMemo(() => makeStyles(COLORS), [COLORS]);

  // L'état positif s'efface tout seul au bout de quelques secondes (discret).
  useEffect(() => {
    if (action?.positive) {
      const id = setTimeout(() => { dismissedThisSession.add(action.dismissKey); force((n) => n + 1); }, 4500);
      return () => clearTimeout(id);
    }
  }, [action?.dismissKey, action?.positive]);

  if (!action) return null;
  if (dismissedThisSession.has(action.dismissKey)) return null;

  const accent = action.type === 'joint_low' ? COLORS.orange
    : action.positive ? COLORS.green : COLORS.emerald;

  const onPress = () => {
    if (action.deeplink) router.push(action.deeplink as any);
  };
  const onDismiss = () => { dismissedThisSession.add(action.dismissKey); force((n) => n + 1); };

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.banner, action.positive && styles.bannerPositive, { borderColor: accent + '55' }]}
        activeOpacity={action.deeplink ? 0.85 : 1}
        onPress={onPress}
        accessibilityRole="button"
      >
        <View style={[styles.iconWrap, { backgroundColor: accent + '22' }]}>
          <Ionicons name={ICONS[action.type] as any} size={23} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{action.title}</Text>
          <Text style={styles.reason} numberOfLines={2}>
            {action.reason}{action.eta ? ` · ${action.eta}` : ''}
          </Text>
        </View>
        {action.deeplink && !action.positive && (
          <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
        )}
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.close}>
          <Ionicons name="close" size={16} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50, elevation: 50 },
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
    iconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    reason: { fontSize: 13, color: c.textSecondary, marginTop: 2, lineHeight: 18 },
    close: { padding: 4, marginLeft: 2 },
  });
}
