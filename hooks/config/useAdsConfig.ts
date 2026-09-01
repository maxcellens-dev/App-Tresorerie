/**
 * Config des publicités « maison » (app_config.ads), éditable en admin.
 * Une bannière = image OU texte, optionnellement cliquable (url).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';

/**
 * FORMATS d'emplacement — la FORME de la zone, et donc l'image à fournir.
 *
 * Le format était une propriété du POINT D'APPEL (`<AdSlot compact />`) : rien, dans la config, ne
 * disait qu'une bannière posée sur « À côté des actions » serait rendue dans une boîte de 64 pt de
 * haut. L'admin téléversait une image 1400×400 pour un emplacement qui la rognait, et il n'y avait
 * aucun moyen de le savoir avant de regarder l'app. Le format appartient donc à l'EMPLACEMENT.
 */
export const AD_FORMATS = {
  /** Pleine largeur, ratio 3,5 : 1 — le bandeau classique de bas/milieu de page. */
  banner:  { label: 'Bandeau',  ratio: 3.5, ideal: '1400 × 400 px', hint: 'Pleine largeur, ratio 3,5 : 1' },
  /** Hauteur fixe 64 pt, largeur variable — se glisse à côté d'autres éléments. */
  compact: { label: 'Compacte', ratio: 3,   ideal: '600 × 200 px',  hint: 'Hauteur fixe 64 pt, largeur variable (~3 : 1)' },
  /** CARRÉ (1 : 1), largeur plafonnée — pour une carte, pas pour une page qui défile. */
  square:  { label: 'Carrée',   ratio: 1,   ideal: '600 × 600 px',  hint: 'Carré 1 : 1, largeur plafonnée à 260 pt' },
} as const;
export type AdFormat = keyof typeof AD_FORMATS;

/**
 * Emplacements de pub, regroupés par page (`group`) pour une sélection compacte en admin.
 * `label` = description courte de la position dans la page ; `format` = la forme de la zone.
 */
export const AD_PLACEMENTS = [
  { value: 'comptes',            group: 'Comptes',      label: 'Bas de page',                      format: 'banner' },
  { value: 'comptes_actions',    group: 'Comptes',      label: 'À côté des actions',               format: 'compact' },
  { value: 'transactions',       group: 'Transactions', label: 'Bas de page',                      format: 'banner' },
  { value: 'transactions_mois',  group: 'Transactions', label: 'Entre 2 mois',                     format: 'banner' },
  { value: 'pilotage',           group: 'Pilotage',     label: 'Bas de page',                      format: 'banner' },
  { value: 'pilotage_suivi',     group: 'Pilotage',     label: 'Avant « Suivi du mois »',          format: 'banner' },
  { value: 'projets',            group: 'Projets',      label: 'Bas de page',                      format: 'banner' },
  { value: 'projets_perso',      group: 'Projets',      label: 'Avant « Projets personnels »',     format: 'banner' },
  { value: 'projection',         group: 'Projection',   label: 'Bas de page',                      format: 'banner' },
  { value: 'projection_mois',    group: 'Projection',   label: 'Entre 2 mois',                     format: 'banner' },
  { value: 'projection_invest',  group: 'Projection',   label: 'Avant « Détail année par année »', format: 'banner' },
  /* La carte de confirmation de saisie (« C'est enregistré ») : le seul emplacement CARRÉ. C'est une
     carte étroite et flottante, pas une page qui défile — un bandeau 3,5 : 1 y serait un filet. */
  { value: 'saisie_confirmation', group: 'Saisie',      label: 'Fin de « C’est enregistré »',      format: 'square' },
] as const;
export type AdPlacement = typeof AD_PLACEMENTS[number]['value'];

/** Format d'un emplacement. Repli `banner` : un emplacement inconnu ne doit pas casser le rendu. */
export function placementFormat(placement: string): AdFormat {
  return (AD_PLACEMENTS.find((p) => p.value === placement)?.format as AdFormat) ?? 'banner';
}

