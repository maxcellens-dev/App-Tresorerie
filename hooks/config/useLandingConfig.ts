/**
 * Config de la page d'accueil « bureau » (landing marketing web), stockée dans
 * app_config.landing et éditée en admin. Tout est data-driven : textes, images,
 * fonctionnalités, statistiques, liens du menu et du pied de page.
 *
 * Affichée uniquement sur web large (desktop). Sur mobile / web étroit → écran d'accueil classique.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { setCachedAdminTheme } from '../../lib/platform/themeBoot';

export interface LandingFeature { icon: string; title: string; text: string }
export interface LandingStat { value: string; label: string }
export interface LandingLink { label: string; anchor?: string; url?: string }

/**
 * RÉSEAU SOCIAL — un lien du pied de page (web bureau) et du bas de l'écran d'accueil (mobile).
 * L'ordre du tableau EST l'ordre d'affichage.
 */
export interface LandingSocial {
  /** Libellé accessible (« Instagram ») — lu par les lecteurs d'écran, jamais affiché. */
  label: string;
  /** URL complète (https://…) ou mailto:. Vide = l'entrée est ignorée. */
  url: string;
  /** Nom d'icône Ionicons (ex. `logo-instagram`). Ignoré si une image est téléversée. */
  icon: string;
  /** Image téléversée (URL publique). Prioritaire sur `icon` — pour les réseaux sans logo Ionicons. */
  image?: string;
}

/** Réglages d'affichage de la rangée de réseaux (communs bureau + mobile). */
export interface LandingSocials {
  /** Masque toute la rangée sans perdre la configuration. */
  enabled: boolean;
  /** Taille de l'icône, en points (16 → 40). */
  size: number;
  /** Alignement horizontal dans le pied de page bureau (le mobile est toujours centré). */
  align: 'left' | 'center' | 'right';
  /** Avant ou après les liens du pied de page (bureau). */
  position: 'above' | 'below';
  /** Habillage de l'icône. */
  shape: 'plain' | 'circle' | 'square';
  items: LandingSocial[];
}

export interface LandingConfig {
  /** Activer la landing desktop (sinon écran d'accueil classique partout). */
  enabled: boolean;
  /** Thème visuel de la page d'accueil bureau : 'dark' (actuel) ou 'light' (clair, même accent). */
  theme: 'dark' | 'light';
  brandName: string;
  navLinks: LandingLink[];
  ctaPrimaryLabel: string;
  ctaSecondaryLabel: string;
  /** Lien vers la fiche Play Store (Android). Vide → badge « Google Play » masqué. */
  androidStoreUrl: string;
  heroBadge: string;
  heroTitle: string;
  heroSubtitle: string;
  /** Image du visuel héros (téléversée). Vide → carte « maquette » stylée. */
  heroImage: string;
  heroBalanceLabel: string;
  heroBalanceValue: string;
  heroTxLabel: string;
  heroTxAmount: string;
  featuresTitle: string;
  featuresSubtitle: string;
  features: LandingFeature[];
  stats: LandingStat[];
  finalTitle: string;
  finalSubtitle: string;
  footerText: string;
  footerLinks: LandingLink[];
  /** Réseaux sociaux — pied de page bureau ET bas de l'écran d'accueil mobile. */
  socials: LandingSocials;
  // ── Écran d'accueil MOBILE (app native + web étroit) — textes propres, éditables en admin. ──
  mobileTagline: string;
  mobileSubtag: string;
  mobileCtaTitle: string;
  mobileCtaText: string;
  mobileCtaPrimaryLabel: string;   // bouton principal (ex. « Se connecter »)
  mobileCtaSecondaryLabel: string; // bouton secondaire (ex. « Créer un compte »)
  mobileFeatures: LandingFeature[];
}

