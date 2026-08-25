/**
 * PERSISTANCE DE LA SESSION — le seul invariant qui compte : on ne perd JAMAIS la session.
 *
 * Ces tests décrivent des situations vécues, pas des cas d'école. Une session perdue ne produit
 * aucune erreur visible : supabase-js ne trouve rien, l'app affiche l'accueil, et l'utilisateur
 * doit se reconnecter sans comprendre pourquoi. C'est exactement le genre de régression qu'un
 * refactor « qui simplifie » réintroduit sans que rien ne le signale — d'où cette suite.
 */

const mockAsyncStore = new Map<string, string>();
const mockSecureStore = new Map<string, string>();

/** Réglages du faux coffre natif, pilotés depuis chaque test. */
const mockSecure = {
  available: true,
  /** Nombre d'écritures autorisées avant de lever (simule une app tuée / un coffre en panne). */
  writesBeforeFailure: Infinity,
  writes: 0,
  /** Le coffre lève à la lecture (Keystore corrompu). */
  readThrows: false,
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockAsyncStore.has(k) ? mockAsyncStore.get(k)! : null),
    setItem: async (k: string, v: string) => { mockAsyncStore.set(k, v); },
    removeItem: async (k: string) => { mockAsyncStore.delete(k); },
  },
}));

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => mockSecure.available,
  getItemAsync: async (k: string) => {
    if (mockSecure.readThrows) throw new Error('keystore indisponible');
    return mockSecureStore.has(k) ? mockSecureStore.get(k)! : null;
  },
  setItemAsync: async (k: string, v: string) => {
    if (++mockSecure.writes > mockSecure.writesBeforeFailure) throw new Error('écriture interrompue');
    mockSecureStore.set(k, v);
  },
  deleteItemAsync: async (k: string) => { mockSecureStore.delete(k); },
}));

const KEY = 'sb-advuregnatkcijssmpne-auth-token';
/** Une vraie session Supabase dépasse largement la taille d'un morceau (jeton + profil + identités). */
const SESSION = JSON.stringify({ access_token: 'a'.repeat(1200), refresh_token: 'r'.repeat(60), user: { id: 'u1', meta: 'm'.repeat(1200) } });
const SESSION_2 = SESSION.replace('a'.repeat(1200), 'b'.repeat(1200));

/** Le module mémorise la disponibilité du coffre : chaque test repart d'un module neuf. */
function load() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../lib/platform/secureStorage') as typeof import('../lib/platform/secureStorage');
}

beforeEach(() => {
  mockAsyncStore.clear();
  mockSecureStore.clear();
  mockSecure.available = true;
  mockSecure.writesBeforeFailure = Infinity;
  mockSecure.writes = 0;
  mockSecure.readThrows = false;
});

describe('stockage de session — aller-retour', () => {
  it('relit exactement ce qui a été écrit, même au-delà de la taille d’un morceau', async () => {
    const { SecureSessionStore } = load();
    await SecureSessionStore.setItem(KEY, SESSION);
    expect(await SecureSessionStore.getItem(KEY)).toBe(SESSION);
  });

  it('ne laisse rien en clair dans AsyncStorage quand le coffre fonctionne', async () => {
    const { SecureSessionStore } = load();
    await SecureSessionStore.setItem(KEY, SESSION);
    expect(mockAsyncStore.get(KEY)).toBeUndefined();
  });

  it('oublie tout à la déconnexion', async () => {
    const { SecureSessionStore } = load();
    await SecureSessionStore.setItem(KEY, SESSION);
    await SecureSessionStore.removeItem(KEY);
    expect(await SecureSessionStore.getItem(KEY)).toBeNull();
    expect([...mockSecureStore.keys()]).toHaveLength(0);
  });
});

describe('écriture interrompue — le cœur du sujet', () => {
  /**
   * C'EST LA RÉGRESSION À NE PLUS JAMAIS REFAIRE. L'ancienne implémentation effaçait les morceaux
   * AVANT d'écrire les nouveaux : une app tuée entre les deux (mise à jour appliquée au lancement,
   * crash, balayage) laissait un jeu incomplet, illisible → reconnexion forcée.
   */
  it('garde la session PRÉCÉDENTE lisible si le rafraîchissement est coupé en plein vol', async () => {
    const { SecureSessionStore } = load();
    await SecureSessionStore.setItem(KEY, SESSION);

    // Le coffre lâche après une seule écriture : le nouveau jeu de morceaux est incomplet.
    mockSecure.writes = 0;
    mockSecure.writesBeforeFailure = 1;
    await SecureSessionStore.setItem(KEY, SESSION_2);

    // Redémarrage de l'app (module neuf, même stockage).
    const after = load();
    const read = await after.SecureSessionStore.getItem(KEY);
    expect(read).not.toBeNull();
    // Soit l'ancienne, soit la nouvelle — jamais rien.
    expect([SESSION, SESSION_2]).toContain(read);
  });

  it('retombe sur une copie locale plutôt que de perdre la session si le coffre refuse d’écrire', async () => {
    const { SecureSessionStore } = load();
    mockSecure.writesBeforeFailure = 0; // le coffre refuse tout
    await SecureSessionStore.setItem(KEY, SESSION);

    const after = load();
    expect(await after.SecureSessionStore.getItem(KEY)).toBe(SESSION);
  });

  it('sert la session la PLUS RÉCENTE quand le coffre tombe en panne en cours de route', async () => {
    const { SecureSessionStore } = load();
    await SecureSessionStore.setItem(KEY, SESSION); // ancienne, dans le coffre

    mockSecure.writes = 0;
    mockSecure.writesBeforeFailure = 0; // le coffre tombe : le rafraîchissement part en repli
    await SecureSessionStore.setItem(KEY, SESSION_2);

    const after = load();
    expect(await after.SecureSessionStore.getItem(KEY)).toBe(SESSION_2);
  });
});

