/**
 * Fondations du Jardin : lisibilité de la charte,
 * cohérence du lexique.
 */
import { GARDEN_COLORS, GARDEN_TEXT } from '../lib/garden/theme';
import { GARDEN_FONTS } from '../lib/garden/fontFamilies';
import { TREE_PARTS, WORDS } from '../lib/garden/lexicon';
import { contrastRatio } from '../theme/palette';

describe('charte : le texte se lit', () => {
  const TEXTS = ['ink', 'inkSoft', 'muted', 'primary', 'waterText', 'rootsText', 'branchesText', 'fruitsText', 'flowersText', 'bramblesText', 'picoText', 'noticeText'] as const;

  it.each(TEXTS)('%s atteint 4,5:1 sur le blanc des cartes et sur le fond', (k) => {
    expect(contrastRatio(GARDEN_COLORS[k], GARDEN_COLORS.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(GARDEN_COLORS[k], GARDEN_COLORS.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('chaque texte de matière se lit sur son propre fond doux', () => {
    const pairs: [string, string][] = [
      [GARDEN_COLORS.waterText, GARDEN_COLORS.waterBg],
      [GARDEN_COLORS.rootsText, GARDEN_COLORS.rootsBg],
      [GARDEN_COLORS.branchesText, GARDEN_COLORS.branchesBg],
      [GARDEN_COLORS.fruitsText, GARDEN_COLORS.fruitsBg],
      [GARDEN_COLORS.flowersText, GARDEN_COLORS.flowersBg],
      [GARDEN_COLORS.bramblesText, GARDEN_COLORS.bramblesBg],
      [GARDEN_COLORS.picoText, GARDEN_COLORS.pico],
      [GARDEN_COLORS.noticeText, GARDEN_COLORS.notice],
    ];
    pairs.forEach(([fg, bg]) => expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5));
  });

  it('le libellé du bouton principal se lit sur le vert', () => {
    expect(contrastRatio(GARDEN_COLORS.onPrimary, GARDEN_COLORS.primary)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('charte : polices', () => {
  it("aucun style ne demande de graisse (Android retomberait sur Roboto)", () => {
    Object.values(GARDEN_TEXT).forEach((s) => {
      expect((s as Record<string, unknown>).fontWeight).toBeUndefined();
      expect(Object.values(GARDEN_FONTS)).toContain(s.fontFamily);
    });
  });
});

describe('lexique', () => {
  it('chaque partie dessinée porte son vrai terme', () => {
    Object.values(TREE_PARTS).forEach((p) => {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.meaning.length).toBeGreaterThan(0);
    });
  });

  it("n'utilise aucun terme écarté par la refonte", () => {
    const all = JSON.stringify({ TREE_PARTS, WORDS }).toLowerCase();
    ['tuteur', 'dosage', 'carnet', 'seaux', 'pourri', 'malade'].forEach((w) => expect(all).not.toContain(w));
  });
});

import { seasonFor, effectiveSeason } from '../lib/garden/season';
describe('saison du jardin', () => {
  it('suit la vraie saison (hémisphère nord)', () => {
    expect(seasonFor(new Date(2026, 2, 19))).toBe('winter');
    expect(seasonFor(new Date(2026, 2, 20))).toBe('spring');
    expect(seasonFor(new Date(2026, 6, 14))).toBe('summer');
    expect(seasonFor(new Date(2026, 9, 20))).toBe('autumn');
    expect(seasonFor(new Date(2026, 11, 25))).toBe('winter');
  });
  it('une saison achetée prend le pas sur la vraie', () => {
    expect(effectiveSeason('winter', new Date(2026, 6, 14))).toBe('winter');
    expect(effectiveSeason(null, new Date(2026, 6, 14))).toBe('summer');
  });
});
