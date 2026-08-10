/**
 * PageLoader — LE cercle de chargement de l'app. Une seule façon d'attendre, partout.
 *
 * Il couvre les deux moments où une page n'a rien à montrer :
 *   • l'écran se MONTE (son code s'exécute) — cf. hooks/useDeferredMount, qui rend ce composant le
 *     temps d'une frame pour que le tap d'onglet soit instantané ;
 *   • l'écran est monté mais ses DONNÉES arrivent. Sans lui, la page se dessinait en entier avec
 *     des `?? 0` : des cartes vides et des « 0 € » qui avaient l'air de vrais montants, puis qui
 *     sautaient aux vraies valeurs. Un chiffre faux affiché avec aplomb est pire qu'une attente
 *     assumée, et voir des zones se remplir une à une donne une impression de bricolage.
 *
 * RÈGLE D'USAGE : uniquement quand il n'y a AUCUNE donnée (premier chargement, démarrage à froid) —
 * jamais pendant un rafraîchissement de fond. Le cache react-query rend la quasi-totalité des
 * navigations instantanées ; remplacer une page déjà remplie par un cercle à chaque retour ferait
 * clignoter l'app et donnerait exactement l'impression de lenteur qu'on cherche à supprimer.
 * Le bon test est donc « je n'ai rien à montrer », pas « je suis en train de charger ».
 */
import { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenGradient from './ScreenGradient';
import { useAppColors } from '../hooks/useAppColors';

export default function PageLoader({ label }: {
  /** Phrase courte sous le cercle. Omise, le cercle parle tout seul. */
  label?: string;
}) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  return (
    <View style={styles.root}>
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ActivityIndicator size="large" color={COLORS.emerald} />
        {!!label && <Text style={styles.label}>{label}</Text>}
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 60 },
    label: { fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  });
}