export const DEFAULT_LANDING: LandingConfig = {
  enabled: true,
  theme: 'dark',
  brandName: 'Relyka',
  navLinks: [
    { label: 'Fonctionnalités', anchor: 'features' },
    { label: 'Pourquoi Relyka', anchor: 'stats' },
    { label: 'Commencer', anchor: 'final' },
  ],
  ctaPrimaryLabel: "S'inscrire",
  ctaSecondaryLabel: 'Se connecter',
  androidStoreUrl: '',
  /* ── TUTOIEMENT ────────────────────────────────────────────────────────────────────────────────
     Toute l'app tutoie (règle produit). Ces défauts vouvoyaient encore, et le mélange se voyait
     À L'ŒIL NU sur la carte d'accueil mobile : l'accroche tutoyait (« Sache toujours combien tu peux
     dépenser »), la carte juste en dessous vouvoyait (« Connectez-vous… »). Deux voix dans le même
     écran, sur la toute première page vue par un nouvel utilisateur.
     Ce ne sont que des DÉFAUTS : une configuration déjà enregistrée en admin reste prioritaire. */
  heroBadge: 'Ta trésorerie, enfin sereine',
  heroTitle: 'Reprends le contrôle de ton argent',
  heroSubtitle:
    "Anticipe ton solde futur, suis tes projets d'épargne et laisse-toi guider vers les meilleures décisions financières — au quotidien.",
  heroImage: '',
  heroBalanceLabel: 'Solde prévu fin de mois',
  heroBalanceValue: '4 280 €',
  heroTxLabel: 'Salaire',
  heroTxAmount: '+2 550 €',
  featuresTitle: 'Tout pour piloter tes finances',
  featuresSubtitle: 'Une application pensée pour te faire gagner en clarté et en sérénité.',
  features: [
    { icon: 'trending-up', title: 'Anticipe', text: 'Visualise ton solde futur et prends les bonnes décisions avant qu’il ne soit trop tard.' },
    { icon: 'wallet', title: 'Budget libre', text: 'Sache en un coup d’œil ce que tu peux dépenser librement ce mois-ci.' },
    { icon: 'rocket', title: 'Projets d’épargne', text: 'Définis tes objectifs et suis ta progression mois après mois.' },
    { icon: 'bulb', title: 'Recommandations', text: 'Des conseils personnalisés selon ton profil pour épargner, investir ou conserver.' },
    { icon: 'shield-checkmark', title: 'Sécurisé', text: 'Tes données sont chiffrées et protégées. Ta vie privée d’abord.' },
    { icon: 'trophy', title: 'Motivant', text: 'Séries, succès et relyks : garde le cap avec plaisir.' },
  ],
  stats: [
    { value: '100%', label: 'Gratuit pour démarrer' },
    { value: '0 €', label: 'Aucune carte requise' },
    { value: '24/7', label: 'Accessible partout' },
  ],
  finalTitle: 'Prêt à reprendre le contrôle ?',
  finalSubtitle: 'Crée ton espace en quelques secondes. Aucune carte bancaire requise.',
  footerText: 'Relyka — Prévisions · Budget · Sérénité.',
  footerLinks: [
    { label: 'Confidentialité', anchor: 'confidentialite' },
    { label: 'Mentions légales', anchor: 'legal' },
  ],
  // Aucun réseau par défaut : la rangée n'apparaît que si l'admin en ajoute au moins un.
  socials: { enabled: true, size: 22, align: 'center', position: 'below', shape: 'circle', items: [] },
  // ── Défauts de l'accueil mobile (reprennent les textes actuels de l'écran welcome). ──
  mobileTagline: 'Sache toujours combien tu peux dépenser — sans tableur, sans stress.',
  mobileSubtag: 'Ton budget · Ta projection · Ta sérénité',
  mobileCtaTitle: 'Prêt à commencer ?',
  mobileCtaText: 'Connecte-toi pour retrouver tes comptes, ou crée ton espace en quelques secondes.',
  mobileCtaPrimaryLabel: 'Se connecter',
  mobileCtaSecondaryLabel: 'Créer un compte',
  mobileFeatures: [
    { icon: 'wallet', title: 'Ton Relyka', text: 'LE montant que tu peux dépenser ce mois sans te mettre en difficulté — calculé en continu, charges et projets déduits.' },
    { icon: 'trending-up', title: 'Ta projection', text: 'Où tu en seras dans 6 mois ou 1 an : solde prévu, épargne, investissements — et comment y arriver.' },
    { icon: 'people', title: 'À deux, sans prise de tête', text: 'Comptes communs et projets partagés : chacun sa part, chacun son budget — les comptes d’apothicaire en moins.' },
    { icon: 'shield-checkmark', title: 'Tes données restent les tiennes', text: 'Export complet à tout moment, aucune connexion bancaire requise.' },
  ],
};

const KEY = 'landing_config';

/** Fusionne la config stockée avec les valeurs par défaut (champ par champ). */
export function mergeLanding(stored: Partial<LandingConfig> | undefined): LandingConfig {
  if (!stored) return DEFAULT_LANDING;
  return {
    ...DEFAULT_LANDING,
    ...stored,
    navLinks: stored.navLinks ?? DEFAULT_LANDING.navLinks,
    features: stored.features && stored.features.length > 0 ? stored.features : DEFAULT_LANDING.features,
    stats: stored.stats ?? DEFAULT_LANDING.stats,
    footerLinks: stored.footerLinks ?? DEFAULT_LANDING.footerLinks,
    // Champ par champ : une config enregistrée avant l'ajout des réseaux reste valide.
    socials: { ...DEFAULT_LANDING.socials, ...(stored.socials ?? {}), items: stored.socials?.items ?? [] },
    mobileFeatures: stored.mobileFeatures && stored.mobileFeatures.length > 0 ? stored.mobileFeatures : DEFAULT_LANDING.mobileFeatures,
  };
}

export function useLandingConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<LandingConfig> => {
      if (!supabase) return DEFAULT_LANDING;
      const { data } = await supabase.from('app_config').select('landing').eq('id', 'default').maybeSingle();
      const cfg = mergeLanding((data as any)?.landing);
      // Mémorise le thème admin pour un rendu sans flash au prochain démarrage web.
      setCachedAdminTheme(cfg.theme);
      return cfg;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveLandingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: LandingConfig) => {
      if (!supabase) throw new Error('Supabase non configuré');
      /* `.select('id')` n'est pas décoratif : une écriture REFUSÉE PAR LA RLS ne renvoie PAS d'erreur
         — PostgREST rend simplement « 0 ligne modifiée ». Sans relecture, l'écran affichait donc
         « Enregistré ✓ » alors que rien n'avait bougé, et la page d'accueil publique revenait à son
         état précédent au rechargement suivant. Le cas est devenu réel avec la migration 204, qui
         réserve l'écriture d'app_config aux administrateurs. */
      const { data, error } = await supabase
        .from('app_config')
        .update({ landing: config, updated_at: new Date().toISOString() })
        .eq('id', 'default')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Enregistrement refusé : il faut un compte administrateur pour modifier la page d'accueil.");
      }
      return config;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