/** Libellé lisible d'un emplacement : « Pilotage · Bas de page ». Sinon la valeur brute. */
export function placementLabel(placement: string): string {
  const p = AD_PLACEMENTS.find((x) => x.value === placement);
  return p ? `${p.group} · ${p.label}` : placement;
}

/**
 * Destinations INTERNES d'une bannière (au clic, on reste dans l'app).
 *  - « Pages » : ouvre simplement l'écran.
 *  - « Actions » : ouvre l'écran ET y déclenche un bouton (`action`, transmis en paramètre
 *    `adAction` et lu par l'écran cible — ex. Projets → modal « Quel type de projet ? »).
 * Une action ajoute aussi un jeton `adNonce` : sans lui, re-cliquer la même bannière alors qu'on
 * est déjà sur la page ne changerait aucun paramètre → l'écran ne rejouerait pas l'action.
 */
export const AD_LINK_TARGETS = [
  // ── Pages ──
  { value: 'comptes',          group: 'Pages',   label: 'Comptes',           route: '/(tabs)/comptes' },
  { value: 'transactions',     group: 'Pages',   label: 'Transactions',      route: '/(tabs)/transactions' },
  { value: 'pilotage',         group: 'Pages',   label: 'Pilotage',          route: '/(tabs)/pilotage' },
  { value: 'projets',          group: 'Pages',   label: 'Projets',           route: '/(tabs)/projects' },
  { value: 'projection',       group: 'Pages',   label: 'Projection',        route: '/(tabs)/projection' },
  { value: 'tresorerie',       group: 'Pages',   label: 'Trésorerie',        route: '/(tabs)/tresorerie' },
  { value: 'reporting',        group: 'Pages',   label: 'Reporting',         route: '/(tabs)/reporting' },
  { value: 'conseils_ia',      group: 'Pages',   label: 'Conseils IA',       route: '/(tabs)/conseils-ia' },
  { value: 'apparence',        group: 'Pages',   label: 'Apparence',         route: '/(tabs)/(secondary)/apparence' },
  { value: 'boutique',         group: 'Pages',   label: 'Boutique',          route: '/(tabs)/(secondary)/boutique' },
  { value: 'succes',           group: 'Pages',   label: 'Succès',            route: '/(tabs)/(secondary)/succes' },
  { value: 'plan',             group: 'Pages',   label: 'Plan',              route: '/(tabs)/(secondary)/premium' },
  { value: 'parametres',       group: 'Pages',   label: 'Paramètres',        route: '/(tabs)/(secondary)/parametres' },
  { value: 'profil_financier', group: 'Pages',   label: 'Profil financier',  route: '/(tabs)/(secondary)/profil-financier' },
  { value: 'support',          group: 'Pages',   label: 'Support',           route: '/(tabs)/(secondary)/support' },
  { value: 'profil',           group: 'Pages',   label: 'Mon profil',        route: '/(tabs)/(secondary)/profile' },
  // ── Actions (ouvrent la page + déclenchent le bouton) ──
  { value: 'projets_new',        group: 'Actions', label: 'Projets › + Projet',            route: '/(tabs)/projects',   action: 'new' },
  { value: 'comptes_new',        group: 'Actions', label: 'Comptes › Créer Compte',        route: '/(tabs)/comptes',    action: 'new-account' },
  { value: 'comptes_credits',    group: 'Actions', label: 'Comptes › onglet Crédits',      route: '/(tabs)/comptes',    action: 'credits' },
  { value: 'comptes_credit_new', group: 'Actions', label: 'Comptes › Ajouter un crédit',   route: '/(tabs)/comptes',    action: 'credit-new' },
  { value: 'projection_treso',   group: 'Actions', label: 'Projection › Trésorerie',       route: '/(tabs)/projection', action: 'treso' },
  { value: 'projection_invest',  group: 'Actions', label: 'Projection › Invest.',          route: '/(tabs)/projection', action: 'invest' },
  { value: 'projection_epargne', group: 'Actions', label: 'Projection › Épargne',          route: '/(tabs)/projection', action: 'epargne' },
] as const;
export type AdLinkTarget = typeof AD_LINK_TARGETS[number]['value'];

