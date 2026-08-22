/**
 * Décor commun des tests de COMPOSANTS (projet « components » de jest.config.js).
 *
 * Principe : neutraliser tout ce qui touche au NATIF ou au RÉSEAU, pour qu'un rendu ne dépende que
 * de ses props et de l'état qu'on lui donne. On ne cherche pas à simuler l'app — on cherche à ce
 * qu'un test échoue pour une raison de code, jamais parce qu'un module natif est absent.
 *
 * Règle de lecture : chaque doublure ci-dessous porte la raison de son existence. Si l'une devient
 * inutile, elle se supprime — une doublure sans raison finit par masquer un vrai défaut.
 */
// (Les matchers `toBeOnTheScreen` & co. sont intégrés depuis @testing-library/react-native v13 :
//  plus d'import `extend-expect` à faire ici.)

/* ── Réseau ────────────────────────────────────────────────────────────────────────────────────
   Aucun test ne doit atteindre Supabase. Le client est remplacé par un objet dont chaque appel est
   programmable depuis le test (`mockSupabase.auth.signUp.mockResolvedValue(...)`). `null` n'est PAS
   une option : l'app traite `supabase === null` comme « mode démo » et changerait de comportement. */
export const mockSupabase = {
  auth: {
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
    resend: jest.fn(),
    getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    updateUser: jest.fn(),
  },
  from: jest.fn(),
  rpc: jest.fn(async () => ({ data: null, error: null })),
  functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  storage: { from: jest.fn() },
  /* Temps réel : plusieurs écrans s'abonnent au montage (`supabase.channel(...).on(...).subscribe()`).
     Sans ces deux méthodes, le simple fait de monter un tel écran lève « channel is not a function »
     — l'écran entier disparaît et le test échoue sur un message qui ne dit rien du vrai sujet. */
  channel: jest.fn(() => {
    const ch: any = { on: jest.fn(() => ch), subscribe: jest.fn(() => ch), unsubscribe: jest.fn() };
    return ch;
  }),
  removeChannel: jest.fn(),
};
jest.mock('./lib/platform/supabase', () => ({ supabase: mockSupabase }));

/* ── Navigation ───────────────────────────────────────────────────────────────────────────────
   expo-router lit un contexte de navigation qui n'existe pas hors application. Presque tout écran
   appelle `useRouter`, et beaucoup `useIsFocused` — sans quoi ils rendent dans le vide. */
export const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
  Redirect: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
  Link: ({ children }: any) => children,
}));

/* ── Modules natifs sans équivalent JS ────────────────────────────────────────────────────────── */
// Doublure ÉCRITE À LA MAIN : depuis Reanimated 4, `react-native-reanimated/mock` charge le vrai
// `react-native-worklets` (module natif) et lève « Cannot read properties of undefined ».
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const noop = () => {};
  const identity = (v: any) => v;
  const shared = (value: any) => ({ value });
  const easing = Object.assign(identity, { factory: () => identity });
  return {
    __esModule: true,
    default: { View, ScrollView: View, Text: View, Image: View, createAnimatedComponent: identity },
    View,
    ScrollView: View,
    useSharedValue: shared,
    useDerivedValue: (fn: any) => shared(typeof fn === 'function' ? fn() : fn),
    useAnimatedStyle: (fn: any) => (typeof fn === 'function' ? fn() : {}),
    useAnimatedReaction: noop,
    useAnimatedRef: () => ({ current: null }),
    useAnimatedScrollHandler: () => noop,
    useHandler: () => ({ context: {}, doDependenciesDiffer: false }),
    useEvent: () => noop,
    withTiming: identity,
    withSpring: identity,
    withDecay: identity,
    withDelay: (_d: number, v: any) => v,
    withRepeat: identity,
    withSequence: (...v: any[]) => v[0],
    cancelAnimation: noop,
    interpolate: () => 0,
    interpolateColor: () => 'transparent',
    // Un worklet exécuté en test l'est directement sur le thread JS.
    runOnJS: identity,
    runOnUI: identity,
    Easing: { linear: easing, ease: easing, quad: easing, cubic: easing, bezier: () => easing, in: identity, out: identity, inOut: identity },
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
  };
});

// Doublure fournie par la lib : sans elle, le simple import lève « doesn't seem to be linked »
// (useKeyboardHeight, utilisé par tous les écrans de saisie, l'importe).
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

// Insets FIXES : à zéro, toute mise en page dépendant de la zone sûre serait testée dans un cas
// qui n'existe sur aucun téléphone.
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 47, right: 0, bottom: 34, left: 0 };
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: View,
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    initialWindowMetrics: { insets: inset, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Sans cette doublure, react-query met ses requêtes EN PAUSE (onlineManager) et rien ne se résout.
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(async () => ({ isConnected: true })),
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => {}),
  hideAsync: jest.fn(async () => {}),
  setOptions: jest.fn(),
}));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

/* ── Effets de bord irréversibles ──────────────────────────────────────────────────────────────
   Une demande d'autorisation système ou un achat ne doivent JAMAIS partir depuis un test. */
jest.mock('./lib/platform/pushNotifications', () => ({
  PUSH_SUPPORTED: false,
  getPushPermissionAsync: jest.fn(async () => 'undetermined'),
  requestPushPermissionAsync: jest.fn(async () => 'denied'),
  getDevicePushTokenAsync: jest.fn(async () => null),
}));
jest.mock('./lib/platform/purchases', () => ({
  PURCHASES_SUPPORTED: false,
  configurePurchases: jest.fn(async () => {}),
  logInPurchases: jest.fn(async () => {}),
  isProActive: jest.fn(async () => false),
  addProListener: jest.fn(() => jest.fn()),
}));

/* Bruit de sortie : react-test-renderer signale un `act()` manquant sur des mises à jour d'état
   asynchrones qui sont légitimes ici (requêtes résolues hors du rendu). On garde tous les autres
   avertissements — c'est souvent là qu'on repère un vrai défaut. */
const realError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act(')) return;
    realError(...args);
  };
});
afterAll(() => { console.error = realError; });

afterEach(() => { jest.clearAllMocks(); });
