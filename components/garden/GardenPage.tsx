/**
 * Coquille d'une page du Jardin : fond, marge du haut, en-tête, défilement, tirer pour actualiser.
 *
 * Les quatre onglets du Jardin n'ont PAS l'en-tête global des onglets (masqué dans le layout) : la
 * page applique donc elle-même la marge de la barre d'état (`edges: top`). Les pages secondaires,
 * elles, passent par ScreenHeader comme le reste de l'app.
 *
 * Tant que les polices du Jardin ne sont pas chargées, rien n'est peint (pas de saut de police).
 *
 * BUREAU (web ≥ 1024 px) : même règle que toutes les pages de l'app — UNE largeur de page
 * (contentWidth, 1180 px centrés, gouttières de site) ; le pied de page suit le même cadre et son
 * bouton prend la largeur de son contenu plutôt que toute la page.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import GardenText from './GardenText';
import GardenGlow from './GardenGlow';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { GARDEN_COLORS, GARDEN_SPACE } from '../../lib/garden/theme';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { contentWidth } from '../../lib/ui/webLayout';
import CalculatorButton from '../transaction/CalculatorButton';
import type { CalculatorPageId } from '../../hooks/config/useUiPrefs';

interface Props {
  /** Grand titre de la page (ou un en-tête complet via `header`). */
  title?: string;
  subtitle?: string;
  header?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Contenu épinglé sous le défilement (le bouton qui conclut). */
  footer?: ReactNode;
  /** Page de détail ouverte par-dessus un onglet : l'en-tête global gère déjà le haut. */
  secondary?: boolean;
  /**
   * Page dont le bas est un écran existant qui DÉFILE déjà lui-même (ex. la trésorerie) : le haut
   * (titre + enfants) reste fixe et `fill` occupe le reste — jamais un défilement dans un défilement.
   */
  fill?: ReactNode;
  /** Page qui propose la calculatrice flottante (si l'utilisateur l'a retenue dans les Paramètres). */
  calculator?: CalculatorPageId;
}

export default function GardenPage({ title, subtitle, header, children, refreshing, onRefresh, footer, secondary, fill, calculator }: Props) {
  const fontsReady = useGardenFonts();
  const { isDesktop } = useResponsive();
  /* Thème (clair/sombre, accent) : la clé change → tout le contenu se redessine avec les nouvelles
     couleurs (les composants du Jardin lisent GARDEN_COLORS au rendu). */
  const C = useAppColors();
  const themeKey = `${C.mode}|${C.primary}`;
  return (
    <View key={themeKey} style={{ flex: 1, backgroundColor: GARDEN_COLORS.bg }}>
      <StatusBar style={C.mode === 'dark' ? 'light' : 'dark'} />
      <GardenGlow />
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
        {!fontsReady ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={GARDEN_COLORS.primary} />
        ) : fill ? (
          <View style={{ flex: 1 }}>
            <View style={[{ paddingHorizontal: GARDEN_SPACE.lg, paddingTop: isDesktop ? GARDEN_SPACE.xxl : GARDEN_SPACE.md, paddingBottom: GARDEN_SPACE.sm, gap: GARDEN_SPACE.md }, contentWidth(isDesktop)]}>
              {header ?? null}
              {children}
            </View>
            <View style={{ flex: 1 }}>{fill}</View>
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={[{ paddingHorizontal: GARDEN_SPACE.lg, paddingTop: isDesktop ? GARDEN_SPACE.xxl : GARDEN_SPACE.md, paddingBottom: 32, gap: GARDEN_SPACE.md }, contentWidth(isDesktop)]}
              refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={GARDEN_COLORS.primary} /> : undefined}
            >
              {/* Le titre est dans la barre du haut (place gagnée) ; seul le sous-titre reste ici. */}
              {header ?? (subtitle ? <GardenText variant="small" color={GARDEN_COLORS.muted} style={{ paddingHorizontal: 4 }}>{subtitle}</GardenText> : null)}
              {children}
            </ScrollView>
            {footer ? (
              <View style={[{ paddingHorizontal: GARDEN_SPACE.lg, paddingBottom: GARDEN_SPACE.md, paddingTop: GARDEN_SPACE.sm }, contentWidth(isDesktop), isDesktop ? { alignItems: 'flex-end' } : null]}>
                <View style={isDesktop ? { width: 380 } : null}>{footer}</View>
              </View>
            ) : null}
          </>
        )}
      </SafeAreaView>
      {calculator ? <CalculatorButton page={calculator} /> : null}
    </View>
  );
}

/** État de chargement / d'erreur d'une page du Jardin, avec Pico. */
export function GardenWaiting({ message }: { message: string }) {
  return (
    <View style={{ alignItems: 'center', gap: GARDEN_SPACE.md, paddingTop: 60 }}>
      <ActivityIndicator color={GARDEN_COLORS.primary} />
      <GardenText variant="body" color={GARDEN_COLORS.inkSoft} center>{message}</GardenText>
    </View>
  );
}

/**
 * Deux colonnes sur bureau, une seule sur téléphone (dans l'ordre : `left` puis `right`).
 * `ratio` = part de la colonne de gauche. Chaque colonne garde l'espacement vertical de la page.
 */
export function GardenColumns({ left, right, ratio = 0.5 }: { left: ReactNode; right: ReactNode; ratio?: number }) {
  const { isDesktop } = useResponsive();
  if (!isDesktop) return <>{left}{right}</>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: GARDEN_SPACE.xl }}>
      <View style={{ flex: ratio, minWidth: 0, gap: GARDEN_SPACE.md }}>{left}</View>
      <View style={{ flex: 1 - ratio, minWidth: 0, gap: GARDEN_SPACE.md }}>{right}</View>
    </View>
  );
}

/** Grille de cartes : 1 colonne sur téléphone, `cols` sur bureau. */
export function GardenGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  const { isDesktop } = useResponsive();
  if (!isDesktop) return <>{children}</>;
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GARDEN_SPACE.md }}>
      {items.map((c, i) => <View key={i} style={{ width: `${100 / cols - 1.5}%`, flexGrow: 1, minWidth: 0 }}>{c}</View>)}
    </View>
  );
}
