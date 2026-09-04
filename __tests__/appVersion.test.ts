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
