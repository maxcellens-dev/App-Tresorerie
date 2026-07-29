import { useMemo, useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider, MutationCache, useQueryClient, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { prefetchPilotageData } from '../hooks/usePilotageData';
import { hydrateThemeCache } from '../lib/themeBoot';
import { hydrateQueryCache, startQueryPersist } from '../lib/queryPersist';
import { View, StyleSheet, Platform, useWindowDimensions, LogBox, BackHandler, AppState } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import AnimatedSplash from '../components/AnimatedSplash';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { TourProvider } from '../contexts/TourContext';
import { GuideProvider } from '../contexts/GuideContext';
import { AppIntroGate } from '../components/guide/AppIntroCarousel';
import { CalculatorProvider } from '../contexts/CalculatorContext';
import Calculator from '../components/Calculator';
import UpdateBanner from '../components/UpdateBanner';
import AchievementCelebration from '../components/AchievementCelebration';
import PulseHost from '../components/PulseHost';
import PulseDeltaHost from '../components/PulseDeltaHost';
import DataPrefetcher from '../components/DataPrefetcher';
import NavPerfProbe from '../components/NavPerfProbe';
import { RootPortalHost } from '../lib/rootPortal';
import { useConfigSync } from '../hooks/useConfigSync';
import { useMaterializeRecurring } from '../hooks/useMaterializeRecurring';
import { useMaterializeCredits } from '../hooks/useMaterializeCredits';
import { supabase } from '../lib/supabase';
import HeaderWithProfile from '../components/HeaderWithProfile';
import { legalPresentation } from '../components/LegalLayout';
import { DESKTOP_MIN_WIDTH } from '../hooks/useResponsive';
import ImpersonationBanner from '../components/ImpersonationBanner';
import { setAnalyticsUser, logEvent, trackScreen } from '../lib/analytics';
import { recordRoute, consumePreviousRoute } from '../lib/navHistory';
import ProfileChangeModal from '../components/ProfileChangeModal';
import ProfileTourConclusion from '../components/ProfileTourConclusion';
import StreakRecoveryModal from '../components/StreakRecoveryModal';
import FontApplier from '../components/FontApplier';
import GamificationSync from '../components/GamificationSync';
import AppDialogHost from '../components/AppDialogHost';
import SeoHead from '../components/SeoHead';
import SignOutVeil from '../components/SignOutVeil';
import SecurityGate from '../components/SecurityGate';
import AppLockGate from '../components/AppLockGate';
import GlobalErrorBoundary from '../components/GlobalErrorBoundary';
import { installGlobalErrorReporting } from '../lib/errorReporting';
import { useAppColors } from '../hooks/useAppColors';
import { useCurrency } from '../hooks/useCurrency';
import { useRatesAutoRefresh } from '../hooks/useRatesAutoRefresh';
import { useProfile } from '../hooks/useProfile';
import { useSetPremium, usePlan } from '../hooks/usePlan';
import { handleUsageLimitError, setCachedIsPremium, getCachedIsPremium } from '../lib/usageLimits';
import { PURCHASES_SUPPORTED, configurePurchases, logInPurchases, isProActive, addProListener } from '../lib/purchases';
import { PUSH_SUPPORTED, getDevicePushTokenAsync } from '../lib/pushNotifications';
import { maybeApplyUpdateOnLaunch } from '../lib/otaUpdate';
import './global.css';

// expo-router v4 scanne TOUS les fichiers de app/ comme des routes : nos dossiers non-route
// (hooks/, lib/, contexts/, theme/, services/, types/, components/) déclenchent un console.error
// « missing the required default export » par fichier → mur de LogBox qui masque l'écran en dev.
// C'est inoffensif (expo-router les ignore ensuite). On masque ce bruit dev + les warnings de style
// dépréciés des libs. À terme : sortir ces dossiers de app/ (cf. docs/MIGRATION_SDK52.md).
if (__DEV__) {
  LogBox.ignoreLogs([
    /missing the required default export/,
    /"(textShadow|shadow)\*" style props are deprecated/,
  ]);
}

// Charge AU PLUS TÔT le dernier thème connu (AsyncStorage natif) → l'app s'ouvre dans le thème de
// l'utilisateur même hors-ligne (le profil ne se chargera pas), au lieu du sombre par défaut.
hydrateThemeCache();

// Capture globale des exceptions/rejets non gérés → Centre de sécurité (client_errors). Installé au
// plus tôt pour couvrir même les erreurs de démarrage. Fire-and-forget, jamais bloquant.
installGlobalErrorReporting();

// Détection RÉSEAU (NetInfo → onlineManager de react-query). Hors-ligne, les requêtes se METTENT EN
// PAUSE (au lieu d'échouer en boucle et de vider le cache) ; à la RECONNEXION elles reprennent
// automatiquement (refetchOnReconnect par défaut) → plus besoin de redémarrer l'app.
//
// ⚠️ BLINDAGE : si le module natif NetInfo est ABSENT (build/OTA reçue par un binaire qui ne l'a pas
// encore), toute erreur ici doit être avalée — sinon crash au démarrage = app figée. En cas d'échec,
// onlineManager reste en mode par défaut (« toujours en ligne ») → comportement d'avant (les requêtes
// échouent hors-ligne au lieu de se mettre en pause), mais l'app DÉMARRE.
if (typeof NetInfo?.addEventListener === 'function') {
  onlineManager.setEventListener((setOnline) => {
    try {
      return NetInfo.addEventListener((state) => setOnline(state.isConnected !== false));
    } catch {
      setOnline(true); // natif indisponible → on considère « en ligne »
      return () => {};
    }
  });
}

// Empêche le splash natif de se cacher tout seul : on le garde jusqu'à ce que notre splash animé
// soit à l'écran (transition invisible natif → animé). Natif uniquement (no-op / non requis sur web).
if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(() => {});
  // Le splash natif s'efface en FONDU au-dessus d'AnimatedSplash (première frame identique :
  // même logo, même taille, même position) → jonction invisible.
  try { SplashScreen.setOptions({ fade: true, duration: 350 }); } catch { /* API absente : masquage sec */ }
  // Filet de sécurité : ne jamais rester bloqué sur le splash natif si l'UI tarde / échoue.
  setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 4000);
}

