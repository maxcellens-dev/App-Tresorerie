/**
 * Gamification — types, configuration par défaut (éditable en admin) et logique pure.
 *
 * La config vit dans app_config.gamification (éditée via l'écran admin) → tout est
 * « data-driven » : libellés, icônes (nom Ionicons OU URL d'image), seuils, récompenses.
 */

/** Couleur unique de déverrouillage des succès (orangé). Plus de niveaux bronze/argent/or :
 *  chaque succès est dissocié et soit verrouillé, soit débloqué. */
export const UNLOCK_COLOR = '#f59e0b';

/** Métriques calculables qui pilotent le déblocage automatique des badges. */
export type BadgeMetric =
  | 'streak_weeks'           // série hebdo (record)
  | 'gems_earned'            // cumul de gemmes gagnées
  | 'closures_count'         // nb de clôtures mensuelles effectuées
  | 'surplus_months_streak'  // mois consécutifs terminés avec excédent variable > 0
  | 'variable_savings_pct'   // meilleure éco. vs enveloppe sur un mois (%)
  | 'invest_followed'        // nb de fois où la reco d'investir a été suivie
  | 'account_age_days'       // ancienneté du compte (jours depuis l'inscription)
  | 'login_streak_days'      // jours consécutifs de connexion (série quotidienne)
  | 'onboarding_done'        // 1 si toutes les étapes du guide « Pour bien démarrer » sont faites
  | 'profile_photo'          // 1 si une photo de profil est définie
  | 'manual';                // attribué manuellement (code dédié)

export interface BadgeDef {
  key: string;
  category: string;
  metric: BadgeMetric;
  label: string;
  description: string;
  /** Nom d'icône Ionicons (ex. 'trophy') OU URL d'image (https://…). */
  icon: string;
  /** Seuil de déverrouillage (sur la métrique). */
  threshold: number;
  /** Récompense (gemmes/relyks) au déverrouillage. */
  gems: number;
}

export interface GamificationIdentity {
  enabled: boolean;
  currencyName: string;   // ex. « Gemmes de Relyka »
  currencyIcon: string;   // Ionicons ou URL
  streakIcon: string;     // emoji ou Ionicons ou URL
  streakLabel: string;    // ex. « Série »
}

export interface StreakConfig {
  weeklyGems: number;     // gemmes gagnées par semaine validée
  freezeCost: number;     // coût d'un gel de série (gemmes)
}

export type ShopCategory = 'gratuit' | 'series' | 'apparence' | 'cosmetiques' | 'gems';

export const SHOP_CATEGORY_LABELS: Record<ShopCategory, string> = {
  gratuit: 'Gratuit',
  series: 'Séries',
  apparence: 'Apparence',
  cosmetiques: 'Cosmétiques',
  gems: 'Recharger en relyks',
};
/** Ordre d'affichage des catégories dans la boutique. */
export const SHOP_CATEGORY_ORDER: ShopCategory[] = ['gratuit', 'series', 'apparence', 'cosmetiques', 'gems'];

/** Les 7 couleurs d'accent premium débloquées par l'achat « accent_pack » (ou Premium). */
export const ACCENT_PACK_COLORS = ['#FF2D55', '#FF6B6B', '#FFCC00', '#06D6A0', '#00C7BE', '#5856D6', '#C77DFF'];

// ── Cosmétiques équipables ──────────────────────────────────────────────────
// Chaque cosmétique acheté (type 'cosmetic', stocké en inventaire) occupe UN emplacement.
// Un seul cosmétique par emplacement peut être équipé à la fois.
export type CosmeticSlot = 'avatar_frame' | 'title' | 'streak_flame';

export interface CosmeticDef {
  slot: CosmeticSlot;
  /** Libellé de l'emplacement (affiché dans Apparence). */
  slotLabel: string;
  /** Valeur de l'effet : couleur (cadre / flamme) ou texte (titre). */
  value: string;
}

