/**
 * Page CONSEILS INTELLIGENTS — parcours réels, montés pour de vrai.
 *
 * Ce qui est éprouvé ici ne se voit ni au typage ni dans les moteurs purs :
 *  • le compteur n'annonce pas « 0 / 0 » (donc « compte épuisé ») pendant le chargement du quota ;
 *  • un utilisateur gratuit qui a ACHETÉ des requêtes entre dans la page (le serveur, lui, accepte
 *    ses crédits : lui opposer le mur Premium rendait inutilisable ce qu'il a payé) ;
 *  • deux appuis rapprochés sur une analyse ne partent PAS deux fois (une requête = de l'argent) ;
 *  • quota épuisé sans recharge activée : on explique, on n'ouvre pas une feuille d'achat vide.
 */
import { renderWithProviders, screen, fireEvent, waitFor, act } from './utils/renderWithProviders';
import { mockSupabase } from '../jest.setup';

// ── Doublures propres à cet écran ─────────────────────────────────────────────────────────────
// expo-router : la doublure globale ne fournit pas `useFocusEffect`, que la page utilise pour
// relire le quota au retour sur l'écran.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  usePathname: () => '/conseils-ia',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
  useFocusEffect: (cb: any) => { const React = require('react'); React.useEffect(() => cb(), []); },
  router: { push: jest.fn() },
  Link: ({ children }: any) => children,
}));
// Hauteur de la barre d'onglets : hook natif de la navigation, hors contexte en test.
jest.mock('expo-router/build/react-navigation/bottom-tabs', () => ({ useBottomTabBarHeight: () => 60 }));
// L'instantané financier a ses propres tests ; ici on veut la page, pas le moteur de snapshot.
jest.mock('../hooks/data/useUserSnapshot', () => ({
  useUserSnapshot: () => ({ text: 'SNAP', ready: true, build: () => 'SNAP', currentBilanMetrics: null }),
}));
jest.mock('../components/transaction/CalculatorButton', () => () => null);

import ConseilsIaScreen from '../app/(tabs)/conseils-ia';

/**
 * Double de constructeur de requête Supabase : chaînable ET « thenable » (comme le vrai).
 * `rows` est LU À CHAQUE FOIS (référence vivante) : une ligne insérée pendant le test se retrouve
 * bien dans la lecture suivante, comme en base.
 */
function queryDouble(rows: any[], newRow?: (values: any) => any, readDelayMs = 0) {
  const chain: any = {};
  let inserted: any = null;
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'or', 'ilike', 'order', 'limit', 'range', 'gte', 'lte', 'not', 'update', 'delete', 'upsert']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.insert = jest.fn((values: any) => {
    if (newRow) { inserted = newRow(values); rows.unshift(inserted); }
    return chain;
  });
  const one = async () => ({ data: inserted ?? rows[0] ?? null, error: null });
  chain.single = jest.fn(one);
  chain.maybeSingle = jest.fn(one);
  // `readDelayMs` reproduit l'aller-retour réseau d'une LECTURE : sans lui, la liste se rafraîchit
  // si vite qu'aucune fenêtre de désynchronisation n'existe — et le test ne prouve plus rien.
  chain.then = (res: any, rej: any) =>
    new Promise((r) => (readDelayMs ? setTimeout(r, readDelayMs) : r(undefined)))
      .then(() => ({ data: [...rows], error: null, count: rows.length }))
      .then(res, rej);
  return chain;
}

const PROFILE = { id: 'u1', email: 'a@b.c', full_name: 'Alex', is_admin: false, is_premium: true, ui_prefs: {} };

type Setup = {
  profile?: any;
  aiConfig?: any;
  quota?: any;
  features?: any;
};

