/**
 * Gamification — types, configuration par défaut (éditable en admin) et logique pure.
 *
 * La config vit dans app_config.gamification (éditée via l'écran admin) → tout est
 * « data-driven » : libellés, icônes (nom Ionicons OU URL d'image), seuils, récompenses.
 */

/** Couleur unique de déverrouillage des succès (orangé). Plus de niveaux bronze/argent/or :
 *  chaque succès est dissocié et soit verrouillé, soit débloqué. */
export const UNLOCK_COLOR = '#f59e0b';

/** Succès « Bienvenue » (1ʳᵉ connexion) : jamais célébré en pop-up — il est « consommé »
 *  à la 1ʳᵉ visite de la page Succès (voir AchievementCelebration & écran Succès). */
export const WELCOME_BADGE_KEY = 'premiere_connexion';

/**
 * Métriques calculables qui pilotent le déblocage automatique des badges.
 * Toute métrique listée ici DOIT être alimentée par `GamificationSync` (ou par l'état de
 * gamification lu dans `evaluate`) — sinon les badges qui s'en servent ne se débloquent jamais.
 * `variable_savings_pct` (badges « sniper ») a été RETIRÉ pour cette raison : l'enveloppe variable
 * n'est pas historisée par mois, la métrique n'était donc calculable qu'au prix d'une approximation.
 * `pulse_green_months` a été retiré avec le système de couleurs de l'état des lieux : ce dernier ne
 * juge plus rien (ni vert, ni rouge), il n'y a donc plus de « mois validé au vert » à récompenser.
 */
export type BadgeMetric =
  | 'streak_weeks'           // nb de semaines où l'utilisateur est venu (cumul, ne redescend jamais)
  | 'gems_earned'            // cumul de gemmes gagnées
  | 'closures_count'         // nb de clôtures mensuelles effectuées
  | 'consecutive_closures'   // plus longue série de mois consécutifs clôturés (fiabilité)
  | 'surplus_months_streak'  // mois consécutifs terminés avec excédent variable > 0
  | 'invest_followed'        // nb de fois où la reco d'investir a été suivie
  | 'account_age_days'       // ancienneté du compte (jours depuis l'inscription)
  | 'login_streak_days'      // jours consécutifs de connexion (série quotidienne)
  | 'onboarding_done'        // 1 si toutes les étapes du guide « Pour bien démarrer » sont faites
  | 'profile_photo'          // 1 si une photo de profil est définie
  | 'manual';                // attribué manuellement (code dédié)

/** Métriques encore supportées (garde-fou runtime : une config admin en base peut être obsolète). */
const SUPPORTED_METRICS: ReadonlySet<string> = new Set<BadgeMetric>([
  'streak_weeks', 'gems_earned', 'closures_count', 'consecutive_closures',
  'surplus_months_streak', 'invest_followed', 'account_age_days', 'login_streak_days',
  'onboarding_done', 'profile_photo', 'manual',
]);

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

/**
 * LA SÉRIE NE FAIT QUE MONTER. On compte les semaines où l'utilisateur est venu, et on ignore
 * simplement celles où il n'est pas venu : elle ne retombe jamais à zéro. Il n'y a donc plus ni
 * gel, ni rachat, ni alerte « ta série est en danger » — venir reste récompensé, ne pas venir
 * n'est plus puni.
 */
export interface StreakConfig {
  weeklyGems: number;     // gemmes gagnées par semaine validée
}

export type ShopCategory = 'gratuit' | 'apparence' | 'cosmetiques' | 'titres' | 'premium' | 'gems';

export const SHOP_CATEGORY_LABELS: Record<ShopCategory, string> = {
  gratuit: 'Gratuit',
  apparence: 'Apparence',
  cosmetiques: 'Cosmétiques',
  titres: 'Titres de profil',
  premium: 'Exclusif Premium',
  gems: 'Recharger en relyks',
};
/** Ordre d'affichage des catégories dans la boutique. */
export const SHOP_CATEGORY_ORDER: ShopCategory[] = ['gratuit', 'apparence', 'cosmetiques', 'titres', 'premium', 'gems'];

