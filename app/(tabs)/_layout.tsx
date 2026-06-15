import { Tabs, useSegments } from 'expo-router';
import { Platform, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import TabBarBackground from '../components/TabBarBackground';
import HeaderWithProfile from '../components/HeaderWithProfile';
import CustomTabBar from '../components/CustomTabBar';
import OnboardingGate from '../components/OnboardingGate';
import { useAppColors } from '../hooks/useAppColors';
import { View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { usePlan } from '../hooks/usePlan';

/** Petite étoile « fonction Premium » — discrète, à droite d'un titre. */
function PremiumStar() {
  return (
    <View style={{ marginLeft: 8, width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(245,179,1,0.16)', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="star" size={11} color="#F5B301" />
    </View>
  );
}

function TabsHeader({ route }: { route: any }) {
  const COLORS = useAppColors();
  const segments = useSegments();
  const fullPath = segments.join('/');
  const { user } = useAuth();
  const { isPremium } = usePlan(user?.id);

  const titleMap: Record<string, string> = {
    '(tabs)/pilotage': 'Tableau de bord',
    '(tabs)/projection': 'Projection',
    '(tabs)/transactions': 'Transactions',
    '(tabs)/comptes': 'Comptes',
    '(tabs)/projects': 'Projets',
    '(tabs)/reporting': 'Reporting',
    '(tabs)/tresorerie': 'Plan de trésorerie',
    '(tabs)/(secondary)/parametres': 'Paramètres',
    '(tabs)/(secondary)/categories': 'Catégories',
    '(tabs)/(secondary)/about': 'À propos',
    '(tabs)/(secondary)/admin': 'Admin',
    '(tabs)/(secondary)/admin/style-editor': 'Style Editor',
    '(tabs)/(secondary)/admin/seo-center': 'SEO Center',
    '(tabs)/(secondary)/admin/stats-hub': 'Stats Hub',
    '(tabs)/(secondary)/admin/suggestions': 'Suggestions',
  };

  const customHeaderPages = ['parametres', 'categories', 'about', 'admin'];
  const routeName = route.name;
  const displayTitle = titleMap[fullPath] || 'Relyka';
  const isHome = route.name === 'home';
  const showCustomHeader = customHeaderPages.includes(routeName) || fullPath.includes('admin');
  const isReporting = fullPath === '(tabs)/reporting';
  return (
    <HeaderWithProfile
      title={isHome || showCustomHeader ? undefined : displayTitle}
      titleBadge={isReporting && isPremium ? <PremiumStar /> : undefined}
      leftContent={
        (showCustomHeader || fullPath.includes('admin')) ? (
          <Text style={{ fontSize: 20, fontWeight: '700', color: COLORS.text }}>
            {displayTitle}
          </Text>
        ) : undefined
      }
      showBack={false}
    />
  );
}

export default function TabsLayout() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);

  // Web : body bg = c.bg → l'entête transparent montre la bonne couleur de fond (pas le blanc du navigateur).
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = COLORS.bg;
    }
  }, [COLORS.bg]);

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={({ route }) => ({
        headerShown: true,
        header: () => <TabsHeader route={route} />,
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
      <Tabs.Screen name="objectives" options={{ href: null, title: 'Objectifs' }} />
      <Tabs.Screen name="reporting" options={{ href: null, title: 'Reporting' }} />
    </Tabs>
    <OnboardingGate />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    sceneContainer: {
      backgroundColor: c.bg,
    },
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
