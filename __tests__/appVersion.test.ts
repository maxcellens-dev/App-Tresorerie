/**
 * LA VERSION AFFICHÉE EST CELLE QUI EST INSTALLÉE, PAS CELLE DU BUNDLE.
 *
 * L'app annonçait « version installée v1.0.8 » à quelqu'un resté en 1.0.7 : elle lisait
 * `Constants.expoConfig.version`, c'est-à-dire le manifeste du BUNDLE JS en cours — donc la version
 * déclarée au moment où l'OTA a été publiée, qui n'a rien à voir avec le binaire posé par le store.
 * Conséquence la plus grave : le bouton « Mise à jour » comparait cette version-là à la dernière
 * publiée, et concluait « tu es à jour » alors qu'une vraie mise à jour attendait sur le store.
 *
 * Ces cas verrouillent les deux moitiés de la règle : la version installée vient du NATIF quand il
 * peut la donner, et le repli sur le bundle reste en place pour les binaires antérieurs — sans quoi
 * une OTA ferait planter au démarrage toutes les installations qui n'embarquent pas encore
 * `expo-application`.
 */

/** Recharge le module avec un environnement natif simulé (il lit tout à l'import). */
function loadWith(opts: { native?: string | null; build?: string | null; manifest?: string; throws?: boolean }) {
  let mod: typeof import('../lib/platform/appVersion');
  jest.isolateModules(() => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { version: opts.manifest ?? '1.0.8' } },
    }));
    jest.doMock('expo-application', () => {
      if (opts.throws) throw new Error('Native module ExpoApplication not found');
      return { nativeApplicationVersion: opts.native ?? null, nativeBuildVersion: opts.build ?? null };
    });
    mod = require('../lib/platform/appVersion');
  });
  return mod!;
}

describe('version de l’app', () => {
  it('affiche la version INSTALLÉE, pas celle du bundle reçu par OTA', () => {
    const m = loadWith({ native: '1.0.7', build: '43', manifest: '1.0.8' });
    expect(m.APP_VERSION).toBe('1.0.7');
    expect(m.BUNDLE_VERSION).toBe('1.0.8');
    expect(m.APP_BUILD).toBe('43');
    expect(m.NATIVE_VERSION_KNOWN).toBe(true);
    // C'est ce drapeau qui permet d'annoncer « v1.0.7 · correctifs v1.0.8 » sans mentir.
    expect(m.RUNNING_NEWER_BUNDLE).toBe(true);
  });

  it('ne signale aucun écart quand le binaire et le bundle sont sur la même version', () => {
    const m = loadWith({ native: '1.0.8', manifest: '1.0.8' });
    expect(m.APP_VERSION).toBe('1.0.8');
    expect(m.RUNNING_NEWER_BUNDLE).toBe(false);
  });

  /* Une OTA atteint aussi les binaires ANTÉRIEURS, qui n'embarquent pas le module natif : le
     `require` y lève. Il doit être rattrapé — sinon la mise à jour ferait planter au démarrage
     précisément les installations qu'elle vient corriger. */
  it('retombe sur la version du bundle si le module natif est absent (binaire antérieur)', () => {
    const m = loadWith({ throws: true, manifest: '1.0.8' });
    expect(m.APP_VERSION).toBe('1.0.8');
    expect(m.NATIVE_VERSION_KNOWN).toBe(false);
    expect(m.RUNNING_NEWER_BUNDLE).toBe(false); // rien à annoncer : on ne SAIT pas
  });

  it('retombe aussi quand le natif ne rend pas de version (web)', () => {
    const m = loadWith({ native: null, manifest: '1.0.8' });
    expect(m.APP_VERSION).toBe('1.0.8');
    expect(m.NATIVE_VERSION_KNOWN).toBe(false);
  });
});

describe('comparaison de versions', () => {
  const { isNewerVersion } = loadWith({ native: '1.0.8' });

  it('compare nombre à nombre, pas caractère à caractère', () => {
    expect(isNewerVersion('1.0.10', '1.0.9')).toBe(true);  // « 10 » > « 9 », pas l'inverse
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true);
    expect(isNewerVersion('1.0.8', '1.0.8')).toBe(false);
    expect(isNewerVersion('1.0.7', '1.0.8')).toBe(false);
  });

  it('tolère les longueurs différentes et les valeurs absentes', () => {
    expect(isNewerVersion('1.1', '1.0.9')).toBe(true);
    expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
    expect(isNewerVersion(null, '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.1', undefined)).toBe(true);
  });
});

/**
 * LE BANDEAU « MISE À JOUR DISPONIBLE » — la décision, isolée de son animation.
 *
 * C'est le cas qui ne s'était JAMAIS déclenché en production : le bandeau comparait la version du
 * BUNDLE (qui monte à chaque OTA) et concluait donc « rien à signaler » d'autant plus sûrement que
 * l'utilisateur recevait des mises à jour. Les deux moitiés sont verrouillées ici.
 */
describe('proposer la mise à jour du store', () => {
  it('propose quand la version publiée est plus récente que la version INSTALLÉE', () => {
    const m = loadWith({ native: '1.0.8', manifest: '1.0.8' });
    expect(m.shouldOfferStoreUpdate('1.0.9')).toBe(true);
    expect(m.shouldOfferStoreUpdate('1.0.8')).toBe(false);
  });

  it('ne se laisse PAS berner par un bundle OTA plus récent que le binaire', () => {
    // Binaire 1.0.7, OTA publiée depuis un arbre en 1.0.8, dernière version publiée : 1.0.8.
    const m = loadWith({ native: '1.0.7', manifest: '1.0.8' });
    expect(m.shouldOfferStoreUpdate('1.0.8')).toBe(true);
  });

  it('propose quand le binaire est trop ancien pour dire sa version', () => {
    /* Pas de module natif = binaire antérieur à la build qui l'a introduit, donc antérieur à la
       dernière version publiée. L'ignorance est ici un renseignement. */
    const m = loadWith({ throws: true, manifest: '1.0.8' });
    expect(m.shouldOfferStoreUpdate('1.0.8')).toBe(true);
  });

  it('ne propose rien tant qu’aucune version n’est publiée en configuration', () => {
    const m = loadWith({ throws: true, manifest: '1.0.8' });
    expect(m.shouldOfferStoreUpdate(undefined)).toBe(false);
    expect(m.shouldOfferStoreUpdate('')).toBe(false);
  });
});