describe('mises à jour — les formats hérités restent lisibles', () => {
  it('reprend une session du format chiffré historique (.__n) et la convertit', async () => {
    // Ce qu'une build précédente avait écrit.
    const parts = SESSION.match(/[\s\S]{1,1800}/g)!;
    parts.forEach((p, i) => mockSecureStore.set(`${KEY}.${i}`, p));
    mockSecureStore.set(`${KEY}.__n`, String(parts.length));

    const { SecureSessionStore } = load();
    expect(await SecureSessionStore.getItem(KEY)).toBe(SESSION);
    // Convertie au format courant, et l'ancien nettoyé.
    expect(mockSecureStore.get(`${KEY}.__n`)).toBeUndefined();
    const after = load();
    expect(await after.SecureSessionStore.getItem(KEY)).toBe(SESSION);
  });

  it('reprend la copie en clair d’avant le chiffrement (AsyncStorage) sans la supprimer trop tôt', async () => {
    mockAsyncStore.set(KEY, SESSION);
    const { SecureSessionStore } = load();
    expect(await SecureSessionStore.getItem(KEY)).toBe(SESSION);
    // Relue depuis le coffre → la copie en clair a fait son office et disparaît.
    expect(mockAsyncStore.get(KEY)).toBeUndefined();
    const after = load();
    expect(await after.SecureSessionStore.getItem(KEY)).toBe(SESSION);
  });

  it('conserve la copie en clair tant que le coffre ne sait pas la reprendre', async () => {
    mockAsyncStore.set(KEY, SESSION);
    mockSecure.writesBeforeFailure = 0;
    const { SecureSessionStore } = load();
    expect(await SecureSessionStore.getItem(KEY)).toBe(SESSION);
    expect(mockAsyncStore.get(KEY)).toBe(SESSION); // toujours là : c'est la seule copie qui reste
  });

  it('OTA vers une build SANS coffre natif : la session AsyncStorage est servie telle quelle', async () => {
    mockSecure.available = false;
    mockAsyncStore.set(KEY, SESSION);
    const { SecureSessionStore } = load();
    expect(await SecureSessionStore.getItem(KEY)).toBe(SESSION);
    await SecureSessionStore.setItem(KEY, SESSION_2);
    expect(mockAsyncStore.get(KEY)).toBe(SESSION_2);
  });
});

describe('diagnostic — une perte de session doit être constatable', () => {
  it('signale un jeu de morceaux incomplet au lieu de faire comme s’il n’y avait pas de session', async () => {
    const { SecureSessionStore } = load();
    await SecureSessionStore.setItem(KEY, SESSION);
    // On sabote un morceau (corruption disque, effacement partiel).
    const chunkKey = [...mockSecureStore.keys()].find((k) => /\.g\d+\.1$/.test(k))!;
    expect(chunkKey).toBeTruthy();
    mockSecureStore.delete(chunkKey);

    const after = load();
    expect(await after.SecureSessionStore.getItem(KEY)).toBeNull();
    const d = after.sessionStorageDiagnostics();
    expect(d.incomplete).toBe(true);
    expect(d.readError).toBe('stockage présent mais illisible');
  });

  it('signale un coffre illisible (Keystore en panne)', async () => {
    const { SecureSessionStore, sessionStorageDiagnostics } = load();
    mockSecure.readThrows = true;
    expect(await SecureSessionStore.getItem(KEY)).toBeNull();
    expect(sessionStorageDiagnostics().readError).toBeTruthy();
  });

  it('ne signale rien quand il n’y a simplement jamais eu de session', async () => {
    const { SecureSessionStore, sessionStorageDiagnostics } = load();
    expect(await SecureSessionStore.getItem(KEY)).toBeNull();
    const d = sessionStorageDiagnostics();
    expect(d.readError).toBeNull();
    expect(d.incomplete).toBe(false);
  });
});