const queryClient = new QueryClient({
  // Backstop GLOBAL : toute mutation bloquée par une limite serveur (USAGE_LIMIT_*) affiche le
  // message convivial (→ page Plan / « supprime des éléments »), quel que soit le point de création.
  mutationCache: new MutationCache({
    onError: (error) => { handleUsageLimitError(error, getCachedIsPremium()); },
  }),
  defaultOptions: {
    queries: {
      // PERF (thread JS) : chaque refetch qui aboutit re-rend TOUS les écrans montés abonnés à la
      // requête — et ce travail entre en concurrence avec la navigation en cours (d'où « plus je
      // navigue, plus c'est lent »). On coupe donc le churn automatique à la source :
      //  • fraîcheur portée à 10 min (au lieu de 2) ;
      //  • plus de refetch au montage d'écran (`refetchOnMount: false`).
      // La fraîcheur reste garantie SANS refetch de fond : invalidations explicites après CHAQUE
      // mutation (transactions/comptes/projets…), realtime Supabase pour les comptes partagés, et
      // ForegroundRefetch au retour de l'app en avant-plan.
      staleTime: 1000 * 60 * 10,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  },
});

// Offline : réhydrate le cache persisté (dernières données connues) AVANT le montage des écrans, puis
// sauvegarde en continu. Fire-and-forget : la lecture AsyncStorage est rapide et couverte par le splash.
hydrateQueryCache(queryClient);
startQueryPersist(queryClient);

function ConfigSync() {
  useConfigSync(supabase);
  return null;
}

// PERF démarrage : précharge les données de Pilotage (écran d'accueil) DÈS que l'utilisateur est
// connu, en parallèle du profil — au lieu d'attendre la redirection puis un 2ᵉ aller-retour. Collapse
// la cascade session → profil → pilotage. Voir prefetchPilotageData.
function PilotagePrefetch() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => { prefetchPilotageData(qc, user?.id); }, [user?.id, qc]);
  return null;
}

