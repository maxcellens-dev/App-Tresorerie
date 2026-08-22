/**
 * BOUTIQUE — l'économie en relyks, côté calcul pur.
 *
 * Ces règles décident de ce qu'un utilisateur PAIE. Elles étaient jusqu'ici sans aucun test, alors
 * qu'elles dépendent d'une configuration éditée en administration : une valeur aberrante en base
 * (prix négatif, remise à 300 %, article retiré du code) doit produire un prix sain, pas une faille.
 */
import {
  shopFinalPrice, formatCurrency, currencyPlural, isUniqueItem, isImageIcon,
  mergeGamificationConfig, DEFAULT_GAMIFICATION, type ShopItem,
} from '../lib/engagement/gamification';

const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  key: 'x', type: 'cosmetic', label: 'Article', price: 100, ...over,
});

describe('shopFinalPrice — le prix payé', () => {
  it('applique la remise Premium, et seulement aux abonnés', () => {
    expect(shopFinalPrice(70, { isPremium: true, premiumPct: 20 })).toBe(56);
    expect(shopFinalPrice(70, { isPremium: false, premiumPct: 20 })).toBe(70);
  });

  it('arrondit à l’entier (les relyks ne se divisent pas)', () => {
    expect(shopFinalPrice(75, { isPremium: true, premiumPct: 33 })).toBe(50); // 50,25 → 50
  });

  /* Une remise mal saisie en administration ne doit pas payer l'utilisateur. */
  it('ne descend jamais sous zéro, quelle que soit la remise', () => {
    expect(shopFinalPrice(100, { isPremium: true, premiumPct: 300 })).toBe(0);
    expect(shopFinalPrice(100, { isPremium: true, premiumPct: -50 })).toBe(100); // remise négative ignorée
  });

  /* Un prix négatif rendait l'achat CRÉDITEUR : `gems − (−50)` ajoutait 50 relyks à chaque achat. */
  it('neutralise un prix négatif au lieu de créditer l’acheteur', () => {
    expect(shopFinalPrice(-50, { isPremium: false, premiumPct: 0 })).toBe(0);
    expect(shopFinalPrice(-50, { isPremium: true, premiumPct: 20 })).toBe(0);
  });

  it('traite un prix illisible comme gratuit, jamais comme NaN', () => {
    expect(shopFinalPrice(NaN, { isPremium: false, premiumPct: 0 })).toBe(0);
    expect(shopFinalPrice(undefined as any, { isPremium: false, premiumPct: 0 })).toBe(0);
  });
});

describe('formatCurrency — le nom de la monnaie est configurable', () => {
  it('accorde le pluriel', () => {
    expect(formatCurrency(1, 'Relyk')).toBe('1 Relyk');
    expect(formatCurrency(0, 'Relyk')).toBe('0 Relyks');
    expect(formatCurrency(50, 'Relyk')).toBe('50 Relyks');
  });

  it('ne double pas le « s » d’un nom déjà pluriel', () => {
    expect(formatCurrency(2, 'Gemmes')).toBe('2 Gemmes');
    expect(formatCurrency(1, 'Gemmes')).toBe('1 Gemme');
    expect(currencyPlural('Gemmes')).toBe('Gemmes');
  });

  it('retombe sur le nom par défaut quand la config est vide', () => {
    expect(formatCurrency(3, '')).toBe('3 Relyks');
  });
});

describe('articles uniques et icônes', () => {
  it('reconnaît les déblocages permanents (achetables une seule fois)', () => {
    expect(isUniqueItem(item({ type: 'cosmetic' }))).toBe(true);
    expect(isUniqueItem(item({ type: 'accent_pack' }))).toBe(true);
    expect(isUniqueItem(item({ type: 'theme' }))).toBe(true);
    // Recharges et cadeau du jour restent cumulables.
    expect(isUniqueItem(item({ type: 'gems_iap' }))).toBe(false);
    expect(isUniqueItem(item({ type: 'daily_gems' }))).toBe(false);
  });

  it('distingue une URL d’image d’un nom d’icône', () => {
    expect(isImageIcon('https://exemple.fr/a.png')).toBe(true);
    expect(isImageIcon('diamond')).toBe(false);
    expect(isImageIcon(undefined)).toBe(false);
  });
});

