/**
 * ScreenSkeleton — coquille ultralégère affichée 1 frame pendant le montage différé d'un écran
 * lourd (cf. hooks/useDeferredMount) : fond du thème + spinner discret. Aucune donnée, aucun calcul.
 */
import { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import ScreenGradient from './ScreenGradient';
import { useAppColors } from '../hooks/useAppColors';

export default function ScreenSkeleton() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  return (
    <View style={styles.root}>
      <ScreenGradient />
      <ActivityIndicator size="small" color={COLORS.emerald} style={styles.spinner} />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    spinner: { marginTop: 120 },
  });
}
