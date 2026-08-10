/**
 * ScreenSkeleton — la SILHOUETTE d'une page, affichée le temps qu'elle se monte.
 *
 * C'était un rond de chargement sur fond vide. Un rond dit « l'app travaille » et rend l'attente
 * visible ; une silhouette dit « la page est ouverte, elle se remplit » — pour exactement le même
 * délai. C'est la moitié du ressenti de vitesse, et elle ne coûte rien : le squelette n'a ni
 * données, ni requêtes, ni calculs (cf. hooks/useDeferredMount, qui garantit que le vrai corps de
 * l'écran — donc ses hooks — ne tourne pas pendant la frame de transition).
 *
 * CINQ FORMES, pas une par écran : au-delà, les squelettes divergent des pages qu'ils annoncent et
 * deviennent un deuxième jeu de maquettes à maintenir. On vise la RECONNAISSANCE de la mise en
 * page, pas sa reproduction exacte.
 */
import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenGradient from './ScreenGradient';
import { SkeletonBlock, SkeletonCard, SkeletonRows, SkeletonTiles, SkeletonChart } from './Skeleton';
import { useAppColors } from '../hooks/useAppColors';
import { useResponsive } from '../hooks/useResponsive';
import { pageColumn } from '../lib/webLayout';

export type SkeletonVariant =
  /** Tableau de bord : grand chiffre, tuiles de décisions, cartes. */
  | 'dashboard'
  /** Liste : barre de filtres puis lignes (transactions, comptes, projets). */
  | 'list'
  /** Fiche : en-tête, carte principale, graphe, lignes (détail d'un compte, d'un projet). */
  | 'detail'
  /** Analyse : indicateurs, grand graphe, tableau (projection, reporting, trésorerie). */
  | 'chart'
  /** Formulaire : intitulés et champs (réglages, saisie). */
  | 'form';

export default function ScreenSkeleton({ variant = 'list' }: { variant?: SkeletonVariant }) {
  const COLORS = useAppColors();
  const { isDesktop } = useResponsive();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const column = pageColumn(isDesktop, variant === 'form' ? 'form' : 'dashboard');

  return (
    <View style={styles.root}>
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, column]} edges={[]}>
        {variant === 'dashboard' && (
          <>
            <SkeletonCard style={styles.gap}>
              <SkeletonBlock w="38%" h={11} />
              <SkeletonBlock w="62%" h={34} style={{ marginTop: 12 }} />
              <SkeletonBlock w="46%" h={10} style={{ marginTop: 12 }} />
            </SkeletonCard>
            <SkeletonTiles count={4} height={86} />
            <SkeletonCard style={styles.gapTop}>
              <SkeletonBlock w="52%" h={12} />
              <SkeletonBlock w="100%" h={10} style={{ marginTop: 12 }} />
              <SkeletonBlock w="74%" h={10} style={{ marginTop: 8 }} />
            </SkeletonCard>
          </>
        )}

        {variant === 'list' && (
          <>
            <View style={[styles.filterRow, styles.gap]}>
              <SkeletonBlock w={92} h={34} r={999} />
              <SkeletonBlock w={78} h={34} r={999} />
              <SkeletonBlock w={104} h={34} r={999} />
            </View>
            <SkeletonBlock w="42%" h={12} style={styles.gap} />
            <SkeletonRows rows={7} />
          </>
        )}

        {variant === 'detail' && (
          <>
            <SkeletonBlock w="100%" h={46} r={14} style={styles.gap} />
            <SkeletonCard style={styles.gap}>
              <SkeletonBlock w="56%" h={28} />
              <SkeletonChart height={140} />
            </SkeletonCard>
            <SkeletonRows rows={4} />
          </>
        )}

        {variant === 'chart' && (
          <>
            <SkeletonTiles count={3} height={68} />
            <View style={styles.gapTop}>
              <SkeletonChart height={190} />
            </View>
            <View style={styles.gapTop}>
              <SkeletonRows rows={5} />
            </View>
          </>
        )}

        {variant === 'form' && (
          <>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.gap}>
                <SkeletonBlock w="34%" h={11} />
                <SkeletonBlock w="100%" h={48} r={12} style={{ marginTop: 8 }} />
              </View>
            ))}
            <SkeletonBlock w="100%" h={52} r={12} style={styles.gapTop} />
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
    gap: { marginBottom: 16 },
    gapTop: { marginTop: 16 },
    filterRow: { flexDirection: 'row', gap: 8 },
  });
}
