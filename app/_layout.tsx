import { useMemo, useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider, MutationCache, useQueryClient, onlineManager, focusManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { prefetchPilotageData } from '../hooks/pilotage/usePilotageData';
import { hydrateThemeCache } from '../lib/platform/themeBoot';
import { hydrateQueryCache, startQueryPersist, getHydratedKeys } from '../lib/platform/queryPersist';
import { View, StyleSheet, Platform, useWindowDimensions, LogBox, BackHandler, AppState, Alert } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import AnimatedSplash from '../components/system/AnimatedSplash';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { GuideProvider } from '../contexts/GuideContext';
import { AppIntroGate } from '../components/guide/AppIntroCarousel';
import { CalculatorProvider } from '../contexts/CalculatorContext';
import Calculator from '../components/transaction/Calculator';
import UpdateBanner from '../components/system/UpdateBanner';
import AchievementCelebration from '../components/gamification/AchievementCelebration';
import PulseHost from '../components/pulse/PulseHost';
import PulseDeltaHost from '../components/pulse/PulseDeltaHost';
import DataPrefetcher from '../components/system/DataPrefetcher';
import { RootPortalHost } from '../lib/rootPortal';
import { useConfigSync } from '../hooks/config/useConfigSync';
import { useMaterializeRecurring } from '../hooks/data/useMaterializeRecurring';
import { useMaterializeCredits } from '../hooks/data/useMaterializeCredits';
import { supabase } from '../lib/platform/supabase';
import HeaderWithProfile from '../components/layout/HeaderWithProfile';
import { legalPresentation } from '../components/legal/LegalLayout';
import { DESKTOP_MIN_WIDTH } from '../hooks/theme/useResponsive';
import ImpersonationBanner from '../components/system/ImpersonationBanner';
import { setAnalyticsUser, logEvent, trackScreen } from '../lib/platform/analytics';
import { recordRoute, consumePreviousRoute, parentRoute, resetRouteTo } from '../lib/ui/navHistory';
import ProfileChangeModal from '../components/ui/ProfileChangeModal';
import ProfileTourConclusion from '../components/onboarding/ProfileTourConclusion';
import LiveProfileSync from '../components/system/LiveProfileSync';
import FontApplier from '../components/system/FontApplier';
import GamificationSync from '../components/gamification/GamificationSync';
import AppDialogHost from '../components/system/AppDialogHost';
import SeoHead from '../components/system/SeoHead';
import SignOutVeil from '../components/system/SignOutVeil';
import SecurityGate from '../components/system/SecurityGate';
import AppLockGate from '../components/system/AppLockGate';
import GlobalErrorBoundary from '../components/system/GlobalErrorBoundary';
import { installGlobalErrorReporting } from '../lib/platform/errorReporting';
import { useAppColors } from '../hooks/theme/useAppColors';
import { useCurrency } from '../hooks/data/useCurrency';
import { useRatesAutoRefresh } from '../hooks/data/useRatesAutoRefresh';
import { useProfile } from '../hooks/data/useProfile';
import { useAwaitPremiumFromServer, usePlan } from '../hooks/config/usePlan';
import { handleUsageLimitError, setCachedIsPremium, getCachedIsPremium } from '../lib/finance/usageLimits';
import { reportUnhandledWriteError } from '../lib/ui/writeErrors';
import { PURCHASES_SUPPORTED, configurePurchases, logInPurchases, isProActive, addProListener } from '../lib/platform/purchases';
import { PUSH_SUPPORTED, getDevicePushTokenAsync } from '../lib/platform/pushNotifications';
import PushPermissionPrompt from '../components/system/PushPermissionPrompt';
import { maybeApplyUpdateOnLaunch } from '../lib/platform/otaUpdate';
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

/* ── L'APP EN ARRIÈRE-PLAN NE DOIT PLUS INTERROGER LE SERVEUR ────────────────────────────────
   Plusieurs écrans se rafraîchissent tout seuls (`refetchInterval`) : les pastilles « non lu » de
   l'assistance toutes les 30 s — depuis l'en-tête, donc dans TOUTE l'app —, la liste des demandes
   toutes les 20 s, un fil ouvert toutes les 8 s. react-query suspend ces minuteurs quand la fenêtre
   n'est plus au premier plan… à condition qu'on lui dise ce qu'est le premier plan. Sur mobile, il
   n'en sait rien par défaut : les requêtes continuaient donc de partir, téléphone en poche et écran
   éteint — du réseau et de la batterie dépensés pour un écran que personne ne regarde.
   Au retour, react-query rafraîchit ce qui a vieilli : rien n'est perdu, c'est même plus à jour. */
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => sub.remove();
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
  /* Backstop GLOBAL des ÉCHECS D'ÉCRITURE (cf. lib/ui/writeErrors).
     1. Une limite serveur (USAGE_LIMIT_*) garde son message dédié → page Plan / « supprime des
        éléments », quel que soit le point de création.
     2. TOUT LE RESTE — réseau coupé, refus RLS, session expirée — était jusqu'ici avalé sans un
        mot dès que l'appelant faisait un simple `.mutate()`. L'écran revenait à la normale et
        l'utilisateur croyait son montant enregistré. Un appelant qui a mieux à dire écrase ce
        message par le sien (react-query appelle les gestionnaires du plus global au plus local) ;
        une mutation qui doit rester muette le déclare (`meta: { silentError: true }`). */
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      void handleUsageLimitError(error, getCachedIsPremium()).then((handled) => {
        reportUnhandledWriteError(error, handled, mutation, (title, message) => Alert.alert(title, message));
      });
    },
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

  /* ── REVALIDATION AU DÉMARRAGE — le pendant indispensable du cache persisté ─────────────────
     Le cache réhydraté peint la première page instantanément, mais `refetchOnMount: false` (posé
     plus haut pour éviter le churn de navigation) signifie qu'une donnée périmée réhydratée ne se
     rafraîchirait JAMAIS toute seule : l'app afficherait sans broncher les montants du dernier
     démarrage. C'est pire qu'un chargement.

     DEUX PRÉCAUTIONS, apprises en écrivant ce bloc :
       • on ne revalide QUE les clés réellement réhydratées. Un `refetchQueries` en bloc relancerait
         aussi les requêtes qui viennent d'arriver du réseau — un aller-retour complet pour rien, au
         démarrage, c'est-à-dire au pire moment ;
       • on attend que l'arbre soit monté. Déclenché à `t = 0`, ce balayage ne trouvait AUCUNE
         requête « active » (la racine se monte avant les écrans) : il ne faisait rien, et la donnée
         périmée restait affichée indéfiniment. Un correctif silencieusement inopérant. */
  useEffect(() => {
    const keys = getHydratedKeys();
    if (keys.length === 0) return;
    const t = setTimeout(() => {
      for (const key of keys) {
        qc.refetchQueries({ queryKey: [key], type: 'active', stale: true }).catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(t);
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

/**
 * Aligne l'écran sur l'abonnement RevenueCat (natif). RevenueCat fait foi ; c'est le SERVEUR qui en
 * tire les conséquences.
 *
 * ⚠️ Ce composant ÉCRIVAIT `profiles.is_premium` depuis le téléphone. Comme l'app parle directement
 * à la base avec le jeton de son utilisateur, la même écriture pouvait être envoyée à la main :
 * l'abonnement payant s'offrait en une requête. La colonne est verrouillée depuis la migration 203,
 * et le webhook RevenueCat pose le droit côté serveur. Il ne reste donc ici qu'à RELIRE le profil
 * quand le store dit quelque chose de différent de la base — le temps que le webhook arrive.
 *
 * Aucun effet sur le web (PURCHASES_SUPPORTED = false).
 */
function PurchasesSync() {
  /* ⚠️ JAMAIS EN CONSULTATION ADMIN. En mode « connecté en tant que », `user.id` est celui du compte
     CONSULTÉ alors que le téléphone, lui, reste celui de l'administrateur. Sans ce garde, on
     appelait `Purchases.logIn(<compte consulté>)` : le magasin de l'administrateur se retrouvait
     rattaché à l'identité RevenueCat de quelqu'un d'autre — et le premier achat ou la première
     restauration TRANSFÉRAIT l'abonnement de l'admin vers ce compte. On laisse donc l'identité
     RevenueCat sur l'administrateur réel ; elle est reprise dès qu'il quitte la consultation. */
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const awaitPremium = useAwaitPremiumFromServer(user?.id);
  const isPremiumDb = !!(profile as any)?.is_premium;
  // Premium « manuel » (offert par un admin) : le serveur ne le retire jamais via RevenueCat.
  const isManual = !!(profile as any)?.premium_manual;
  const isPremiumRef = useRef(isPremiumDb);
  const isManualRef = useRef(isManual);
  useEffect(() => { isPremiumRef.current = isPremiumDb; }, [isPremiumDb]);
  useEffect(() => { isManualRef.current = isManual; }, [isManual]);

  useEffect(() => {
    if (!PURCHASES_SUPPORTED || !user?.id || isImpersonating) return;
    let unsub = () => {};
    let cancelled = false;
    const apply = (active: boolean) => {
      // Le store et la base disent la même chose → rien à attendre.
      if (active === isPremiumRef.current) return;
      // Une rétrogradation ne concerne pas un Premium offert par un administrateur.
      if (!active && isManualRef.current) return;
      awaitPremium(active).catch(() => {});
    };
    (async () => {
      await configurePurchases(user.id);
      await logInPurchases(user.id);
      if (cancelled) return;
      apply(await isProActive());
      unsub = addProListener(apply);
    })();
    return () => { cancelled = true; unsub(); };
  }, [user?.id, isImpersonating]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Les pages légales gardent l'en-tête de l'app quand l'utilisateur est connecté (sinon : en-tête « site »).
  // Le socle de démarrage porte sa propre progression et n'a rien à faire d'un en-tête « Bonjour X »
  // avec la série et le compteur de guide : l'utilisateur n'est pas encore *dans* l'app.
  // (`questionnaire` et `onboarding` ont disparu avec la refonte du démarrage — cf. plus bas.)
  const hideChrome = isAuthPage || root === 'setup';
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
  //  • authentification → PLEINE LARGEUR, et c'est l'écran lui-même qui centre sa carte
  //    (lib/webLayout.authPage/authCard). Le brider ici à 480 px produisait une bande verticale
  //    pleine hauteur aux couleurs de l'app : un écran de téléphone posé au milieu du vide, alors
  //    qu'un site montre une carte posée SUR la page.
  //  • parcours (démarrage, questionnaire, notifications…) → colonne de lecture confortable.
  // En dessous de 1024 px, RIEN ne change : on garde la colonne d'app historique.
  const isDesktopWeb = Platform.OS === 'web' && windowWidth >= DESKTOP_MIN_WIDTH;
  const isAuthForm = root === 'login' || root === 'register' || root === 'reset-password';
  const desktopColumnStyle = !isDesktopWeb || !limitWidth
    ? null
    : isTabs || isAuthForm ? styles.fullColumn
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
      // Pas d'historique (reprise de session, lien profond) : on remonte d'un cran plutôt que de
      // laisser la pile imbriquée dépiler n'importe où — même règle que le bouton « Retour »
      // in-app (cf. useNavBack).
      const parent = parentRoute(backPathname);
      if (parent) { resetRouteTo(parent); router.navigate(parent as any); return true; }
      return false; // déjà à la racine → défaut (quitter l'app)
    };
    // Ré-abonnement à chaque navigation : notre handler reste le dernier enregistré (donc appelé
    // en premier), prioritaire sur le retour par défaut de la pile imbriquée.
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [router, backPathname]);

  return (
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
          {/* `onboarding` et `questionnaire` déclarés ici n'existaient plus dans app/ : les écrans
              ont été retirés avec la refonte du démarrage (plus de questionnaire, le profil se
              déduit des données). Expo Router criait donc « No route named … » à CHAQUE rendu de la
              navigation — un flot d'erreurs console qui noyait les vraies, en production comme en
              développement. Une déclaration de route est une promesse : sans fichier en face, elle
              ne coûte rien à l'exécution mais rend la console inexploitable. */}
          <Stack.Screen name="setup" options={{ title: 'Démarrage' }} />
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
      {/* Le profil financier suit les comptes et les transactions, où qu'ils changent. */}
      {isTabs && user && <LiveProfileSync />}
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
              {/* Pose la question système au PREMIER lancement, connecté ou non — `PushRegistrar`,
                  lui, attend un utilisateur connecté et son profil. */}
              <PushPermissionPrompt />
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