/** Icône représentative par catégorie (pour les filtres de la boutique). */
export const SHOP_CATEGORY_ICONS: Record<ShopCategory, string> = {
  gratuit: 'gift-outline',
  apparence: 'color-palette-outline',
  cosmetiques: 'sparkles-outline',
  titres: 'ribbon-outline',
  premium: 'star',
  gems: 'diamond-outline',
};

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
/* ── PALETTE COMMUNE aux cadres d'avatar et aux flammes de série ────────────────────────────────
   Une seule palette pour les deux emplacements COLORÉS : chaque teinte existe en cadre ET en flamme,
   au même prix et au même niveau de rareté. Sans ça, on aboutissait à ce qu'on avait — une flamme
   violette sans cadre assorti, un cadre argenté sans flamme, un doré à 80 en cadre et 90 en flamme —
   c'est-à-dire une collection qu'on ne peut pas assortir et des prix qu'on ne peut pas expliquer.

   Quatre niveaux de rareté, un prix par niveau, tous emplacements confondus. */
export const COSMETIC_PALETTE = {
  silver:  { hex: '#C0C0C0', label: 'argenté',  labelF: 'argentée' },
  gold:    { hex: '#f59e0b', label: 'doré',     labelF: 'dorée'    },
  blue:    { hex: '#3B82F6', label: 'bleu',     labelF: 'bleue'    },
  emerald: { hex: '#10B981', label: 'émeraude', labelF: 'émeraude' },
  neon:    { hex: '#D946EF', label: 'néon',     labelF: 'néon'     },
  red:     { hex: '#F43F5E', label: 'rouge',    labelF: 'rouge'    },
  /* « Prestige » = le VIOLET (et non plus le rouge). C'est la teinte la plus rare, celle qui n'a
     pas de nom de couleur mais un nom de rang. Le rouge redevient une teinte comme une autre.
     ⚠️ Les CLÉS d'inventaire ne suivent pas ce renommage — elles ne peuvent pas bouger sans changer
     la couleur des articles déjà achetés. `cosmetic_*_violet` porte donc le nom « prestige », et
     `cosmetic_*_prestige` porte le nom « rouge ». Se fier au `hex`, jamais au nom de la clé. */
  prestige: { hex: '#8B5CF6', label: 'prestige', labelF: 'prestige' },
} as const;

/** Prix par niveau de rareté. Un cadre et une flamme de même teinte coûtent le MÊME prix. */
export const COSMETIC_TIER_PRICE = { commun: 70, rare: 90, epique: 220, legendaire: 350 } as const;
/** Prix par niveau pour les TITRES (pas de teinte : la rareté tient au mot lui-même). */
export const TITLE_TIER_PRICE = { role: 120, maitrise: 150, premium: 300 } as const;

const frame = (hex: string): CosmeticDef => ({ slot: 'avatar_frame', slotLabel: "Cadre d'avatar", value: hex });
const flame = (hex: string): CosmeticDef => ({ slot: 'streak_flame', slotLabel: 'Flamme de série', value: hex });
const title = (v: string): CosmeticDef => ({ slot: 'title', slotLabel: 'Titre de profil', value: v });

/* ⚠️ Les CLÉS existantes ne changent JAMAIS : elles sont dans l'inventaire des utilisateurs, et en
   changer une reviendrait à modifier la couleur d'un article déjà acheté.
   Deux conséquences visibles ici :
     • `cosmetic_avatar_frame` / `cosmetic_gold_flame` gardent leur nom historique, hors nomenclature ;
     • `cosmetic_*_violet` porte désormais le NOM « prestige » et `cosmetic_*_prestige` le nom
       « rouge » — les clés n'ont pas suivi le renommage, les couleurs (hex) sont la vérité. */
