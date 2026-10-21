import { useMemo, useEffect, useRef, useState } from 'react';
import { Platform, Animated } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAppNameFontReady } from '../../hooks/theme/useBrandFont';
import { useLandingConfig, mergeLanding, type LandingConfig } from '../../hooks/config/useLandingConfig';
import { signalAppReady } from '../../lib/platform/splashGate';
import { getCachedAdminTheme } from '../../lib/platform/themeBoot';
import AppLoading from '../system/AppLoading';
import GardenLandingPage from './GardenLandingPage';
import GardenWelcome from './GardenWelcome';

/** Attente MAXIMALE avant de révéler l'accueil (police de marque + textes admin). Cf. `canReveal`. */
const REVEAL_CAP_MS = 700;
/** Attente maximale du thème de la vitrine à la toute première visite (web). Cf. `themeUnknown`. */
const THEME_CAP_MS = 2000;



/**
 * Porte d'entrée avant connexion : la vitrine web du Jardin (GardenLandingPage) sur navigateur, sinon
 * l'accueil du Jardin (GardenWelcome) — téléphone, aperçu en admin, ou navigateur quand la vitrine
 * est coupée. Cet écran ne garde que le MOMENT de la révélation (police, textes, splash).
 */
export default function WelcomeScreen({ previewConfig }: { previewConfig?: LandingConfig; previewWidth?: number } = {}) {
  const { data: landing } = useLandingConfig();
  const L = useMemo(() => mergeLanding(previewConfig ?? landing), [previewConfig, landing]); // config admin (avec défauts) → rien en dur sur l'accueil mobile
  const fadeAnim = useRef(new Animated.Value(previewConfig ? 1 : 0)).current;

  // Landing responsive sur navigateur ; l'accueil natif reste indépendant.
  const showLanding = !previewConfig && Platform.OS === 'web' && (landing?.enabled ?? true);

  /* ── NE RIEN MONTRER QUI VA CHANGER SOUS LES YEUX ──────────────────────────────────────────────
     Deux choses arrivent en retard sur cet écran : la police du nom (importée → chargée en
     asynchrone sur natif) et les textes eux-mêmes (config admin `landing`). Le contenu s'affichait
     aussitôt, puis les titres SAUTAIENT en changeant de police.

     Le cas le plus visible est la DÉCONNEXION, et il n'est pas dû au réseau : `signOut()` fait
     `queryClient.clear()`, donc la config de style et les textes DISPARAISSENT juste avant que le
     voile ne se lève (cf. components/SignOutVeil). L'accueil se découvrait alors avec la police de
     repli et les textes par défaut, puis tout se remettait en place à la relecture — pile sous les
     yeux. D'où les trois conditions ci-dessous, et surtout `signingOut` : tant que la purge est en
     cours, rien de ce qu'on affiche n'est définitif.

     ⚠️ Plafond OBLIGATOIRE (REVEAL_CAP_MS) : hors-ligne, ni la config ni la police n'arriveront
     jamais — au pire on retombe sur l'ancien comportement, jamais sur une page vide. Il ne court
     qu'une fois le voile parti : le dépenser dessous ne servirait à rien (c'est déjà masqué). */
  const { signingOut } = useAuth();
  const fontReady = useAppNameFontReady();
  const configReady = landing !== undefined;
  const [capReached, setCapReached] = useState(false);
  useEffect(() => {
    if (previewConfig) return;
    if (signingOut) { setCapReached(false); return; }
    const t = setTimeout(() => setCapReached(true), REVEAL_CAP_MS);
    return () => clearTimeout(t);
  }, [signingOut, previewConfig]);
  /* Web exclu de l'attente : le navigateur remplace la police tout seul (`font-display`), et rien
     ne couvre le premier rendu là-bas — on afficherait une page vide au lieu d'éviter un saut. */
  const canReveal = !signingOut && (Platform.OS === 'web' || (fontReady && configReady) || capReached);

  // Cf. le retour anticipé plus bas (« toute première visite »).
  const themeUnknown = !previewConfig && Platform.OS === 'web' && landing === undefined && getCachedAdminTheme() === null;
  const [themeCapReached, setThemeCapReached] = useState(false);
  useEffect(() => {
    if (!themeUnknown) return;
    const t = setTimeout(() => setThemeCapReached(true), THEME_CAP_MS);
    return () => clearTimeout(t);
  }, [themeUnknown]);

  useEffect(() => {
    if (previewConfig || !canReveal) return;
    // Le splash animé n'est libéré qu'ici : sur un démarrage à froid, c'est LUI qui couvre l'attente
    // (au lieu de révéler une page dont les titres vont encore bouger).
    signalAppReady();
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [canReveal, previewConfig]);

  /* TOUTE PREMIÈRE VISITE (web) : ni config chargée, ni thème mémorisé — on ne SAIT pas encore si
     la vitrine est claire ou sombre. L'afficher quand même, c'était la peindre dans le thème par
     défaut puis la repeindre sous les yeux du visiteur. On tient donc l'écran de chargement, dont le
     marqueur garde en place le logo du boot-loader HTML (fond neutre, cf. app/+html.tsx) : la page
     n'apparaît qu'une fois, dans ses vraies couleurs. Dès la visite suivante le thème est mémorisé
     et cette attente n'existe plus. Bornée : sans réseau, on affiche quand même la page. */
  if (themeUnknown && !themeCapReached) return <AppLoading />;

  /* Vitrine du Jardin : affichée quand la refonte est ouverte à tous (garden_ui = 'all'), ou en
     aperçu avec ?jardin=1 dans l'adresse. Sinon, la vitrine actuelle. */
  if (showLanding) return <GardenLandingPage />;

  /* Accueil de l'app (téléphone, son aperçu en admin, et le navigateur quand la vitrine est coupée
     en admin) : la version Jardin. Le fondu et la levée du splash restent pilotés ici (canReveal). */
  return <GardenWelcome L={L} preview={!!previewConfig} fade={fadeAnim} />;
}