/** Mappe la clé d'article cosmétique → emplacement + effet. */
export const COSMETIC_DEFS: Record<string, CosmeticDef> = {
  cosmetic_avatar_frame: { slot: 'avatar_frame', slotLabel: "Cadre d'avatar", value: '#FFD700' },
  cosmetic_title_legend: { slot: 'title', slotLabel: 'Titre de profil', value: 'Légende' },
  cosmetic_gold_flame: { slot: 'streak_flame', slotLabel: 'Flamme de série', value: '#FFD700' },
};

export type EquippedCosmetics = Partial<Record<CosmeticSlot, string>>;

export interface ShopItem {
  key: string;
  // freeze : +1 (ou payload.qty) gel · streak_restore : restaure la série · daily_gems : 5 gemmes/jour gratuit
  // accent_pack : débloque les couleurs premium · gems_iap : achat de gemmes en argent réel (RevenueCat)
  // cosmetic/theme/external : ajoutés à l'inventaire (effet cosmétique / hors-app)
  type: 'freeze' | 'streak_restore' | 'daily_gems' | 'accent_pack' | 'gems_iap' | 'theme' | 'cosmetic' | 'external';
  category?: ShopCategory;
  label: string;
  description?: string;
  price: number;          // en gemmes (0 pour gratuit / payant en argent réel)
  icon?: string;          // Ionicons ou URL
  payload?: Record<string, unknown>; // ex. { qty } pour un pack, { gems, productId } pour un gems_iap
}

export interface GamificationConfig {
  identity: GamificationIdentity;
  badges: BadgeDef[];
  streak: StreakConfig;
  shop: ShopItem[];
  premium_discount_pct: number; // remise globale boutique pour les abonnés Premium
  /** Affiche l'onglet « Relyka » (services) dans la boutique. Si false : seul l'onglet App, sans barre d'onglets. */
  relyka_tab_enabled: boolean;
}

