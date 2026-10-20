import { useEffect, useMemo, useRef } from 'react';
/**
 * ScreenHeader — en-tête standard des écrans secondaires/formulaires :
 * une ligne « ← Retour » puis un grand titre. Identique aux pages Boutique, Premium, etc.
 * (remplace l'ancien encart boxé HeaderWithProfile sur les écrans de création/édition).
 */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import * as Router from 'expo-router';
import { setHeaderTitle } from '../../lib/garden/headerTitle';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { isGardenPalette } from '../../lib/garden/gardenPalette';

export default function ScreenHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = Router.useRouter();
  /* JARDIN : la barre du haut (toujours visible) porte déjà le retour et l'accès au profil. */
  const garden = isGardenPalette(COLORS);
  /* JARDIN : le nom de la page s'affiche dans la barre du haut (place gagnée), déclaré à chaque
     retour sur la page — rangé par chemin, il ne déborde jamais sur une autre page. */
  // (Le titre est rangé par chemin : pas besoin de le redéclarer au retour sur la page.)
  /* ⚠️ Le chemin de CETTE page, figé au montage : usePathname suit la route AFFICHÉE, et une page
     restée montée dessous (pile) réécrivait sinon son titre sur la page du dessus (« Mon profil »
     partout). */
  const current: string = (Router as any).usePathname?.() ?? '';
  const path = useRef(current).current;
  useEffect(() => { if (garden && path) setHeaderTitle(path, title); }, [garden, path, title]);
  if (garden) return right ? <View style={[styles.titleRow, { justifyContent: 'flex-end' }]}>{right}</View> : null;
  return (
    <View>
      {(
      <TouchableOpacity style={styles.backRow} onPress={() => (onBack ? onBack() : router.back())} accessibilityRole="button">
        <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>
      )}
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {right}
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
    title: { flex: 1, fontSize: 26, fontWeight: '800', color: c.text },
  });
}