describe('mergeGamificationConfig — ce que l’administration pilote, et ce qu’elle ne pilote pas', () => {
  it('sans config stockée, rend le catalogue du code', () => {
    expect(mergeGamificationConfig(undefined)).toBe(DEFAULT_GAMIFICATION);
  });

  it('l’administration pilote le PRIX, le code garde le libellé', () => {
    const merged = mergeGamificationConfig({
      shop: [{ key: 'accent_pack', type: 'accent_pack', label: 'ANCIEN NOM', price: 999 }] as ShopItem[],
    });
    const pack = merged.shop.find((s) => s.key === 'accent_pack')!;
    expect(pack.price).toBe(999);
    expect(pack.label).toBe('Pack couleurs');
  });

  /* L'identifiant du produit store vient TOUJOURS du code : une valeur stockée obsolète casserait
     l'achat en argent réel (produit introuvable). */
  it('ignore un identifiant de produit store stocké en base', () => {
    const merged = mergeGamificationConfig({
      shop: [{ key: 'gems_100', type: 'gems_iap', label: '100', price: 0, payload: { productId: 'mauvais_id', gems: 250 } }] as ShopItem[],
    });
    const pack = merged.shop.find((s) => s.key === 'gems_100')!;
    expect((pack.payload as any).productId).toBe('100_relyks');
    expect((pack.payload as any).gems).toBe(250); // la quantité, elle, reste pilotable
  });

  it('ne ressuscite pas un article retiré du catalogue', () => {
    const merged = mergeGamificationConfig({
      shop: [{ key: 'streak_restore', type: 'cosmetic', label: 'Rachat de série', price: 50 }] as ShopItem[],
    });
    expect(merged.shop.some((s) => s.key === 'streak_restore')).toBe(false);
  });

  it('conserve un article 100 % personnalisé ajouté en administration', () => {
    const merged = mergeGamificationConfig({
      shop: [{ key: 'custom_bon', type: 'external', label: 'Bon partenaire', price: 400 }] as ShopItem[],
    });
    expect(merged.shop.find((s) => s.key === 'custom_bon')?.price).toBe(400);
  });

  it('complète les réglages absents par les valeurs du code', () => {
    const merged = mergeGamificationConfig({ premium_discount_pct: 35 });
    expect(merged.premium_discount_pct).toBe(35);
    expect(merged.relyka_tab_enabled).toBe(DEFAULT_GAMIFICATION.relyka_tab_enabled);
    expect(merged.identity.currencyName).toBe(DEFAULT_GAMIFICATION.identity.currencyName);
  });
});

/**
 * COHÉRENCE DU CATALOGUE LIVRÉ — ces vérifications portent sur les données du code, pas sur du
 * calcul : un article mal formé (clé en double, prix manquant, pack de relyks sans identifiant
 * store) ne se voit qu'en boutique, à l'achat.
 */
describe('catalogue par défaut', () => {
  it('aucune clé en double', () => {
    const keys = DEFAULT_GAMIFICATION.shop.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tout article payé en relyks a un prix strictement positif', () => {
    const payants = DEFAULT_GAMIFICATION.shop.filter((s) => s.type !== 'daily_gems' && s.type !== 'gems_iap');
    for (const s of payants) expect(s.price).toBeGreaterThan(0);
  });

  it('tout pack en argent réel porte son identifiant store et sa quantité', () => {
    for (const s of DEFAULT_GAMIFICATION.shop.filter((x) => x.type === 'gems_iap')) {
      expect(String((s.payload as any)?.productId ?? '')).not.toBe('');
      expect(Number((s.payload as any)?.gems)).toBeGreaterThan(0);
    }
  });

  it('les succès n’ont ni clé en double ni récompense négative', () => {
    const keys = DEFAULT_GAMIFICATION.badges.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of DEFAULT_GAMIFICATION.badges) expect(b.gems).toBeGreaterThanOrEqual(0);
  });
});
