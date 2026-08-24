/**
 * QUI DÉCIDE DE LA RÉPARTITION DU RELYKA : le profil, ou l'utilisateur ?
 * ─────────────────────────────────────────────────────────────────────
 *
 * Par défaut, c'est le PROFIL FINANCIER (P0–P9) qui pose les quatre pourcentages — il se déduit des
 * données réelles, il suit la situation, il n'a rien à demander. Mais certains savent exactement ce
 * qu'ils veulent faire de leur surplus, et l'app n'avait aucune façon de l'entendre.
 *
 * Le mode MANUEL répond à ça, et à ça seulement : les pourcentages de l'utilisateur remplacent la
 * table du palier. C'est un profil sur mesure, pas un mode « sans garde-fou ». Tout ce qui vient
 * après continue de s'appliquer à l'identique :
 *
 *     répartition de base  →  bornes de la PRIORITÉ du mois  →  modificateurs contextuels
 *                          →  normalisation à 100 %  →  seuils d'affichage  →  garde-fou projection
 *
 * ── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────────────────────────
 * Quatre endroits doivent répondre à la même question (« quelle répartition s'applique ? ») : le
 * moteur de recommandations, l'écran du profil financier, la fenêtre de changement de profil et la
 * modale de réglage. Quatre lectures du même enregistrement, c'est quatre occasions de diverger —
 * et un écran qui annonce 45 % pendant qu'un autre applique 30 % est exactement ce que ce réglage
 * est censé éviter. La question se pose donc ICI, une fois.
 *
 * ── LA RÈGLE DE VALIDITÉ ────────────────────────────────────────────────────────────────────────
 * Une répartition manuelle n'est retenue que si les quatre valeurs sont des nombres ET qu'elles
 * totalisent 100. Sinon on retombe sur le profil — jamais sur une répartition à moitié écrite, qui
 * conduirait à recommander des montants sans rapport avec le Relyka. C'est la même exigence que
 * celle qui existait déjà pour les préférences d'allocation historiques (`applyUserAllocationPreferences`).
 */
import type { Allocation, RecoKey } from './financialPriorities';

export type RecoMode = 'auto' | 'manual';

/** Les quatre postes, dans l'ordre où ils sont présentés partout dans l'app. */
export const RECO_KEYS: RecoKey[] = ['save', 'invest', 'enjoy', 'keep'];

/** Libellés utilisateur des quatre postes — une seule orthographe pour toute l'app. */
export const RECO_KEY_LABEL: Record<RecoKey, string> = {
  save: 'Épargner',
  invest: 'Investir',
  enjoy: 'Confort',
  keep: 'Conserver',
};

/** La ligne `profiles`, vue par ce module : seules les colonnes du réglage. */
export interface RecoModeSource {
  reco_mode?: string | null;
  manual_alloc_save_percent?: number | null;
  manual_alloc_invest_percent?: number | null;
  manual_alloc_enjoy_percent?: number | null;
  manual_alloc_keep_percent?: number | null;
}

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * La répartition manuelle ENREGISTRÉE, ou `null` si elle n'est pas exploitable.
 *
 * Indépendante du mode : elle sert aussi à pré-remplir la modale de réglage quand on est encore en
 * automatique, et à montrer « ce que tu avais choisi » à quelqu'un qui est repassé en auto.
 */
export function readManualAllocation(src: RecoModeSource | null | undefined): Allocation | null {
  if (!src) return null;
  const save = finite(src.manual_alloc_save_percent);
  const invest = finite(src.manual_alloc_invest_percent);
  const enjoy = finite(src.manual_alloc_enjoy_percent);
  const keep = finite(src.manual_alloc_keep_percent);
  if (save == null || invest == null || enjoy == null || keep == null) return null;
  if (save + invest + enjoy + keep !== 100) return null;
  return { save, invest, enjoy, keep };
}

export interface ResolvedRecoMode {
  /** Le mode RÉELLEMENT appliqué — jamais 'manual' sans répartition exploitable. */
  mode: RecoMode;
  /** La répartition de base à appliquer en manuel, `null` en automatique. */
  manualAllocation: Allocation | null;
  /** Le mode DEMANDÉ, tel qu'il est enregistré. Diffère de `mode` quand la répartition est invalide. */
  requested: RecoMode;
}

/**
 * Le mode qui s'applique, et la répartition qui va avec.
 *
 * `mode` ne vaut 'manual' que si le réglage le demande ET que la répartition tient debout : c'est
 * ce qui garantit qu'aucun appelant n'a besoin de revérifier quoi que ce soit derrière.
 */
export function resolveRecoMode(src: RecoModeSource | null | undefined): ResolvedRecoMode {
  const requested: RecoMode = src?.reco_mode === 'manual' ? 'manual' : 'auto';
  const manual = requested === 'manual' ? readManualAllocation(src) : null;
  return {
    mode: manual ? 'manual' : 'auto',
    manualAllocation: manual,
    requested,
  };
}

/** Somme des quatre postes — sert à l'écran de réglage (« il te reste X à répartir »). */
export function allocationTotal(a: Allocation): number {
  return a.save + a.invest + a.enjoy + a.keep;
}
