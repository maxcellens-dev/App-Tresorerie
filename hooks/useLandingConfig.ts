/**
 * Config de la page d'accueil « bureau » (landing marketing web), stockée dans
 * app_config.landing et éditée en admin. Tout est data-driven : textes, images,
 * fonctionnalités, statistiques, liens du menu et du pied de page.
 *
 * Affichée uniquement sur web large (desktop). Sur mobile / web étroit → écran d'accueil classique.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { setCachedAdminTheme } from '../lib/themeBoot';

export interface LandingFeature { icon: string; title: string; text: string }
export interface LandingStat { value: string; label: string }
export interface LandingLink { label: string; anchor?: string; url?: string }

export interface LandingConfig {
  /** Activer la landing desktop (sinon écran d'accueil classique partout). */
  enabled: boolean;
  /** Thème visuel de la page d'accueil bureau : 'dark' (actuel) ou 'light' (clair, même accent). */
  theme: 'dark' | 'light';
  brandName: string;
  navLinks: LandingLink[];
  ctaPrimaryLabel: string;
  ctaSecondaryLabel: string;
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
  heroBadge: 'Votre trésorerie, enfin sereine',
  heroTitle: 'Reprenez le contrôle de votre argent',
  heroSubtitle:
    "Anticipez votre solde futur, suivez vos projets d'épargne et laissez-vous guider vers les meilleures décisions financières — au quotidien.",
  heroImage: '',
  heroBalanceLabel: 'Solde prévu fin de mois',
  heroBalanceValue: '4 280 €',
  heroTxLabel: 'Salaire',
  heroTxAmount: '+2 550 €',
  featuresTitle: 'Tout pour piloter vos finances',
  featuresSubtitle: 'Une application pensée pour vous faire gagner en clarté et en sérénité.',
  features: [
    { icon: 'trending-up', title: 'Anticipez', text: 'Visualisez votre solde futur et prenez les bonnes décisions avant qu’il ne soit trop tard.' },
    { icon: 'wallet', title: 'Budget libre', text: 'Sachez en un coup d’œil ce que vous pouvez dépenser librement ce mois-ci.' },
    { icon: 'rocket', title: 'Projets d’épargne', text: 'Définissez vos objectifs et suivez votre progression mois après mois.' },
    { icon: 'bulb', title: 'Recommandations', text: 'Des conseils personnalisés selon votre profil pour épargner, investir ou conserver.' },
    { icon: 'shield-checkmark', title: 'Sécurisé', text: 'Vos données sont chiffrées et protégées. Votre vie privée d’abord.' },
    { icon: 'trophy', title: 'Motivant', text: 'Séries, succès et relyks : gardez le cap avec plaisir.' },
  ],
  stats: [
    { value: '100%', label: 'Gratuit pour démarrer' },
    { value: '0 €', label: 'Aucune carte requise' },
    { value: '24/7', label: 'Accessible partout' },
  ],
  finalTitle: 'Prêt à reprendre le contrôle ?',
  finalSubtitle: 'Créez votre espace en quelques secondes. Aucune carte bancaire requise.',
  footerText: 'Relyka — Prévisions · Budget · Sérénité.',
  footerLinks: [
    { label: 'Confidentialité', anchor: 'confidentialite' },
    { label: 'Mentions légales', anchor: 'legal' },
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
      const { error } = await supabase.from('app_config').update({ landing: config, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return config;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