function setup(over: Setup = {}) {
  const profile = { ...PROFILE, ...(over.profile ?? {}) };
  const aiConfig = {
    id: 'default', models: [], free_monthly_limit: 1, premium_monthly_limit: 10, daily_global_cap: 200,
    open_to_all: false, pay_to_use_enabled: false, pay_to_use_price_cents: 0, paid_fallback_enabled: false,
    extra_credit_packs: [{ id: 'p5', credits: 5, price_cents: 199, product_id: 'ai_5' }],
    consent_text: 'Résumé anonymisé envoyé à un service tiers.',
    predefined_questions: ['Comment réduire mes dépenses ?'],
    ...(over.aiConfig ?? {}),
  };
  const quota = over.quota === null ? null : { used: 2, limit: 10, remaining: 8, is_premium: true, extra_credits: 0, ...(over.quota ?? {}) };

  const conversations: any[] = [];
  (mockSupabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'a@b.c' } } }, error: null });
  (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
    switch (table) {
      case 'profiles': return queryDouble([profile]);
      case 'ai_config': return queryDouble([aiConfig]);
      case 'app_config': return queryDouble([{ id: 'default', features: { premium_enabled: true, ...(over.features ?? {}) }, usage_limits: null }]);
      // Insertion RÉELLEMENT enregistrée : la lecture suivante de la liste doit contenir le fil créé.
      case 'ai_conversations': return queryDouble(conversations, (v) => ({ id: 'conv-neuve', profile_id: 'u1', title: v.title, created_at: '2026-08-22T10:00:00Z', updated_at: '2026-08-22T10:00:00Z' }), 40);
      case 'ai_messages': return queryDouble([]);
      default: return queryDouble([]);
    }
  });
  (mockSupabase.rpc as jest.Mock).mockImplementation(async (fn: string) => {
    if (fn === 'ai_my_quota') return quota === null ? new Promise(() => {}) : { data: quota, error: null };
    if (fn === 'ai_analyses') return { data: [{ key: 'analysis_global', title: 'Bilan global', sort_order: 1 }], error: null };
    return { data: null, error: null };
  });
  (mockSupabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { ok: true, reply: 'Voici mon analyse.' }, error: null });
  return { profile, aiConfig, quota, conversations };
}

describe('Conseils Intelligents — affichage du compteur', () => {
  it('affiche « X / Y requêtes » une fois le quota lu', async () => {
    setup({ quota: { limit: 10, remaining: 8, extra_credits: 5 } });
    renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText('Conseils Intelligents')).toBeOnTheScreen());
    await waitFor(() => expect(screen.getByText('13')).toBeOnTheScreen());     // 8 incluses + 5 rechargées
    expect(screen.getByText('/ 15 requêtes')).toBeOnTheScreen();
  });

  it('n\'annonce PAS « 0 / 0 » tant que le quota n\'a pas répondu, puis affiche le vrai chiffre', async () => {
    // Quota volontairement EN VOL : c'est l'état de chaque ouverture de page pendant ~1 seconde.
    let answer: (v: any) => void = () => {};
    const inFlight = new Promise((res) => { answer = res; });
    setup({ quota: null });
    (mockSupabase.rpc as jest.Mock).mockImplementation(async (fn: string) => {
      if (fn === 'ai_my_quota') return inFlight;
      if (fn === 'ai_analyses') return { data: [{ key: 'analysis_global', title: 'Bilan global', sort_order: 1 }], error: null };
      return { data: null, error: null };
    });

    renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText('Conseils Intelligents')).toBeOnTheScreen());
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.queryByText('/ 0 requêtes')).toBeNull();
    expect(screen.queryByText(/plus de requêtes disponibles/i)).toBeNull();
    expect(screen.queryByText('Tu as utilisé tes requêtes du mois')).toBeNull();

    await act(async () => { answer({ data: { used: 3, limit: 10, remaining: 7, is_premium: true, extra_credits: 0 }, error: null }); });
    await waitFor(() => expect(screen.getByText('7')).toBeOnTheScreen());
  });
});

describe('Conseils Intelligents — accès', () => {
  it('oppose le mur Premium à un utilisateur gratuit sans crédit', async () => {
    setup({ profile: { is_premium: false }, quota: { limit: 1, remaining: 0, is_premium: false, extra_credits: 0 } });
    renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText(/réservés aux abonnés Premium/i)).toBeOnTheScreen());
  });

  it('LAISSE ENTRER un utilisateur gratuit qui a acheté des requêtes', async () => {
    setup({ profile: { is_premium: false }, quota: { limit: 1, remaining: 0, is_premium: false, extra_credits: 3 } });
    renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText('Conseils Intelligents')).toBeOnTheScreen());
    expect(screen.queryByText(/réservés aux abonnés Premium/i)).toBeNull();
    expect(screen.getByText('3')).toBeOnTheScreen();
  });
});

