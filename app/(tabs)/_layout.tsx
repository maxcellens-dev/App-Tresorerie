import { Tabs, useSegments } from 'expo-router';
import { Platform, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TabBarBackground from '../components/TabBarBackground';
import HeaderWithProfile from '../components/HeaderWithProfile';
import CustomTabBar from '../components/CustomTabBar';

const COLORS = {
  tabActive: '#34d399',
  tabInactive: '#94a3b8',
  screenBg: '#020617',
};

function TabsHeader({ route }: { route: any }) {
  const segments = useSegments();
  const fullPath = segments.join('/');
  
  const titleMap: Record<string, string> = {
    '(tabs)/pilotage': '',
    '(tabs)/transactions': 'Transactions',
    '(tabs)/treasury-plan': 'Plan de trésorerie',
    '(tabs)/accounts': 'Comptes',
    '(tabs)/reporting': 'Reporting',
    '(tabs)/(secondary)/profile': 'Profil',
    '(tabs)/(secondary)/settings': 'Paramètres',
    '(tabs)/(secondary)/categories': 'Catégories',
    '(tabs)/(secondary)/theme': 'Thème',
    '(tabs)/(secondary)/about': 'À propos',
    '(tabs)/(secondary)/admin': 'Panneau Admin',
    '(tabs)/(secondary)/admin/style-editor': 'Style Editor',
    '(tabs)/(secondary)/admin/seo-center': 'SEO Center',
    '(tabs)/(secondary)/admin/stats-hub': 'Stats Hub',
  };
  
  const customHeaderPages = ['profile', 'settings', 'categories', 'theme', 'about', 'admin'];
  const routeName = route.name;
  const displayTitle = titleMap[fullPath] || 'MyTreasury';
  const isHome = route.name === 'home';
  const showCustomHeader = customHeaderPages.includes(routeName) || fullPath.includes('admin');
  const showBack = customHeaderPages.includes(routeName) || fullPath.includes('admin');

  return (
    <HeaderWithProfile
      title={isHome || showCustomHeader ? undefined : displayTitle}
      leftContent={
        (showCustomHeader || fullPath.includes('admin')) ? (
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#ffffff' }}>
            {displayTitle}
          </Text>
        ) : undefined
      }
      showBack={showBack}
    />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={({ route }) => ({
        headerShown: true,
        header: () => <TabsHeader route={route} />,
        headerStyle: { backgroundColor: 'rgba(2, 6, 23, 0.98)' },
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
        name="treasury-plan"
        options={{
          title: 'Plan de trésorerie',
          tabBarLabel: 'Tréso',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: 'Comptes',
          tabBarLabel: 'Comptes',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
      <Tabs.Screen
        name="reporting"
        options={{
          title: 'Reporting',
          tabBarLabel: 'Reporting',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'bar-chart' : 'bar-chart-outline'} size={24} color={color} style={styles.icon} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  sceneContainer: {
    backgroundColor: COLORS.screenBg,
  },
  tabBar: {
    position: 'absolute',
    borderTopWidth: 1,
    borderTopColor: 'rgba(30, 41, 59, 0.8)',
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