export const COSMETIC_DEFS: Record<string, CosmeticDef> = {
  // ── Cadres d'avatar (value = couleur de la bordure) ──
  cosmetic_frame_silver:   frame(COSMETIC_PALETTE.silver.hex),
  cosmetic_avatar_frame:   frame(COSMETIC_PALETTE.gold.hex),      // « Cadre doré » (clé historique)
  cosmetic_frame_blue:     frame(COSMETIC_PALETTE.blue.hex),
  cosmetic_frame_emerald:  frame(COSMETIC_PALETTE.emerald.hex),
  cosmetic_frame_neon:     frame(COSMETIC_PALETTE.neon.hex),
  cosmetic_frame_prestige: frame(COSMETIC_PALETTE.red.hex),       // « Cadre rouge »    (clé historique)
  cosmetic_frame_violet:   frame(COSMETIC_PALETTE.prestige.hex),  // « Cadre prestige » (violet)
  // ── Flammes de série (value = couleur de la flamme) — MÊME palette que les cadres ──
  cosmetic_flame_silver:   flame(COSMETIC_PALETTE.silver.hex),
  cosmetic_gold_flame:     flame(COSMETIC_PALETTE.gold.hex),      // « Flamme dorée » (clé historique)
  cosmetic_flame_blue:     flame(COSMETIC_PALETTE.blue.hex),
  cosmetic_flame_emerald:  flame(COSMETIC_PALETTE.emerald.hex),
  cosmetic_flame_neon:     flame(COSMETIC_PALETTE.neon.hex),
  cosmetic_flame_prestige: flame(COSMETIC_PALETTE.red.hex),       // « Flamme rouge »    (clé historique)
  cosmetic_flame_violet:   flame(COSMETIC_PALETTE.prestige.hex),  // « Flamme prestige » (violette)
  /* ── Titres de profil (value = texte affiché) ──
     « Maître de l'épargne » puis « Maître de l'investissement » forment une PROGRESSION, et dans cet
     ordre : mettre de côté vient avant faire fructifier — c'est la logique de l'app elle-même, et
     investir est le geste le plus gratifiant des deux. Même construction pour les deux, sinon le
     rapport entre les deux titres ne se lit pas. */
  cosmetic_title_strategist:  title('Stratège'),
  cosmetic_title_builder:     title('Bâtisseur'),
  cosmetic_title_saver:       title("Maître de l'épargne"),
  cosmetic_title_investor:    title("Maître de l'investissement"),
  cosmetic_title_legend:      title('Légende'),
  cosmetic_title_visionnaire: title('Visionnaire'),
  cosmetic_title_elite:       title('Élite'),
};

export type EquippedCosmetics = Partial<Record<CosmeticSlot, string>>;

