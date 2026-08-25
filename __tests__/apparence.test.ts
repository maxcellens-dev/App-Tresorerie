/**
 * APPARENCE — les règles qui décident de MODIFIER ou d'EFFACER un réglage utilisateur.
 *
 * Chaque cas décrit ici correspond à une situation réellement rencontrée par quelqu'un qui ouvre la
 * page : le profil arrive du cache local avant les réglages d'offre, l'inventaire n'a pas encore
 * répondu, un administrateur regarde le compte de quelqu'un d'autre. Toutes se ressemblent à
 * l'écran, mais elles n'appellent pas la même décision — et se tromper coûte une donnée.
 */
import { shouldResetCustomAccent, isCustomAccent } from '../theme/accentRules';
import { keepOwnedCosmetics } from '../lib/engagement/gamification';
import { safeInternalRoute } from '../lib/ui/navHistory';
import { buildColors, contrastRatio, readableOn } from '../theme/palette';

const base = {
  profileLoaded: true, planResolved: true, hasEntitlement: false,
  preset: '#FF5733', readOnly: false, alreadyDone: false,
};

describe('couleur personnalisée — quand la remettre par défaut', () => {
  it('remet par défaut quand l’abonnement a réellement pris fin', () => {
    expect(shouldResetCustomAccent(base)).toBe(true);
  });

  /* LE BUG À NE PLUS JAMAIS REFAIRE : le droit Premium vaut `false` tant qu'il n'est pas connu.
     Un abonné ouvrait la page et sa couleur était effacée EN BASE avant l'affichage. */
  it('n’efface RIEN tant que l’offre et le profil n’ont pas répondu', () => {
    expect(shouldResetCustomAccent({ ...base, planResolved: false })).toBe(false);
    expect(shouldResetCustomAccent({ ...base, profileLoaded: false })).toBe(false);
  });

  it('n’efface rien pour un compte qui a toujours le droit Premium', () => {
    expect(shouldResetCustomAccent({ ...base, hasEntitlement: true })).toBe(false);
  });

  it('ne touche pas au compte d’un autre utilisateur (consultation)', () => {
    expect(shouldResetCustomAccent({ ...base, readOnly: true })).toBe(false);
  });

  it('ne se rejoue pas en boucle une fois fait', () => {
    expect(shouldResetCustomAccent({ ...base, alreadyDone: true })).toBe(false);
  });

  it('laisse les couleurs de base tranquilles (elles sont gratuites)', () => {
    for (const p of ['emerald', 'ocean', 'custom_1780482546225', '', null, undefined]) {
      expect(shouldResetCustomAccent({ ...base, preset: p })).toBe(false);
    }
  });

  it('reconnaît une couleur personnalisée quelle que soit la casse', () => {
    expect(isCustomAccent('#ff5733')).toBe(true);
    expect(isCustomAccent('#FF5733')).toBe(true);
    expect(isCustomAccent('#FFF')).toBe(false);
    expect(isCustomAccent('FF5733')).toBe(false);
  });
});

describe('cosmétiques équipés — ne montrer que ce qui est possédé', () => {
  const equipped = { avatar_frame: 'cosmetic_frame_blue', title: 'cosmetic_title_legend' } as any;

  it('retire un article équipé qui n’est plus dans l’inventaire', () => {
    expect(keepOwnedCosmetics(equipped, ['cosmetic_frame_blue'], true))
      .toEqual({ avatar_frame: 'cosmetic_frame_blue' });
  });

  /* Sans ce garde, TOUS les cosmétiques disparaissaient le temps que l'inventaire réponde —
     et définitivement si la lecture échouait. */
  it('ne retire rien tant que l’inventaire n’est pas connu', () => {
    expect(keepOwnedCosmetics(equipped, [], false)).toEqual(equipped);
  });

  it('ne garde rien si l’inventaire est connu et vide', () => {
    expect(keepOwnedCosmetics(equipped, [], true)).toEqual({});
  });
});

describe('destination de retour reçue dans l’URL', () => {
  it('accepte un chemin interne', () => {
    expect(safeInternalRoute('/(tabs)/(secondary)/boutique')).toBe('/(tabs)/(secondary)/boutique');
  });

  it('refuse tout ce qui sort de l’application', () => {
    for (const bad of ['https://exemple.test', '//exemple.test', 'javascript:alert(1)', 'boutique', '', null, undefined]) {
      expect(safeInternalRoute(bad as any)).toBeNull();
    }
  });
});

describe('lisibilité de la couleur d’accent', () => {
  /* La couleur d'accent est choisie librement (couleur personnalisée, couleurs du pack). Le texte
     posé dessus utilisait le fond de l'app : en thème clair, un accent clair donnait un libellé
     quasi invisible sur les boutons — et l'app entière suit cette couleur. */
  const accents = ['#38B460', '#E7CB12', '#93D740', '#00B9CF', '#FF3366', '#FFFFFF', '#111111'];

  it('garde un texte lisible sur un aplat d’accent, dans les deux modes', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const hex of accents) {
        const c = buildColors(mode, hex);
        expect(contrastRatio(c.accent, c.onAccent)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('garde l’accent lisible quand il sert de couleur de texte', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const hex of accents) {
        const c = buildColors(mode, hex);
        expect(contrastRatio(c.accentText, c.bg)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('ne change RIEN au rendu du thème sombre (aucune régression visuelle)', () => {
    for (const hex of accents.filter((h) => h !== '#111111')) {
      const c = buildColors('dark', hex);
      expect(c.onAccent).toBe(c.bg);
      expect(c.accentText).toBe(c.accent);
    }
  });

  it('pose une coche visible sur une pastille de n’importe quelle teinte', () => {
    expect(readableOn('#FFFFFF')).toBe('#111111');
    expect(readableOn('#000000')).toBe('#FFFFFF');
    for (const hex of accents) expect(contrastRatio(hex, readableOn(hex))).toBeGreaterThanOrEqual(4.5);
  });
});