/** Route complète (avec l'action éventuelle) d'une destination interne. `null` si cible inconnue. */
export function adTargetHref(target: string | undefined): string | null {
  const t = AD_LINK_TARGETS.find((x) => x.value === target);
  if (!t) return null;
  const action = (t as { action?: string }).action;
  return action ? `${t.route}?adAction=${action}&adNonce=${Date.now()}` : t.route;
}

export interface AdBanner {
  id: string;
  label?: string;   // titre interne
  text?: string;    // texte affiché (si pas d'image)
  image?: string;   // URL image bannière
  url?: string;     // lien EXTERNE au clic (optionnel)
  /** Nature du lien au clic. Absent = externe (rétrocompat : les bannières existantes ont une `url`). */
  link_type?: 'external' | 'internal';
  /** Destination IN-APP au clic (si link_type = 'internal'). */
  target?: AdLinkTarget;
  /** Pages où afficher la bannière (une même bannière peut viser plusieurs pages). */
  placements?: AdPlacement[];
  /** @deprecated Ancien champ mono-page — conservé pour rétrocompat (lu via bannerPlacements). */
  placement?: AdPlacement;
  /** Bannière masquée (retrait temporaire sans suppression). */
  hidden?: boolean;
}

/** Lien effectif d'une bannière : interne (route in-app), externe (URL), ou aucun. */
export function bannerLink(b: AdBanner): { kind: 'internal'; href: string } | { kind: 'external'; href: string } | null {
  if (b.link_type === 'internal') {
    const href = adTargetHref(b.target);
    return href ? { kind: 'internal', href } : null;
  }
  return b.url ? { kind: 'external', href: b.url } : null;
}

/** Pages ciblées par une bannière (gère la rétrocompat mono-page → liste). */
export function bannerPlacements(b: AdBanner): AdPlacement[] {
  if (b.placements && b.placements.length > 0) return b.placements;
  return [b.placement ?? 'pilotage'];
}
export interface AdsConfig {
  banners: AdBanner[];
  /** Durée d'affichage (secondes) avant le fondu vers la bannière suivante d'un même emplacement. */
  rotation_seconds?: number;
  /** Opacité globale des bannières (0–100 %, défaut 100). Gérée en admin. */
  opacity?: number;
  /** Masque TOUTES les bannières (retrait temporaire global sans suppression). */
  disabled?: boolean;
}

const KEY = 'ads_config';

export function useAdsConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<AdsConfig> => {
      if (!supabase) return { banners: [] };
      /* ⚠️ Cette lecture ALIMENTE un formulaire que l'écran d'administration réécrit ENSUITE EN
         ENTIER. Son erreur était ignorée : sur une coupure, le formulaire s'ouvrait garni des
         valeurs par défaut, et « Enregistrer » écrasait la vraie configuration avec elles. On lève
         — l'écran sait alors qu'il ne sait pas (`isError`) et refuse d'enregistrer. */
      const { data, error } = await supabase.from('app_config').select('ads').eq('id', 'default').maybeSingle();
      if (error) throw error;
      const ads = (data as any)?.ads as AdsConfig | undefined;
      return { banners: ads?.banners ?? [], rotation_seconds: ads?.rotation_seconds ?? 6, opacity: ads?.opacity ?? 100, disabled: ads?.disabled ?? false };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveAdsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: AdsConfig) => {
      if (!supabase) throw new Error('Supabase non configuré');
      const { error } = await supabase.from('app_config').update({ ads: config, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return config;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