export interface ShopItem {
  key: string;
  // daily_gems : 5 gemmes/jour gratuit · accent_pack : débloque les couleurs premium
  // gems_iap : achat de gemmes en argent réel (RevenueCat)
  // cosmetic/theme/external : ajoutés à l'inventaire (effet cosmétique / hors-app)
  // (`freeze` et `streak_restore` ont disparu avec les gels et le rachat de série : la série ne
  //  redescend plus, il n'y a donc plus rien à protéger ni à racheter.)
  type: 'daily_gems' | 'accent_pack' | 'gems_iap' | 'theme' | 'cosmetic' | 'external';
  category?: ShopCategory;
  label: string;
  description?: string;
  price: number;          // en gemmes (0 pour gratuit / payant en argent réel)
  icon?: string;          // Ionicons ou URL
  payload?: Record<string, unknown>; // ex. { qty } pour un pack, { gems, productId } pour un gems_iap
  /** Article RÉSERVÉ aux abonnés Premium : visible pour tous mais figé (verrouillé) pour les non-Premium. */
  premiumOnly?: boolean;
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
  streak: { weeklyGems: 20 },
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
    // « Semaines connectées » : le cumul, pas une suite ininterrompue — la flamme ne redescend plus.
    { key: 'serie_4', category: 'Régularité', metric: 'streak_weeks', label: 'Un mois de suivi', description: '4 semaines où tu es venu sur Relyka.', icon: 'pulse', threshold: 4, gems: 30 },
    { key: 'serie_12', category: 'Régularité', metric: 'streak_weeks', label: 'Trimestre suivi', description: '12 semaines où tu es venu sur Relyka.', icon: 'pulse', threshold: 12, gems: 80 },
    { key: 'serie_52', category: 'Régularité', metric: 'streak_weeks', label: 'Année complète', description: '52 semaines où tu es venu sur Relyka.', icon: 'medal', threshold: 52, gems: 300 },
    // ── Économie (mois en excédent) ──
    { key: 'econome_1', category: 'Économie', metric: 'surplus_months_streak', label: 'Premier excédent', description: 'Termine un mois avec un excédent positif.', icon: 'leaf', threshold: 1, gems: 30 },
    { key: 'econome_3', category: 'Économie', metric: 'surplus_months_streak', label: 'Économe régulier', description: '3 mois consécutifs en excédent.', icon: 'leaf', threshold: 3, gems: 80 },
    { key: 'econome_6', category: 'Économie', metric: 'surplus_months_streak', label: 'Fourmi prévoyante', description: '6 mois consécutifs en excédent.', icon: 'leaf', threshold: 6, gems: 200 },
    // ── Rigueur (clôtures) ──
    { key: 'cloture_1', category: 'Rigueur', metric: 'closures_count', label: 'Première clôture', description: 'Effectue ta première clôture mensuelle.', icon: 'time', threshold: 1, gems: 20 },
    { key: 'cloture_3', category: 'Rigueur', metric: 'closures_count', label: 'Rigueur', description: '3 clôtures mensuelles effectuées.', icon: 'time', threshold: 3, gems: 60 },
    { key: 'cloture_12', category: 'Rigueur', metric: 'closures_count', label: 'Horloger', description: '12 clôtures mensuelles effectuées.', icon: 'time', threshold: 12, gems: 250 },
    // ── Fiabilité (suivi régulier : mois consécutifs clôturés) ──
    { key: 'fiable_3', category: 'Rigueur', metric: 'consecutive_closures', label: 'Suivi fiable', description: '3 mois consécutifs clôturés.', icon: 'shield-checkmark', threshold: 3, gems: 80 },
    { key: 'fiable_6', category: 'Rigueur', metric: 'consecutive_closures', label: 'Régularité', description: '6 mois consécutifs clôturés.', icon: 'shield-checkmark', threshold: 6, gems: 160 },
    { key: 'fiable_12', category: 'Rigueur', metric: 'consecutive_closures', label: 'Un an de suivi fiable', description: '12 mois consécutifs clôturés.', icon: 'shield-checkmark', threshold: 12, gems: 400 },
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
    // (Plus de catégorie « Séries » : gels et récupération de série n'ont plus d'objet.)
    // ── Apparence ──
    { key: 'accent_pack', type: 'accent_pack', category: 'apparence', label: 'Pack couleurs', description: '7 couleurs d\'accent supplémentaires pour personnaliser ton espace.', price: 200, icon: 'color-palette' },
    /* ── Cosmétiques : cadres d'avatar & flammes de série ─────────────────────────────────────
       Rangés PAR TEINTE (cadre puis flamme assortie) et non par emplacement : c'est ainsi qu'on les
       choisit — on veut « du violet », pas « un cadre ». Chaque paire partage son prix, fixé par le
       niveau de rareté (COSMETIC_TIER_PRICE) et non à l'estime : c'est ce qui manquait quand le doré
       coûtait 80 en cadre et 90 en flamme.
       Aucun prix n'AUGMENTE par rapport à l'ancienne grille : harmoniser ne doit pénaliser personne
       qui économisait déjà pour un article précis.
       Icône = l'emplacement (person-circle / flame / ribbon), jamais la rareté — sinon deux articles
       du même type n'ont pas le même pictogramme, et la liste devient illisible. */
    // Commun (70)
    { key: 'cosmetic_frame_silver', type: 'cosmetic', category: 'cosmetiques', label: 'Cadre argenté', description: 'Un cadre argenté élégant autour de ton avatar.', price: 70, icon: 'person-circle' },
    { key: 'cosmetic_flame_silver', type: 'cosmetic', category: 'cosmetiques', label: 'Flamme argentée', description: 'La flamme de série assortie au cadre argenté.', price: 70, icon: 'flame' },
    { key: 'cosmetic_avatar_frame', type: 'cosmetic', category: 'cosmetiques', label: 'Cadre doré', description: 'Un cadre doré autour de ton avatar.', price: 70, icon: 'person-circle' },
    { key: 'cosmetic_gold_flame', type: 'cosmetic', category: 'cosmetiques', label: 'Flamme dorée', description: 'La flamme de série assortie au cadre doré.', price: 70, icon: 'flame' },
    // Rare (90)
    { key: 'cosmetic_frame_blue', type: 'cosmetic', category: 'cosmetiques', label: 'Cadre bleu', description: 'Un cadre bleu glacé autour de ton avatar.', price: 90, icon: 'person-circle' },
    { key: 'cosmetic_flame_blue', type: 'cosmetic', category: 'cosmetiques', label: 'Flamme bleue', description: 'La flamme de série assortie au cadre bleu.', price: 90, icon: 'flame' },
    { key: 'cosmetic_frame_emerald', type: 'cosmetic', category: 'cosmetiques', label: 'Cadre émeraude', description: 'Un cadre vert émeraude autour de ton avatar.', price: 90, icon: 'person-circle' },
    { key: 'cosmetic_flame_emerald', type: 'cosmetic', category: 'cosmetiques', label: 'Flamme émeraude', description: 'La flamme de série assortie au cadre émeraude.', price: 90, icon: 'flame' },
    /* ── Titres de profil ──
       Deux niveaux : un RÔLE qu'on se donne (120), une MAÎTRISE qu'on revendique (150).
       Les deux « Maître de… » se lisent comme une progression : on épargne d'abord, on investit
       ensuite. C'est pour ça qu'ils ne sont pas au même niveau. */
    { key: 'cosmetic_title_strategist', type: 'cosmetic', category: 'titres', label: 'Titre « Stratège »', description: 'Affiche le titre « Stratège » sur ton profil.', price: 120, icon: 'ribbon' },
    { key: 'cosmetic_title_builder', type: 'cosmetic', category: 'titres', label: 'Titre « Bâtisseur »', description: 'Affiche le titre « Bâtisseur » sur ton profil.', price: 120, icon: 'ribbon' },
    { key: 'cosmetic_title_saver', type: 'cosmetic', category: 'titres', label: 'Titre « Maître de l’épargne »', description: 'Pour ceux qui savent mettre de côté.', price: 120, icon: 'ribbon' },
    { key: 'cosmetic_title_legend', type: 'cosmetic', category: 'titres', label: 'Titre « Légende »', description: 'Affiche le titre « Légende » sur ton profil.', price: 150, icon: 'ribbon' },
    { key: 'cosmetic_title_investor', type: 'cosmetic', category: 'titres', label: 'Titre « Maître de l’investissement »', description: 'L’étape d’après : faire fructifier, pas seulement garder.', price: 150, icon: 'ribbon' },
    /* ── Exclusif Premium (visible mais verrouillé pour les non-Premium) ──
       Mêmes paires teinte par teinte que plus haut.
       ⚠️ Les CLÉS ne correspondent plus aux NOMS depuis que « prestige » désigne le violet :
       `cosmetic_*_prestige` = le ROUGE, `cosmetic_*_violet` = le PRESTIGE (violet). Renommer les
       clés changerait la couleur des articles déjà achetés — on ne le fait pas. */
    // Épique (220)
    { key: 'cosmetic_frame_neon', type: 'cosmetic', category: 'premium', label: 'Cadre néon', description: 'Un cadre néon magenta exclusif.', price: 220, icon: 'person-circle', premiumOnly: true },
    { key: 'cosmetic_flame_neon', type: 'cosmetic', category: 'premium', label: 'Flamme néon', description: 'La flamme de série assortie au cadre néon.', price: 220, icon: 'flame', premiumOnly: true },
    { key: 'cosmetic_frame_prestige', type: 'cosmetic', category: 'premium', label: 'Cadre rouge', description: 'Un cadre rouge vif exclusif.', price: 220, icon: 'person-circle', premiumOnly: true },
    { key: 'cosmetic_flame_prestige', type: 'cosmetic', category: 'premium', label: 'Flamme rouge', description: 'La flamme de série assortie au cadre rouge.', price: 220, icon: 'flame', premiumOnly: true },
    // Légendaire (350) — le PRESTIGE : la teinte la plus rare, en cadre et en flamme
    { key: 'cosmetic_frame_violet', type: 'cosmetic', category: 'premium', label: 'Cadre prestige', description: 'La teinte la plus rare, réservée aux Premium.', price: 350, icon: 'person-circle', premiumOnly: true },
    { key: 'cosmetic_flame_violet', type: 'cosmetic', category: 'premium', label: 'Flamme prestige', description: 'La flamme de série assortie au cadre prestige.', price: 350, icon: 'flame', premiumOnly: true },
    // Titres Premium (300) — même niveau : « le plus prestigieux » ne peut pas être deux articles
    // à deux prix différents.
    { key: 'cosmetic_title_visionnaire', type: 'cosmetic', category: 'premium', label: 'Titre « Visionnaire »', description: 'Un titre exclusif réservé aux Premium.', price: 300, icon: 'ribbon', premiumOnly: true },
    { key: 'cosmetic_title_elite', type: 'cosmetic', category: 'premium', label: 'Titre « Élite »', description: 'Le titre le plus prestigieux, réservé aux Premium.', price: 300, icon: 'ribbon', premiumOnly: true },
    // ── Recharger en gemmes (argent réel via le store) ──
    { key: 'gems_100', type: 'gems_iap', category: 'gems', label: '100 relyks', description: 'Recharge instantanée.', price: 0, icon: 'diamond', payload: { gems: 100, productId: '100_relyks' } },
    { key: 'gems_500', type: 'gems_iap', category: 'gems', label: '500 relyks', description: 'Le pack le plus populaire.', price: 0, icon: 'diamond', payload: { gems: 500, productId: '500_relyks' } },
    { key: 'gems_1000', type: 'gems_iap', category: 'gems', label: '1000 relyks', description: 'Le meilleur rapport.', price: 0, icon: 'diamond', payload: { gems: 1000, productId: '1000_relyks' } },
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

/** Clés d'articles retirés du catalogue : toujours filtrées, même si une ancienne
 *  config stockée en base les contient encore (ex. pack renommé gems_1200 → gems_1000). */
const DEPRECATED_SHOP_KEYS = new Set<string>(['gems_1200', 'freeze', 'freeze_pack3', 'streak_restore']);

/** Types d'articles retirés du code : un article personnalisé qui en porte un ne ferait plus rien. */
const DEPRECATED_SHOP_TYPES = new Set<string>(['freeze', 'streak_restore']);

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
    // L'admin pilote prix + quantités, MAIS le productId (identifiant store) vient TOUJOURS du code
    // (une mauvaise valeur stockée casserait l'achat — ex. relyka_gems_100 au lieu de 100_relyks).
    const payload = { ...(def.payload ?? {}), ...(s.payload ?? {}) };
    if ((def.payload as any)?.productId) (payload as any).productId = (def.payload as any).productId;
    return { ...def, price: s.price ?? def.price, payload };
  });
  // Articles 100 % personnalisés (clés absentes du défaut) → conservés tels quels.
  const extra = stored.filter((s) => !DEFAULT_GAMIFICATION.shop.some((d) => d.key === s.key));
  return [...merged, ...extra]
    .filter((s) => !DEPRECATED_SHOP_KEYS.has(s.key) && !DEPRECATED_SHOP_TYPES.has(s.type));
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
  // Garde-fou : la config admin stockée en base peut contenir des badges dont la métrique a été
  // retirée (ex. « sniper » / variable_savings_pct) → indéblocables. On ne les ressuscite pas.
  const usable = stored.filter((b) => SUPPORTED_METRICS.has(b.metric));
  const keys = new Set(usable.map((b) => b.key));
  const missing = DEFAULT_GAMIFICATION.badges.filter((b) => !keys.has(b.key));
  return [...usable, ...missing];
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