export const DEFAULT_GAMIFICATION: GamificationConfig = {
  identity: {
    enabled: true,
    currencyName: 'Relyk', // forme SINGULIÈRE — le « s » du pluriel est ajouté à l'affichage
    currencyIcon: 'diamond',
    streakIcon: '🔥',
    streakLabel: 'Série',
  },
  streak: { weeklyGems: 20, freezeCost: 50 },
  premium_discount_pct: 20,
  relyka_tab_enabled: true,
  // Succès DISSOCIÉS : chacun est un palier distinct (1 seuil, 1 récompense), pas de niveaux.
  badges: [
    // ── Fidélité (ancienneté) ──
    { key: 'premiere_connexion', category: 'Fidélité', metric: 'account_age_days', label: 'Bienvenue !', description: 'Ta toute première connexion à Relyka.', icon: 'happy', threshold: 0, gems: 15 },
    { key: 'anciennete_1mois', category: 'Fidélité', metric: 'account_age_days', label: '1 mois ensemble', description: '1 mois d’ancienneté sur Relyka.', icon: 'calendar', threshold: 30, gems: 40 },
    { key: 'anciennete_6mois', category: 'Fidélité', metric: 'account_age_days', label: '6 mois de fidélité', description: '6 mois d’ancienneté sur Relyka.', icon: 'ribbon', threshold: 180, gems: 120 },
    { key: 'anciennete_1an', category: 'Fidélité', metric: 'account_age_days', label: '1 an avec Relyka', description: '1 an d’ancienneté — merci de ta fidélité !', icon: 'trophy', threshold: 365, gems: 300 },
    // ── Assiduité (jours consécutifs) ──
    { key: 'assidu_7', category: 'Assiduité', metric: 'login_streak_days', label: 'Sur une lancée', description: '7 jours de connexion consécutifs.', icon: 'flame', threshold: 7, gems: 40 },
    { key: 'assidu_30', category: 'Assiduité', metric: 'login_streak_days', label: 'Routine en or', description: '30 jours de connexion consécutifs.', icon: 'flame', threshold: 30, gems: 120 },
    { key: 'assidu_100', category: 'Assiduité', metric: 'login_streak_days', label: 'Increvable', description: '100 jours de connexion consécutifs.', icon: 'flash', threshold: 100, gems: 400 },
    // ── Régularité (série hebdo de suivi) ──
    { key: 'serie_4', category: 'Régularité', metric: 'streak_weeks', label: 'Un mois de suivi', description: '4 semaines de suivi d’affilée.', icon: 'pulse', threshold: 4, gems: 30 },
    { key: 'serie_12', category: 'Régularité', metric: 'streak_weeks', label: 'Trimestre suivi', description: '12 semaines de suivi d’affilée.', icon: 'pulse', threshold: 12, gems: 80 },
    { key: 'serie_52', category: 'Régularité', metric: 'streak_weeks', label: 'Année complète', description: '52 semaines de suivi d’affilée.', icon: 'medal', threshold: 52, gems: 300 },
    // ── Économie (mois en excédent) ──
    { key: 'econome_1', category: 'Économie', metric: 'surplus_months_streak', label: 'Premier excédent', description: 'Termine un mois avec un excédent positif.', icon: 'leaf', threshold: 1, gems: 30 },
    { key: 'econome_3', category: 'Économie', metric: 'surplus_months_streak', label: 'Économe régulier', description: '3 mois consécutifs en excédent.', icon: 'leaf', threshold: 3, gems: 80 },
    { key: 'econome_6', category: 'Économie', metric: 'surplus_months_streak', label: 'Fourmi prévoyante', description: '6 mois consécutifs en excédent.', icon: 'leaf', threshold: 6, gems: 200 },
    // ── Budget (éco. vs enveloppe) ──
    { key: 'sniper_10', category: 'Budget', metric: 'variable_savings_pct', label: 'Bonne visée', description: 'Dépense 10 % de moins que ton enveloppe.', icon: 'locate', threshold: 10, gems: 30 },
    { key: 'sniper_25', category: 'Budget', metric: 'variable_savings_pct', label: 'Tireur d’élite', description: 'Dépense 25 % de moins que ton enveloppe.', icon: 'locate', threshold: 25, gems: 80 },
    { key: 'sniper_50', category: 'Budget', metric: 'variable_savings_pct', label: 'Maître du budget', description: 'Dépense 50 % de moins que ton enveloppe.', icon: 'locate', threshold: 50, gems: 200 },
    // ── Rigueur (clôtures) ──
    { key: 'cloture_1', category: 'Rigueur', metric: 'closures_count', label: 'Première clôture', description: 'Effectue ta première clôture mensuelle.', icon: 'time', threshold: 1, gems: 20 },
    { key: 'cloture_3', category: 'Rigueur', metric: 'closures_count', label: 'Rigueur', description: '3 clôtures mensuelles effectuées.', icon: 'time', threshold: 3, gems: 60 },
    { key: 'cloture_12', category: 'Rigueur', metric: 'closures_count', label: 'Horloger', description: '12 clôtures mensuelles effectuées.', icon: 'time', threshold: 12, gems: 250 },
    // ── Action (investissement) ──
    { key: 'invest_1', category: 'Action', metric: 'invest_followed', label: 'Première graine', description: 'Suis une recommandation d’investir.', icon: 'trending-up', threshold: 1, gems: 40 },
    { key: 'invest_5', category: 'Action', metric: 'invest_followed', label: 'Investisseur', description: 'Suis 5 recommandations d’investir.', icon: 'trending-up', threshold: 5, gems: 200 },
    // ── Collection (relyks cumulés) ──
    { key: 'collect_100', category: 'Collection', metric: 'gems_earned', label: 'Premier magot', description: 'Accumule 100 Relyks.', icon: 'diamond', threshold: 100, gems: 0 },
    { key: 'collect_500', category: 'Collection', metric: 'gems_earned', label: 'Petit trésor', description: 'Accumule 500 Relyks.', icon: 'diamond', threshold: 500, gems: 0 },
    { key: 'collect_2000', category: 'Collection', metric: 'gems_earned', label: 'Fortune', description: 'Accumule 2000 Relyks.', icon: 'diamond', threshold: 2000, gems: 0 },
    // ── Profil & Découverte ──
    { key: 'profil_photo', category: 'Profil', metric: 'profile_photo', label: 'Mon plus beau profil', description: 'Ajoute une photo de profil.', icon: 'camera', threshold: 1, gems: 20 },
    { key: 'bien_guide', category: 'Découverte', metric: 'onboarding_done', label: 'Bien guidé', description: 'Termine toutes les étapes du guide « Pour bien démarrer ».', icon: 'compass', threshold: 1, gems: 50 },
  ],
  shop: [
    // ── Gratuit ──
    { key: 'daily_free', type: 'daily_gems', category: 'gratuit', label: 'Cadeau du jour', description: '5 relyks offerts, une fois par jour.', price: 0, icon: 'gift', payload: { gems: 5 } },
    // ── Séries ──
    { key: 'freeze', type: 'freeze', category: 'series', label: 'Gel de série', description: 'Protège ta série une semaine sans suivi (cumulable).', price: 50, icon: 'snow' },
    { key: 'freeze_pack3', type: 'freeze', category: 'series', label: 'Pack de 3 gels', description: 'Ajoute 3 gels de série d’un coup (plus avantageux).', price: 130, icon: 'snow', payload: { qty: 3 } },
    { key: 'streak_restore', type: 'streak_restore', category: 'series', label: 'Récupération de série', description: 'Restaure ta série perdue à son meilleur niveau.', price: 120, icon: 'flame' },
    // ── Cosmétiques ──
    { key: 'cosmetic_gold_flame', type: 'cosmetic', category: 'cosmetiques', label: 'Flamme dorée', description: 'Une flamme de série dorée affichée sur ton profil.', price: 90, icon: 'flame' },
    { key: 'cosmetic_avatar_frame', type: 'cosmetic', category: 'cosmetiques', label: 'Cadre d’avatar doré', description: 'Un cadre doré autour de ton avatar.', price: 80, icon: 'person-circle' },
    { key: 'cosmetic_title_legend', type: 'cosmetic', category: 'cosmetiques', label: 'Titre « Légende »', description: 'Affiche le titre « Légende » sur ton profil.', price: 150, icon: 'ribbon' },
    // ── Recharger en gemmes (argent réel via le store) ──
    { key: 'gems_100', type: 'gems_iap', category: 'gems', label: '100 relyks', description: 'Recharge instantanée.', price: 0, icon: 'diamond', payload: { gems: 100, productId: 'relyka_gems_100' } },
    { key: 'gems_500', type: 'gems_iap', category: 'gems', label: '500 relyks', description: 'Le pack le plus populaire.', price: 0, icon: 'diamond', payload: { gems: 500, productId: 'relyka_gems_500' } },
    { key: 'gems_1200', type: 'gems_iap', category: 'gems', label: '1200 relyks', description: 'Le meilleur rapport.', price: 0, icon: 'diamond', payload: { gems: 1200, productId: 'relyka_gems_1200' } },
  ],
};

