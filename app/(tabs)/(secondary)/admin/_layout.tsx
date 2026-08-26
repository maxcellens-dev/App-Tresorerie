/**
 * Gabarit des pages d'administration — et LE point de contrôle d'accès du panneau.
 *
 * ── POURQUOI LE GARDE EST ICI, ET PAS DANS CHAQUE PAGE ──────────────────────────────────────────
 * Seul le panneau d'accueil (`admin/index`) refusait les non-administrateurs. Les vingt et une
 * autres pages — utilisateurs, notifications de masse, centre de sécurité, éditeur de style — se
 * rendaient normalement pour n'importe quel compte connecté qui en tapait l'adresse. Les DONNÉES,
 * elles, restaient protégées (les politiques d'accès font foi, cf. migration 204 pour `app_config`),
 * mais l'écran s'ouvrait quand même : formulaires vides, listes vides, boutons d'envoi de masse
 * cliquables, et des refus techniques incompréhensibles à chaque geste. On ne montre pas une porte
 * qu'on va claquer à chaque fois.
 * Posé sur le gabarit, le contrôle couvre toutes les pages d'un coup — celles d'aujourd'hui comme
 * celles qu'on ajoutera.
 *
 * ⚠️ C'est un garde-fou d'INTERFACE. La vraie barrière reste la politique d'accès côté base : ce
 * fichier évite l'égarement, il ne remplace aucune règle serveur.
 */
import { Stack } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/data/useProfile';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import PageLoader from '../../../../components/layout/PageLoader';
import { useNavBack } from '../../../../hooks/platform/useNavBack';

export default function AdminLayout() {
  const COLORS = useAppColors();
  const { isDesktop } = useResponsive();
  const goBack = useNavBack();
  const { user, loading: authLoading } = useAuth();
  /* `isSuccess` : tant que le profil n'a pas RÉPONDU, `is_admin` vaut faux par DÉFAUT et non par
     réponse — un administrateur se verrait refuser l'accès une fraction de seconde à chaque
     ouverture, voire durablement sur une connexion lente. On attend de savoir. */
  const { data: profile, isSuccess, isError } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;

  /* On n'attend QUE dans le seul cas où l'attente a un sens : une lecture réellement en cours.
     Sans utilisateur, ou après une lecture en ÉCHEC, on ne saura pas davantage en patientant — et
     un cercle qui tourne indéfiniment est la pire des réponses. On refuse : un refus se corrige
     d'un rechargement, un accès accordé faute de preuve ne se rattrape pas. */
  const stillLoading = authLoading || (!!user?.id && !isSuccess && !isError);
  if (stillLoading) return <PageLoader />;

  if (!isAdmin) {
    return (
      <View style={styles(COLORS).root}>
        <ScreenGradient />
        <SafeAreaView style={[styles(COLORS).safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Panneau Admin" onBack={goBack} />
          <Text style={styles(COLORS).text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false, // Parent (tabs) layout handles headers
        contentStyle: { backgroundColor: COLORS.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Panneau Admin' }} />
      <Stack.Screen name="style-editor" options={{ title: 'Style Editor' }} />
      <Stack.Screen name="seo-center" options={{ title: 'SEO Center' }} />
      <Stack.Screen name="stats-hub" options={{ title: 'Stats Hub' }} />
      <Stack.Screen name="suggestions" options={{ title: 'Suggestions' }} />
      <Stack.Screen name="conseils" options={{ title: 'Conseils' }} />
      <Stack.Screen name="gamification" options={{ title: 'Gamification' }} />
      <Stack.Screen name="ads" options={{ title: 'Publicités' }} />
      <Stack.Screen name="landing" options={{ title: "Page d'accueil" }} />
      <Stack.Screen name="users" options={{ title: 'Utilisateurs' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="app-update" options={{ title: "Mise à jour de l'App" }} />
      <Stack.Screen name="pouls" options={{ title: 'État des lieux' }} />
      <Stack.Screen name="reliability" options={{ title: 'Fiabilité & confiance' }} />
      <Stack.Screen name="usage-limits" options={{ title: "Limites d'usage" }} />
      <Stack.Screen name="security" options={{ title: 'Centre de sécurité' }} />
    </Stack>
  );
}

const styles = (c: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  text: { color: c.text, fontSize: 15, marginTop: 12 },
});