/** Produit « unique » : déblocage permanent acheté en relyks (couleurs, cosmétiques, thèmes).
 *  Une fois acquis, il ne peut pas être racheté (≠ recharges, gels de série, cadeau du jour,
 *  ou bons hors-app qui restent cumulables). */
export function isUniqueItem(item: ShopItem): boolean {
  return item.type === 'accent_pack' || item.type === 'cosmetic' || item.type === 'theme';
}

// ── Sélection du mois (promo mensuelle sur des lots, POUR TOUS) ──────────────
// La remise mensuelle s'applique à tout le monde et se CUMULE avec la remise Premium (les Premium ont
// donc un deal encore meilleur sur ces articles). Le calcul des articles mis en avant est DÉTERMINISTE
// (rotation par mois) et partagé entre l'affichage (boutique) et l'achat (buyItem) pour honorer la remise.

/* La « Sélection du mois » (2 articles tournants à −30 %) a été RETIRÉE : elle encombrait la
   boutique plus qu'elle ne servait, et faisait cohabiter deux prix pour le même article. Il ne
   reste qu'une remise, celle des abonnés Premium. */

/** Prix final arrondi d'un article (remise Premium le cas échéant). */
export function shopFinalPrice(base: number, opts: { isPremium: boolean; premiumPct: number }): number {
  const factor = opts.isPremium ? Math.max(0, 1 - Math.max(0, opts.premiumPct) / 100) : 1;
  return Math.round(base * factor);
}

// ── Semaines (pour le streak) ───────────────────────────────────────────────

/** Lundi (00:00 local) de la semaine contenant `d`, au format YYYY-MM-DD. */
export function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/* `weeksBetween` a disparu avec les gels : on n'a plus besoin de mesurer l'écart entre deux
   visites. Une semaine visitée = +1, une semaine sans visite = rien. */

// ── Évaluation des badges ───────────────────────────────────────────────────

export type BadgeContext = Partial<Record<BadgeMetric, number>>;

/** true si le succès est débloqué : la valeur de la métrique atteint le seuil. */
export function isUnlocked(def: BadgeDef, ctx: BadgeContext): boolean {
  return (ctx[def.metric] ?? 0) >= def.threshold;
}