/** Fusionne la config stockée avec les valeurs par défaut. */
export function mergeGamificationConfig(stored: Partial<GamificationConfig> | undefined): GamificationConfig {
  if (!stored) return DEFAULT_GAMIFICATION;
  return {
    identity: { ...DEFAULT_GAMIFICATION.identity, ...(stored.identity ?? {}) },
    streak: { ...DEFAULT_GAMIFICATION.streak, ...(stored.streak ?? {}) },
    premium_discount_pct: stored.premium_discount_pct ?? DEFAULT_GAMIFICATION.premium_discount_pct,
    relyka_tab_enabled: stored.relyka_tab_enabled ?? DEFAULT_GAMIFICATION.relyka_tab_enabled,
    badges: mergeBadges(stored.badges),
    shop: mergeShop(stored.shop),
  };
}

/** Conserve les articles boutique stockés (édités en admin) et ajoute les articles
 *  par défaut dont la clé n'est pas encore présente (ex. nouveaux articles d'une mise à jour). */
function mergeShop(stored: ShopItem[] | undefined): ShopItem[] {
  if (!stored || stored.length === 0) return DEFAULT_GAMIFICATION.shop;
  const storedByKey = new Map(stored.map((s) => [s.key, s]));
  // Le LIBELLÉ / la description / le type viennent du code (toujours à jour, ex. nom de la monnaie),
  // seuls le PRIX et le payload (quantités) sont pilotés par l'admin (config stockée).
  const merged = DEFAULT_GAMIFICATION.shop.map((def) => {
    const s = storedByKey.get(def.key);
    if (!s) return def;
    return { ...def, price: s.price ?? def.price, payload: { ...(def.payload ?? {}), ...(s.payload ?? {}) } };
  });
  // Articles 100 % personnalisés (clés absentes du défaut) → conservés tels quels.
  const extra = stored.filter((s) => !DEFAULT_GAMIFICATION.shop.some((d) => d.key === s.key));
  return [...merged, ...extra];
}

