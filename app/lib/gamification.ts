/**
 * Gamification — types, configuration par défaut (éditable en admin) et logique pure.
 *
 * La config vit dans app_config.gamification (éditée via l'écran admin) → tout est
 * « data-driven » : libellés, icônes (nom Ionicons OU URL d'image), seuils, récompenses.
 */

export type BadgeLevel = 'bronze' | 'silver' | 'gold';
export const BADGE_LEVELS: BadgeLevel[] = ['bronze', 'silver', 'gold'];
export const LEVEL_COLORS: Record<BadgeLevel, string> = {
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#facc15',
};

/** Métriques calculables qui pilotent le déblocage automatique des badges. */
export type BadgeMetric =
  | 'streak_weeks'           // série hebdo (record)
  | 'gems_earned'            // cumul de gemmes gagnées
  | 'closures_count'         // nb de clôtures mensuelles effectuées
  | 'surplus_months_streak'  // mois consécutifs terminés avec excédent variable > 0
  | 'variable_savings_pct'   // meilleure éco. vs enveloppe sur un mois (%)
  | 'invest_followed'        // nb de fois où la reco d'investir a été suivie
  | 'manual';                // attribué manuellement (code dédié)

export interface BadgeLevelDef { threshold: number; gems: number }

export interface BadgeDef {
  key: string;
  category: string;
  metric: BadgeMetric;
  label: string;
  description: string;
  /** Nom d'icône Ionicons (ex. 'trophy') OU URL d'image (https://…). */
  icon: string;
  levels: Partial<Record<BadgeLevel, BadgeLevelDef>>;
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

export interface ShopItem {
  key: string;
  type: 'freeze' | 'theme' | 'external';
  label: string;
  description?: string;
  price: number;          // en gemmes
  icon?: string;          // Ionicons ou URL
  payload?: Record<string, unknown>; // ex. { presetId } pour un thème
}

export interface GamificationConfig {
  identity: GamificationIdentity;
  badges: BadgeDef[];
  streak: StreakConfig;
  shop: ShopItem[];
  premium_discount_pct: number; // remise globale boutique pour les abonnés Premium
}

export const DEFAULT_GAMIFICATION: GamificationConfig = {
  identity: {
    enabled: true,
    currencyName: 'Gemmes',
    currencyIcon: 'diamond',
    streakIcon: '🔥',
    streakLabel: 'Série',
  },
  streak: { weeklyGems: 20, freezeCost: 50 },
  premium_discount_pct: 20,
  badges: [
    {
      key: 'regularite', category: 'Régularité', metric: 'streak_weeks',
      label: 'La Régularité', description: 'Maintiens ta série de suivi semaine après semaine.',
      icon: 'flame',
      levels: { bronze: { threshold: 4, gems: 30 }, silver: { threshold: 12, gems: 80 }, gold: { threshold: 52, gems: 300 } },
    },
    {
      key: 'econome', category: 'Économie', metric: 'surplus_months_streak',
      label: "L'Économe Prévoyant", description: 'Termine tes mois avec un excédent variable positif.',
      icon: 'leaf',
      levels: { bronze: { threshold: 1, gems: 30 }, silver: { threshold: 3, gems: 80 }, gold: { threshold: 6, gems: 200 } },
    },
    {
      key: 'sniper', category: 'Économie', metric: 'variable_savings_pct',
      label: 'Le Sniper du Budget', description: 'Dépense moins que ton enveloppe variable estimée.',
      icon: 'locate',
      levels: { bronze: { threshold: 10, gems: 30 }, silver: { threshold: 25, gems: 80 }, gold: { threshold: 50, gems: 200 } },
    },
    {
      key: 'maitre_temps', category: 'Rigueur', metric: 'closures_count',
      label: 'Le Maître du Temps', description: 'Effectue tes clôtures mensuelles avec rigueur.',
      icon: 'time',
      levels: { bronze: { threshold: 1, gems: 20 }, silver: { threshold: 3, gems: 60 }, gold: { threshold: 12, gems: 250 } },
    },
    {
      key: 'investisseur', category: 'Action', metric: 'invest_followed',
      label: "Graine d'Investisseur", description: "Suis la recommandation d'investir ton excédent.",
      icon: 'trending-up',
      levels: { bronze: { threshold: 1, gems: 40 }, gold: { threshold: 5, gems: 200 } },
    },
    {
      key: 'collectionneur', category: 'Méta', metric: 'gems_earned',
      label: 'Le Collectionneur', description: 'Accumule des gemmes au fil de ta progression.',
      icon: 'diamond',
      levels: { bronze: { threshold: 100, gems: 0 }, silver: { threshold: 500, gems: 0 }, gold: { threshold: 2000, gems: 0 } },
    },
  ],
  shop: [
    { key: 'freeze', type: 'freeze', label: 'Gel de série', description: 'Protège ta série une semaine sans suivi.', price: 50, icon: 'snow' },
  ],
};

/** Fusionne la config stockée avec les valeurs par défaut. */
export function mergeGamificationConfig(stored: Partial<GamificationConfig> | undefined): GamificationConfig {
  if (!stored) return DEFAULT_GAMIFICATION;
  return {
    identity: { ...DEFAULT_GAMIFICATION.identity, ...(stored.identity ?? {}) },
    streak: { ...DEFAULT_GAMIFICATION.streak, ...(stored.streak ?? {}) },
    premium_discount_pct: stored.premium_discount_pct ?? DEFAULT_GAMIFICATION.premium_discount_pct,
    badges: stored.badges && stored.badges.length > 0 ? stored.badges : DEFAULT_GAMIFICATION.badges,
    shop: stored.shop ?? DEFAULT_GAMIFICATION.shop,
  };
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

/** Niveau le plus haut atteint pour un badge selon la métrique du contexte. */
export function levelReached(def: BadgeDef, ctx: BadgeContext): BadgeLevel | null {
  const value = ctx[def.metric] ?? 0;
  let reached: BadgeLevel | null = null;
  for (const lvl of BADGE_LEVELS) {
    const ld = def.levels[lvl];
    if (ld && value >= ld.threshold) reached = lvl;
  }
  return reached;
}

export function levelIndex(level: BadgeLevel | null): number {
  return level ? BADGE_LEVELS.indexOf(level) : -1;
}