// Reconnexion sans redémarrer : au retour en AVANT-PLAN, on rafraîchit les requêtes actives PÉRIMÉES
// (`stale: true` respecte la fraîcheur → pas de churn si tout est frais). Rattrape « il faut
// actualiser page par page » après une coupure. NB : détecter la reconnexion pendant que l'app reste
// au premier plan exige NetInfo (module natif → prochaine build) ; ceci couvre le cas courant.
function ForegroundRefetch() {
  const qc = useQueryClient();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') qc.refetchQueries({ type: 'active', stale: true }).catch(() => {});
    });
    return () => sub.remove();
  }, [qc]);
  return null;
}

// Tient à jour le statut premium pour le backstop global des limites (handler react-query hors React).
function UsagePremiumSync() {
  const { user } = useAuth();
  const { isPremium } = usePlan(user?.id);
  useEffect(() => { setCachedIsPremium(isPremium); }, [isPremium]);
  return null;
}

/** Synchronise l'abonnement RevenueCat (natif) avec le droit Premium (profiles.is_premium).
 *  Sur mobile, RevenueCat fait foi : achat confirmé → Premium ; expiration/annulation effective → retrait.
 *  Aucun effet sur le web (PURCHASES_SUPPORTED = false). */
function PurchasesSync() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const setPremium = useSetPremium(user?.id);
  const isPremiumDb = !!(profile as any)?.is_premium;
  // Premium « manuel » (offert par un admin) : on ne le retire JAMAIS via RevenueCat.
  const isManual = !!(profile as any)?.premium_manual;
  const isPremiumRef = useRef(isPremiumDb);
  const isManualRef = useRef(isManual);
  useEffect(() => { isPremiumRef.current = isPremiumDb; }, [isPremiumDb]);
  useEffect(() => { isManualRef.current = isManual; }, [isManual]);

  useEffect(() => {
    if (!PURCHASES_SUPPORTED || !user?.id) return;
    let unsub = () => {};
    let cancelled = false;
    const apply = (active: boolean) => {
      if (active && !isPremiumRef.current) setPremium.mutate(true);
      // Rétrogradation UNIQUEMENT si le Premium n'est pas un grant manuel admin.
      else if (!active && isPremiumRef.current && !isManualRef.current) setPremium.mutate(false);
    };
    (async () => {
      await configurePurchases(user.id);
      await logInPurchases(user.id);
      if (cancelled) return;
      apply(await isProActive());
      unsub = addProListener(apply);
    })();
    return () => { cancelled = true; unsub(); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Enregistre le jeton push Expo de l'appareil (natif uniquement) quand l'utilisateur
 *  est connecté et que les notifications sont activées dans ses Paramètres. */
function PushRegistrar() {
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const notifEnabled = (profile as any)?.notifications_enabled ?? true;

  useEffect(() => {
    if (!PUSH_SUPPORTED || !user?.id || !profile || isImpersonating) return;
    if (!notifEnabled) return;
    let cancelled = false;
    (async () => {
      const device = await getDevicePushTokenAsync();
      if (cancelled || !device || !supabase) return;
      await supabase.from('push_tokens').upsert(
        { profile_id: user.id, token: device.token, platform: device.platform, updated_at: new Date().toISOString() },
        { onConflict: 'profile_id,token' },
      );
    })();
    return () => { cancelled = true; };
  }, [user?.id, !!profile, notifEnabled, isImpersonating]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Suit le chemin courant pour permettre un « Retour » fiable vers la vraie page précédente
 *  (cf. useNavBack), indépendamment de la pile de navigation imbriquée. Toujours monté. */
function RouteHistoryTracker() {
  const pathname = usePathname();
  useEffect(() => { recordRoute(pathname); }, [pathname]);
  return null;
}

function RecurringMaterializer() {
  const { user } = useAuth();
  // On matérialise AUSSI en mode admin « connecté en tant que » : sinon les occurrences récurrentes
  // passées ne deviennent pas de vraies transactions → le SOLDE des comptes (page Comptes) ne les
  // inclut pas, alors que le suivi/les transactions les projettent (incohérence épargne/invest). Les
  // écritures admin sont autorisées (migration 102 : is_app_admin), donc consulter reflète le réel.
  useMaterializeRecurring(user?.id);
  // Échéances de crédit échues → vraies transactions (migration 143), même logique et mêmes raisons.
  useMaterializeCredits(user?.id);
  return null;
}

/** Suivi d'usage : app_open (1×/session) + screen_view à chaque changement de page.
 *  Désactivé en mode « connecté en tant que » pour ne pas polluer les stats du compte cible. */
function AnalyticsTracker() {
  const { user, isImpersonating } = useAuth();
  const pathname = usePathname();
  const openedFor = useRef<string | null>(null);

  useEffect(() => { setAnalyticsUser(isImpersonating ? null : (user?.id ?? null)); }, [user?.id, isImpersonating]);

  useEffect(() => {
    if (!user?.id || isImpersonating) return;
    if (openedFor.current !== user.id) {
      openedFor.current = user.id;
      logEvent('app_open');
    }
  }, [user?.id, isImpersonating]);

  useEffect(() => {
    if (!user?.id || !pathname || isImpersonating) return;
    trackScreen(pathname);
  }, [pathname, user?.id, isImpersonating]);

  return null;
}

function AppChrome() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  useCurrency(); // synchronise le symbole de devise global avec le profil
  useRatesAutoRefresh(); // admin : met à jour les taux de change ~1×/jour
  const segments = useSegments();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { user, loading, passwordRecovery, signingOut } = useAuth();
  const root = segments[0] ?? 'index';
  const isAuthPage = root === 'index' || root === 'welcome' || root === 'login' || root === 'register' || root === 'reset-password';
  // Pendant le questionnaire, on masque l'en-tête (profil) : l'utilisateur doit le terminer.
  // Les pages légales gardent l'en-tête de l'app quand l'utilisateur est connecté (sinon : en-tête « site »).
  // Le socle de démarrage porte sa propre progression et n'a rien à faire d'un en-tête « Bonjour X »
  // avec la série et le compteur de guide : l'utilisateur n'est pas encore *dans* l'app.
  const hideChrome = isAuthPage || root === 'questionnaire' || root === 'onboarding';
  const isTabs = root === '(tabs)';
  // Sur web bureau : on limite la largeur de l'app (colonne centrée ~840 px), comme une app mobile.
  // Exceptions pleine largeur : page d'accueil marketing (welcome/index).
  // Pages légales : pleine largeur (habillage « site web ») UNIQUEMENT en bureau (web large).
  // En mobile/app (largeur < 900 px), elles s'affichent dans la colonne d'app comme les autres pages.
  const isLegalRoot = root === 'confidentialite' || root === 'legal';
  // Les pages légales portent elles-mêmes leur habillage large — soit le « site » (visiteur public),
  // soit la coquille d'app avec barre latérale (utilisateur connecté en bureau). Dans les deux cas
  // elles doivent recevoir TOUTE la largeur ; c'est `legalPresentation` (composants/LegalLayout) qui
  // tranche, pour que les deux fichiers ne puissent pas se contredire.
  const isDesktopLegal = isLegalRoot && legalPresentation(windowWidth, !!user) !== 'app';
  const limitWidth = Platform.OS === 'web'
    && root !== 'welcome' && root !== 'index'
    && !isDesktopLegal;

  // ── WEB BUREAU (>= 1024 px) ────────────────────────────────────────────────────────────────
  // La colonne « téléphone » de 840 px bordée à gauche et à droite est ce qui donnait à Relyka son
  // air d'app mobile posée au milieu d'un écran vide. En bureau on la supprime :
  //  • (tabs) → pleine largeur : le gabarit de site (barre latérale + contenu) est monté par
  //    app/(tabs)/_layout, qui centre lui-même son contenu.
  //  • authentification → carte étroite centrée (un formulaire de 1400 px n'existe pas).
  //  • parcours (démarrage, questionnaire, notifications…) → colonne de lecture confortable.
  // En dessous de 1024 px, RIEN ne change : on garde la colonne d'app historique.
  const isDesktopWeb = Platform.OS === 'web' && windowWidth >= DESKTOP_MIN_WIDTH;
  const isAuthForm = root === 'login' || root === 'register' || root === 'reset-password';
  const desktopColumnStyle = !isDesktopWeb || !limitWidth
    ? null
    : isTabs ? styles.fullColumn
    : isAuthForm ? styles.authColumn
    : styles.readingColumn;

  // Lien de réinitialisation de mot de passe → écran dédié (prioritaire sur le reste).
  useEffect(() => {
    if (passwordRecovery && root !== 'reset-password') router.replace('/reset-password');
  }, [passwordRecovery, root]);

  // Auth guard: redirect via useEffect so the Stack always mounts first
  useEffect(() => {
    if (loading) return;
    if (passwordRecovery) return; // ne pas court-circuiter la réinitialisation
    // Déconnexion en cours : la destination est DÉJÀ /welcome, mais `user` reste renseigné tant
    // que le signOut réseau n'a pas répondu. Sans ce garde, la branche ci-dessous nous renverrait
    // aussitôt sur '/' → aller-retour visible avant d'atterrir enfin sur l'accueil.
    if (signingOut) return;
    if (isTabs && !user) {
      router.replace('/welcome');
    } else if (user && (root === 'welcome' || root === 'login' || root === 'register')) {
      // Rediriger vers l'index : il décide setup / questionnaire / home
      // selon l'avancement de l'onboarding (ne pas court-circuiter le questionnaire).
      router.replace('/');
    }
  }, [loading, user, isTabs, root, signingOut]);

  // Bouton retour PHYSIQUE Android : retour FIABLE vers la page réellement précédente (via
  // navHistory), au lieu du dépilage par défaut de la pile imbriquée qui atterrit sur une page
  // obsolète ou Comptes. Même logique que le bouton « Retour » in-app (useNavBack).
  const isAuthPageRef = useRef(isAuthPage);
  isAuthPageRef.current = isAuthPage;
  const backPathname = usePathname();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBack = () => {
      // Sur les pages d'auth (welcome/login…) : comportement par défaut (quitter l'app).
      if (isAuthPageRef.current) return false;
      const prev = consumePreviousRoute();
      if (prev) { router.navigate(prev as any); return true; }
      return false; // aucune page précédente (racine) → défaut (quitter l'app)
    };
    // Ré-abonnement à chaque navigation : notre handler reste le dernier enregistré (donc appelé
    // en premier), prioritaire sur le retour par défaut de la pile imbriquée.
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [router, backPathname]);

  return (
    <TourProvider>
    <GuideProvider>
    <View style={styles.root}>
      <View style={desktopColumnStyle ?? (limitWidth ? styles.webColumn : styles.fullColumn)}>
      <AppDialogHost />
      <SeoHead />
      <ImpersonationBanner />
      {!hideChrome && user && !isTabs && root !== 'legal' && root !== 'confidentialite' && (
        <SafeAreaView edges={['top']} style={styles.headerSafe}>
          <HeaderWithProfile height={80} />
        </SafeAreaView>
      )}
      <View style={styles.content}>
        {/* Transitions en FONDU (pas de slide) : l'accueil apparaît EN PLACE sous le splash,
            plus d'effet « écran qui arrive de la gauche ». */}
        <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.bg } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'Relyka' }} />
          <Stack.Screen name="welcome" options={{ title: 'Relyka' }} />
          <Stack.Screen name="login" options={{ title: 'Connexion' }} />
          <Stack.Screen name="register" options={{ title: 'Inscription' }} />
          <Stack.Screen name="onboarding" options={{ title: 'Démarrage' }} />
          <Stack.Screen name="questionnaire" options={{ title: 'Profil financier' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="confidentialite" options={{ title: 'Confidentialité' }} />
          <Stack.Screen name="legal" options={{ title: 'Mentions légales' }} />
          <Stack.Screen name="reset-password" options={{ title: 'Réinitialiser le mot de passe' }} />
        </Stack>
      </View>
      </View>
      {/* Écrans de présentation de l'app (toute première ouverture) — montés À LA RACINE pour ne
          pas dépendre du chargement de l'écran d'arrivée. Voir contexts/GuideContext. */}
      {user && <AppIntroGate />}
      {/* Modale de changement de profil — affichée au-dessus de tout */}
      {isTabs && user && <ProfileChangeModal userId={user.id} />}
      {/* Conclusion du parcours : le profil financier, montré UNE fois, après la dernière bulle. */}
      {isTabs && user && <ProfileTourConclusion />}
      {/* Récupération de série perdue — proposée à l'arrivée sur l'app */}
      {isTabs && user && <StreakRecoveryModal />}
      <AnalyticsTracker />
      <RouteHistoryTracker />
      {/* Calculatrice flottante globale — visible quand ouverte, par-dessus tout */}
      <Calculator />
      {/* Bandeau « mise à jour disponible » (descend du haut) */}
      <UpdateBanner />
      {/* Célébration globale d'un succès débloqué (par-dessus tout) */}
      <AchievementCelebration />
      {/* LE POULS — rendez-vous hebdo/mensuel + réponse immédiate à chaque saisie.
          Montés au niveau RACINE : les pastilles apparaissent quel que soit l'écran d'où
          l'utilisateur a validé son opération (saisie, virement, saisie rapide…). */}
      {isTabs && user && <PulseHost />}
      {isTabs && user && <PulseDeltaHost />}
      {/* Sonde de perf navigation (admin) — badge « ⚡ ms · page » sur TOUTES les pages. */}
      {user && <NavPerfProbe />}
      {/* Cible des portails racine (guide de présentation) — MÊME fenêtre que le contenu, au-dessus
          de la navigation → surlignages alignés au pixel sur les boutons réels. Voir lib/rootPortal. */}
      <RootPortalHost />
      {/* Coupure globale (kill switch) — voile plein écran par-dessus tout quand l'admin verrouille
          l'app (attaque/piratage). Les admins ne sont pas bloqués (bandeau d'alerte seulement). */}
      <SecurityGate />
      {/* Verrouillage biométrique optionnel (par appareil) — par-dessus tout quand actif + connecté. */}
      <AppLockGate />
      {/* Voile de déconnexion — TOUT EN HAUT de la pile : rien de ce qui se démonte, se vide ou
          change de thème pendant la déconnexion ne doit être visible. */}
      <SignOutVeil />
    </View>
    </GuideProvider>
    </TourProvider>
  );
}

export default function RootLayout() {
  // Splash animé : natif uniquement (le web a déjà son boot-loader HTML dans app/+html.tsx).
  const [splashDone, setSplashDone] = useState(Platform.OS === 'web');

  // OTA : application de la mise à jour Expo dès la 1ʳᵉ réouverture (DÉSACTIVÉ par défaut → no-op
  // tant que le flag dans lib/otaUpdate est à false ; voir ce fichier pour l'activation).
  useEffect(() => { maybeApplyUpdateOnLaunch(); }, []);
  return (
    // KeyboardProvider : pilote les KeyboardAvoidingView de react-native-keyboard-controller (chats).
    // `statusBarTranslucent` : l'app dessine derrière la barre d'état. ⚠️ La lib PATCHE le module
    // StatusBar de react-native : monter le <StatusBar> de RN (défaut translucent:false) écrase cette
    // prop → barre blanche en haut. Toujours utiliser expo-status-bar dans les écrans.
    <KeyboardProvider statusBarTranslucent>
      <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <CalculatorProvider>
              <ConfigSync />
              <PilotagePrefetch />
              <DataPrefetcher />
              <ForegroundRefetch />
              <UsagePremiumSync />
              <FontApplier />
              <RecurringMaterializer />
              <GamificationSync />
              <PurchasesSync />
              <PushRegistrar />
              <AppChrome />
              {!splashDone && (
                <AnimatedSplash
                  onReady={() => { SplashScreen.hideAsync().catch(() => {}); }}
                  onDone={() => setSplashDone(true)}
                />
              )}
            </CalculatorProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
      </GlobalErrorBoundary>
    </KeyboardProvider>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    fullColumn: { flex: 1, width: '100%' },
    // Colonne centrée pour le web ÉTROIT (tablette / petite fenêtre) : largeur d'app « mobile ».
    webColumn: { flex: 1, width: '100%', maxWidth: 840, alignSelf: 'center', borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.cardBorder },
    // Web BUREAU : colonnes sans bordures — l'app n'est plus « une app dans un cadre », c'est la page.
    authColumn: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
    readingColumn: { flex: 1, width: '100%', maxWidth: 880, alignSelf: 'center' },
    headerSafe: {
      paddingHorizontal: 24,
      paddingTop: 6,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.cardBorder,
      backgroundColor: c.bg,
    },
    content: { flex: 1 },
  });
}