describe('Conseils Intelligents — quota épuisé', () => {
  it('explique le renouvellement quand la recharge n\'est pas activée (pas de feuille d\'achat)', async () => {
    setup({ quota: { limit: 10, remaining: 0, extra_credits: 0 } });
    renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText('Tu as utilisé tes requêtes du mois')).toBeOnTheScreen());
    expect(screen.queryByText(/Recharge des requêtes à l'unité/)).toBeNull();
  });

  it('propose la recharge quand l\'admin l\'a activée', async () => {
    setup({ quota: { limit: 10, remaining: 0, extra_credits: 0 }, aiConfig: { pay_to_use_enabled: true } });
    renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText('Tu n\'as plus de requêtes disponibles')).toBeOnTheScreen());
  });
});

describe('Conseils Intelligents — envoi', () => {
  it('demande confirmation avant de dépenser une requête', async () => {
    setup();
    renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText('Bilan global')).toBeOnTheScreen());
    fireEvent.press(screen.getByText('Bilan global'));
    await waitFor(() => expect(screen.getByText('Utiliser une requête ?')).toBeOnTheScreen());
    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Annuler')); // referme proprement (rien n'est parti)
  });

  it('N\'ENVOIE QU\'UNE FOIS malgré deux appuis rapprochés (double décompte = requête perdue)', async () => {
    setup({ profile: { ui_prefs: { ai_confirm_skip: true } } }); // envoi direct, sans confirmation
    // La demande reste EN VOL : c'est exactement la fenêtre où le second appui doit être refusé.
    (mockSupabase.functions.invoke as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderWithProviders(<ConseilsIaScreen />);
    await waitFor(() => expect(screen.getByText('Bilan global')).toBeOnTheScreen());

    const btn = screen.getByText('Bilan global');
    await act(async () => {
      fireEvent.press(btn);
      fireEvent.press(btn); // second appui AVANT le rendu suivant : `pending` vaut encore false
    });
    await waitFor(() => expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1));
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('ai-advice', expect.objectContaining({
      body: expect.objectContaining({ kind: 'analysis', analysis_key: 'analysis_global', conversation_id: 'conv-neuve' }),
    }));
    // Un troisième appui pendant que ça tourne ne part pas non plus.
    await act(async () => { fireEvent.press(btn); });
    expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Le conseiller réfléchit…')).toBeOnTheScreen();
    unmount();
  });

  it('RESTE sur la conversation qui vient d\'être créée (la réponse doit arriver sous les yeux)', async () => {
    /* Régression : la page sélectionnait le fil neuf, mais sa liste de conversations — encore
       périmée le temps d'un aller-retour — ne le contenait pas ; le garde-fou « conversation
       disparue » la dé-sélectionnait aussitôt et renvoyait sur « Nouvelle conversation ».
       La question ET la réponse atterrissaient dans un fil que l'utilisateur ne regardait plus. */
    setup({ profile: { ui_prefs: { ai_confirm_skip: true } } });
    (mockSupabase.functions.invoke as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderWithProviders(<ConseilsIaScreen />);
    // Sous-titre de la page (le Text contient aussi un chevron → correspondance souple).
    await waitFor(() => expect(screen.getByText(/Nouvelle conversation/)).toBeOnTheScreen());

    await act(async () => { fireEvent.press(screen.getByText('Bilan global')); });
    await waitFor(() => expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1));
    // Le sous-titre porte désormais le nom du fil créé — et plus « Nouvelle conversation ».
    await waitFor(() => expect(screen.getAllByText(/Bilan global/).length).toBeGreaterThan(1));
    expect(screen.queryByText(/Nouvelle conversation/)).toBeNull();
    unmount();
  });
});
