import { Tabs, useSegments } from 'expo-router';
import { Platform, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useEffect } from 'react';
import TabBarBackground from '../../components/TabBarBackground';
import HeaderWithProfile from '../../components/HeaderWithProfile';
import CustomTabBar from '../../components/CustomTabBar';
import OnboardingGate from '../../components/OnboardingGate';
import QuickAddButton from '../../components/QuickAddButton';
import NextActionBanner from '../../components/NextActionBanner';
import { useAppColors } from '../../hooks/useAppColors';
import { View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { usePlan } from '../../hooks/usePlan';
import { useResponsive } from '../../hooks/useResponsive';
import WebSideNav from '../../components/web/WebSideNav';

/** Petite étoile « fonction Premium » — discrète, à droite d'un titre. */
function PremiumStar() {
  return (
    <View style={{ marginLeft: 8, width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(245,179,1,0.16)', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="star" size={11} color="#F5B301" />
    </View>
  );
}

/**
 * Header GLOBAL des onglets — rendu UNE seule fois au-dessus du navigator (plus un header par
 * écran monté/démonté à chaque switch : HeaderWithProfile + ses requêtes ne se remontent plus).
 * Tout est dérivé des segments → aucune prop de route nécessaire.
 */
function TabsHeader({ desktop = false }: { desktop?: boolean }) {
  const COLORS = useAppColors();
  const segments = useSegments();
  const fullPath = segments.join('/');
  const routeName = (segments as string[])[1] ?? '';
  const { user } = useAuth();
  const { isPremium } = usePlan(user?.id);

  const titleMap: Record<string, string> = {
    '(tabs)/pilotage': 'Tableau de bord',
    '(tabs)/projection': 'Projection',
    '(tabs)/transactions': 'Transactions',
    '(tabs)/comptes': 'Comptes',
    '(tabs)/projects': 'Projets',
    '(tabs)/reporting': 'Reporting',
    '(tabs)/conseils-ia': 'Conseils Intelligents',
    '(tabs)/tresorerie': 'Plan de trésorerie',
    '(tabs)/(secondary)/parametres': 'Paramètres',
    '(tabs)/(secondary)/categories': 'Catégories',
    '(tabs)/(secondary)/about': 'À propos',
    '(tabs)/(secondary)/admin': 'Admin',
  };

  const customHeaderPages = ['parametres', 'categories', 'about', 'admin'];
  // Toute page admin porte « Admin » dans la barre du haut : son propre nom est déjà le grand
  // titre de la page (ScreenHeader). Sans ce repli, les sous-pages non listées ci-dessus
  // affichaient « Relyka » — un libellé sans rapport avec la page consultée.
  const isAdminPath = fullPath.includes('admin');
  const displayTitle = titleMap[fullPath] || (isAdminPath ? 'Admin' : 'Relyka');
  // La route `home` a été supprimée : c'était un alias du même composant que `pilotage` (deux
  // routes, deux montages, une seule page). Le Pilotage est donc l'écran d'accueil et porte le
  // titre « Tableau de bord » — plus aucune route n'utilise l'entête « Bonjour, <prénom> », qui
  // reste le repli de HeaderWithProfile quand aucun titre n'est fourni.
  const showCustomHeader = customHeaderPages.includes(routeName) || isAdminPath;
  const isReporting = fullPath === '(tabs)/reporting';
  return (
    <HeaderWithProfile
      // Bureau : pas d'inset de barre de statut (il n'y en a pas dans un navigateur) — la barre
      // supérieure est une vraie barre de site, à hauteur fixe.
      applyTopInset={!desktop}
      desktop={desktop}
      height={desktop ? 68 : 56}
      title={showCustomHeader ? undefined : displayTitle}
      titleBadge={isReporting && isPremium ? <PremiumStar /> : undefined}
      leftContent={
        showCustomHeader ? (
          <Text style={{ fontSize: desktop ? 22 : 20, fontWeight: desktop ? '800' : '700', color: COLORS.text, letterSpacing: desktop ? -0.6 : 0 }}>
            {displayTitle}
          </Text>
        ) : undefined
      }
      showBack={false}
    />
  );
}

/**
 * Route initiale du groupe d'onglets. SANS ça, React Navigation monte la PREMIÈRE route du groupe
 * — soit `(secondary)`, et donc sa première pile (une page de réglages) — le temps de résoudre
 * l'URL réelle : au lancement et à chaque actualisation, un écran sans rapport clignotait avant le
 * Pilotage. C'est aussi ce qui garantit un retour cohérent depuis une page profonde.
 */
export const unstable_settings = { initialRouteName: 'pilotage' };

export default function TabsLayout() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // WEB BUREAU (>= 1024 px) : la navigation passe à GAUCHE (WebSideNav) et la barre d'onglets du
  // bas — convention purement tactile — disparaît. Sur natif et sur navigateur étroit, `isDesktop`
  // est faux : la barre d'onglets et tous les styles mobiles restent strictement inchangés.
  const { isDesktop } = useResponsive();

  // Web : body bg = c.bg → l'entête transparent montre la bonne couleur de fond (pas le blanc du navigateur).
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = COLORS.bg;
    }
  }, [COLORS.bg]);

  return (
    <View style={isDesktop ? styles.desktopShell : { flex: 1 }}>
    {isDesktop && <WebSideNav />}
    <View style={isDesktop ? styles.desktopMain : { flex: 1 }}>
    <Tabs
      // ⚠️ `detachInactiveScreens={false}` a été ESSAYÉ puis RETIRÉ : garder tous les écrans
      // attachés à la hiérarchie NATIVE fait grossir l'arbre de vues au fil de la session
      // (mémoire + travail de composition par frame) → dégradation progressive « plus je navigue,
      // plus c'est lent ». On laisse le défaut (détachement), qui borne la mémoire.
      // Bureau : aucune barre d'onglets (la navigation est dans la colonne de gauche).
      tabBar={isDesktop ? () => null : (props) => <CustomTabBar {...props} />}
      screenOptions={() => ({
        // PERF — MESURÉ sur device (sonde ⚡ de la CustomTabBar, 2026-07-16) : sans gel, chaque
        // changement d'onglet re-rend TOUS les écrans montés (les hooks de route — params/pathname —
        // re-rendent chaque écran à chaque navigation) → le switch EMPIRE à mesure qu'on visite des
        // onglets (472-936 ms à 2-3 onglets montés, 1015-1900 ms une fois tous montés). Avec le gel,
        // seul l'écran REVENU au premier plan rattrape son rendu : coût d'UN écran, constant.
        // Combiné à detachInactiveScreens={false} (l'arbre NATIF reste attaché, pas de re-attach)
        // et au montage différé (useDeferredMount) pour la 1ʳᵉ ouverture.
        freezeOnBlur: true,
        headerShown: true,
        header: () => <TabsHeader desktop={isDesktop} />,
        headerStyle: { backgroundColor: 'transparent' },
        headerShadowVisible: false,
        sceneContainerStyle: styles.sceneContainer,
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarStyle: [
          styles.tabBar,
          ...(Platform.OS === 'android' ? [styles.tabBarAndroid] : []),
        ],
        tabBarBackground: () => <TabBarBackground />,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarLabelPosition: 'below-icon',
        tabBarItemStyle: styles.tabBarItem,
        tabBarShowLabel: true,
      })}
    >
      <Tabs.Screen
        name="comptes"
        options={{
          title: 'Comptes',
          tabBarLabel: 'Comptes',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarLabel: 'Transactions',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
      <Tabs.Screen
        name="pilotage"
        options={{
          title: 'Pilotage',
          tabBarLabel: 'Pilotage',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projets',
          tabBarLabel: 'Projets',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'flag' : 'flag-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
      <Tabs.Screen
        name="projection"
        options={{
          title: 'Projection',
          tabBarLabel: 'Projection',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'trending-up' : 'trending-up-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
      {/* Pages cachées de la barre mais accessibles via routes */}
      <Tabs.Screen name="tresorerie" options={{ href: null, title: 'Trésorerie' }} />
      <Tabs.Screen name="reporting" options={{ href: null, title: 'Reporting' }} />
      <Tabs.Screen name="conseils-ia" options={{ href: null, title: 'Conseils Intelligents' }} />
    </Tabs>
    </View>
    <OnboardingGate />
    {/* Bureau : la saisie rapide vit dans la barre latérale (bouton « Nouvelle opération »),
        pas dans un bouton flottant tactile. */}
    {!isDesktop && <QuickAddButton />}
    <NextActionBanner />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    sceneContainer: {
      backgroundColor: c.bg,
    },
    // WEB BUREAU — coquille « site » : colonne de navigation à gauche, contenu à droite.
    // `minWidth: 0` sur la colonne principale est indispensable en flex row : sans lui, un enfant
    // large (tableau, graphique) pousse la colonne au-delà de la fenêtre et casse la mise en page.
    desktopShell: { flex: 1, flexDirection: 'row', backgroundColor: c.bg },
    desktopMain: { flex: 1, minWidth: 0, height: '100%' },
    tabBar: {
      position: 'absolute',
      borderTopWidth: 1,
      borderTopColor: c.cardBorder,
      backgroundColor: 'transparent',
      elevation: 0,
      shadowOpacity: 0,
      height: 72,
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    icon: { marginBottom: 4 },
    tabBarAndroid: {
      borderTopWidth: 0,
    },
    tabBarLabel: {
      fontSize: 11,
      fontWeight: '600',
      marginTop: 0,
    },
    tabBarItem: {
      paddingVertical: 8,
    },
  });
}