/**
 * Conserve les badges stockés (édités en admin) et ajoute les badges par défaut
 * dont la clé n'est pas encore présente.
 *
 * Migration : si la config stockée utilise l'ANCIEN format à niveaux (`levels`),
 * on repart des succès dissociés par défaut (le modèle a changé : 1 succès = 1 palier).
 */
function mergeBadges(stored: BadgeDef[] | undefined): BadgeDef[] {
  if (!stored || stored.length === 0) return DEFAULT_GAMIFICATION.badges;
  const oldFormat = stored.some((b) => (b as any).levels !== undefined || (b as any).threshold === undefined);
  if (oldFormat) return DEFAULT_GAMIFICATION.badges;
  const keys = new Set(stored.map((b) => b.key));
  const missing = DEFAULT_GAMIFICATION.badges.filter((b) => !keys.has(b.key));
  return [...stored, ...missing];
}

/** Forme plurielle du nom de la monnaie (« Relyk » → « Relyks »). */
export function currencyPlural(currencyName: string): string {
  const name = currencyName || 'Relyk';
  return /s$/i.test(name) ? name : `${name}s`;
}

/** « 1 Relyk », « 50 Relyks », « 0 Relyks » — ajoute le « s » du pluriel. */
export function formatCurrency(n: number, currencyName: string): string {
  const name = currencyName || 'Relyk';
  const singular = /s$/i.test(name) ? name.replace(/s$/i, '') : name;
  return `${n} ${Math.abs(n) === 1 ? singular : currencyPlural(name)}`;
}

/** true si la valeur d'icône est une URL d'image (vs un nom Ionicons). */
export function isImageIcon(icon: string | undefined): boolean {
  return !!icon && /^https?:\/\//i.test(icon);
}

// ── Semaines (pour le streak) ───────────────────────────────────────────────

/** Lundi (00:00 local) de la semaine contenant `d`, au format YYYY-MM-DD. */
export function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** Nombre de semaines entières entre deux lundis (YYYY-MM-DD). */
export function weeksBetween(mondayA: string, mondayB: string): number {
  const a = new Date(mondayA + 'T00:00:00');
  const b = new Date(mondayB + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / (7 * 86400000));
}

// ── Évaluation des badges ───────────────────────────────────────────────────

export type BadgeContext = Partial<Record<BadgeMetric, number>>;

/** true si le succès est débloqué : la valeur de la métrique atteint le seuil. */
export function isUnlocked(def: BadgeDef, ctx: BadgeContext): boolean {
  return (ctx[def.metric] ?? 0) >= def.threshold;
}
