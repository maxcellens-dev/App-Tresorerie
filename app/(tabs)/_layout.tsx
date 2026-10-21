import { Tabs, useSegments } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useMemo, useEffect } from 'react';
import OnboardingGate from '../../components/onboarding/OnboardingGate';
import NextActionBanner from '../../components/onboarding/NextActionBanner';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useResponsive } from '../../hooks/theme/useResponsive';
import GardenTabBar, { GARDEN_TAB_ROUTES } from '../../components/garden/GardenTabBar';
import GardenTopBar from '../../components/garden/GardenTopBar';
import GardenSideNav from '../../components/garden/GardenSideNav';

const GARDEN_ROUTES = new Set<string>(GARDEN_TAB_ROUTES);
/** Titres des onglets du Jardin, affichés dans la barre du haut (plus de grand titre dans la page). */
const GARDEN_TAB_TITLES: Record<string, string> = { jardin: 'Mon jardin', argent: 'Mon argent', projets: 'Projets', pepin: 'Pépin' };
/** Titres des autres écrans (ceux qui n'en déclarent pas via ScreenHeader), dans les mots du Jardin. */
const GARDEN_TITLES: Record<string, string> = {
  comptes: 'Mes comptes', transactions: 'Opérations', projects: 'Budgets',
  tresorerie: 'Plan de trésorerie', reporting: 'Reporting', 'conseils-ia': 'Pépin · tes questions',
  succes: 'Succès', boutique: 'Boutique', premium: 'Plan', parametres: 'Paramètres', categories: 'Catégories',
};

/**
 * Barre du haut GLOBALE des onglets — rendue une seule fois au-dessus du navigateur.
 * Onglets du Jardin : leur nom ; autres pages : un retour et le titre (déclaré par la page via
 * ScreenHeader, sinon celui de GARDEN_TITLES).
 */
function TabsHeader({ desktop = false }: { desktop?: boolean }) {
  const segments = useSegments() as string[];
  const fullPath = segments.join('/');
  // Dernier segment RÉEL de la route, groupes Expo Router exclus.
  const routeName = segments.filter((s) => !s.startsWith('(')).pop() ?? '';
  if (GARDEN_ROUTES.has(routeName)) return <GardenTopBar main title={GARDEN_TAB_TITLES[routeName]} applyTopInset={!desktop} />;
  // « add » existe pour les comptes ET les opérations : le chemin tranche.
  const pathTitle = fullPath.includes('comptes/add') ? 'Nouveau compte' : fullPath.includes('admin') ? 'Admin' : undefined;
  return <GardenTopBar title={pathTitle ?? GARDEN_TITLES[routeName]} applyTopInset={!desktop} />;
}

/**
 * Route initiale du groupe d'onglets. SANS ça, React Navigation monte la PREMIÈRE route du groupe
 * — soit `(secondary)`, et donc sa première pile (une page de réglages) — le temps de résoudre
 * l'URL réelle : au lancement et à chaque actualisation, un écran sans rapport clignotait.
 */
export const unstable_settings = { initialRouteName: 'jardin' };

export default function TabsLayout() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // WEB BUREAU (>= 1024 px) : navigation à GAUCHE (GardenSideNav), pas de barre d'onglets en bas.
  const { isDesktop } = useResponsive();

  // Web : body bg = c.bg → l'entête montre la bonne couleur de fond (pas le blanc du navigateur).
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = COLORS.bg;
    }
  }, [COLORS.bg]);

  return (
    <View style={isDesktop ? styles.desktopShell : { flex: 1 }}>
      {isDesktop && <GardenSideNav />}
      <View style={isDesktop ? styles.desktopMain : { flex: 1 }}>
        <Tabs
          // ⚠️ `detachInactiveScreens={false}` a été ESSAYÉ puis RETIRÉ : l'arbre de vues natif
          // grossissait au fil de la session (« plus je navigue, plus c'est lent »).
          tabBar={isDesktop ? () => null : (props) => <GardenTabBar {...props} />}
          screenOptions={{
            // PERF — mesuré sur appareil : sans gel, chaque changement d'onglet re-rend TOUS les
            // écrans montés. Avec le gel, seul l'écran revenu au premier plan rattrape son rendu.
            freezeOnBlur: true,
            headerShown: true,
            header: () => <TabsHeader desktop={isDesktop} />,
            headerStyle: { backgroundColor: 'transparent' },
            headerShadowVisible: false,
            sceneStyle: styles.sceneContainer,
          }}
        >
          {/* Les quatre espaces du Jardin (barre GardenTabBar) */}
          <Tabs.Screen name="jardin" options={{ title: 'Jardin' }} />
          <Tabs.Screen name="argent" options={{ title: 'Mon argent' }} />
          <Tabs.Screen name="projets" options={{ title: 'Projets' }} />
          <Tabs.Screen name="pepin" options={{ title: 'Pépin' }} />
          {/* Écrans de détail, atteints depuis le Jardin */}
          <Tabs.Screen name="comptes" options={{ href: null, title: 'Comptes' }} />
          <Tabs.Screen name="transactions" options={{ href: null, title: 'Opérations' }} />
          <Tabs.Screen name="projects" options={{ href: null, title: 'Budgets' }} />
          <Tabs.Screen name="projection" options={{ href: null, title: 'Projection' }} />
          <Tabs.Screen name="tresorerie" options={{ href: null, title: 'Plan de trésorerie' }} />
          <Tabs.Screen name="reporting" options={{ href: null, title: 'Reporting' }} />
          <Tabs.Screen name="conseils-ia" options={{ href: null, title: 'Pépin · tes questions' }} />
          {/* Ancienne adresse du tableau de bord : redirige vers le Jardin (liens et notifications). */}
          <Tabs.Screen name="pilotage" options={{ href: null, title: 'Jardin' }} />
        </Tabs>
      </View>
      <OnboardingGate />
      <NextActionBanner />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    sceneContainer: { backgroundColor: c.bg },
    // WEB BUREAU — coquille « site » : colonne de navigation à gauche, contenu à droite.
    // `minWidth: 0` est indispensable en flex row : sans lui, un enfant large pousse la colonne.
    desktopShell: { flex: 1, flexDirection: 'row', backgroundColor: c.bg },
    desktopMain: { flex: 1, minWidth: 0, height: '100%' },
  });
}
