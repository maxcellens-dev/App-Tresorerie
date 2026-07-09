/**
 * Limites d'usage par utilisateur (anti-abus) — CÔTÉ CLIENT.
 * Le vrai garde-fou est en base (migration 135, triggers). Ici : message amont convivial + repli.
 *
 * Comptage aligné sur le serveur :
 *  - transactions : par DATE (mois/année de la transaction), occurrences matérialisées exclues ;
 *  - comptes/projets/crédits/conversations IA : compte total de lignes du profil.
 */
import { router } from 'expo-router';
import { appConfirm, appAlert } from './appDialog';

export type UsageEntity = 'transaction' | 'account' | 'project' | 'credit' | 'ai_conversation';

export interface UsageTierLimits {
  transactions_per_month: number;
  transactions_per_year: number;
  accounts: number;
  projects: number;
  credits: number;
  ai_conversations: number;
}
export interface UsageLimitsConfig {
  free: UsageTierLimits;
  premium: UsageTierLimits;
}

export const USAGE_LIMIT_DEFAULTS: UsageLimitsConfig = {
  free: { transactions_per_month: 100, transactions_per_year: 1200, accounts: 20, projects: 10, credits: 20, ai_conversations: 5 },
  premium: { transactions_per_month: 500, transactions_per_year: 6000, accounts: 50, projects: 30, credits: 50, ai_conversations: 20 },
};

/** Champs éditables en admin, dans l'ordre d'affichage, avec libellé. */
export const USAGE_LIMIT_FIELDS: { key: keyof UsageTierLimits; label: string }[] = [
  { key: 'transactions_per_month', label: 'Transactions / mois' },
  { key: 'transactions_per_year', label: 'Transactions / an' },
  { key: 'accounts', label: 'Comptes' },
  { key: 'projects', label: 'Projets' },
  { key: 'credits', label: 'Crédits' },
  { key: 'ai_conversations', label: 'Conversations IA' },
];

export const PLAN_ROUTE = '/(tabs)/(secondary)/premium';

/** Fusionne la config admin (partielle) avec les défauts. */
export function resolveUsageLimits(admin?: Partial<UsageLimitsConfig> | null): UsageLimitsConfig {
  return {
    free: { ...USAGE_LIMIT_DEFAULTS.free, ...(admin?.free ?? {}) },
    premium: { ...USAGE_LIMIT_DEFAULTS.premium, ...(admin?.premium ?? {}) },
  };
}

/**
 * Affiche le message de limite atteinte. Pour un utilisateur gratuit : propose de passer Premium
 * (redirige vers la page Plan). En Premium (déjà au plafond) : informe qu'il faut faire de la place.
 * Les conversations IA ont une formulation dédiée (« supprime d'anciennes conversations »).
 */
export async function showUsageLimitDialog(opts: {
  entity: UsageEntity;
  isPremium: boolean;
  limit: number;
  /** Pour les transactions : 'month' | 'year' (sinon ignoré). */
  scope?: 'month' | 'year';
}): Promise<void> {
  const { entity, isPremium, limit, scope } = opts;

  const reach = (() => {
    switch (entity) {
      case 'transaction':
        return scope === 'year'
          ? `Tu as atteint la limite de ${limit} transactions pour cette année`
          : `Tu as atteint la limite de ${limit} transactions ce mois-ci`;
      case 'account': return `Tu as atteint la limite de ${limit} comptes`;
      case 'project': return `Tu as atteint la limite de ${limit} projets`;
      case 'credit': return `Tu as atteint la limite de ${limit} crédits`;
      case 'ai_conversation': return `Tu as atteint la limite de ${limit} conversations`;
    }
  })();

  // Conversations IA : on peut toujours faire de la place en supprimant d'anciennes conversations.
  if (entity === 'ai_conversation') {
    if (isPremium) {
      await appAlert({ title: 'Limite atteinte', message: `${reach}. Supprime d'anciennes conversations pour en créer une nouvelle.` });
      return;
    }
    const go = await appConfirm({
      title: 'Limite atteinte',
      message: `${reach}. Passe Premium pour en avoir davantage, ou supprime d'anciennes conversations.`,
      confirmText: 'Voir Premium', cancelText: 'Fermer',
    });
    if (go) router.push(PLAN_ROUTE as any);
    return;
  }

  if (isPremium) {
    await appAlert({ title: 'Limite atteinte', message: `${reach}. Supprime des éléments existants pour en ajouter de nouveaux.` });
    return;
  }
  const go = await appConfirm({
    title: 'Limite atteinte',
    message: `${reach}. Passe Premium pour aller plus loin.`,
    confirmText: 'Voir Premium', cancelText: 'Fermer',
  });
  if (go) router.push(PLAN_ROUTE as any);
}

// ── Backstop global : traduire une erreur serveur USAGE_LIMIT_* en message convivial ────────────
// Le statut premium n'est pas disponible dans le handler global de react-query → on le tient à jour
// via un petit cache module alimenté par usePlan (setCachedIsPremium dans app/_layout).
let cachedIsPremium = false;
export function setCachedIsPremium(v: boolean) { cachedIsPremium = v; }
export function getCachedIsPremium() { return cachedIsPremium; }

/** Reconnaît une erreur de limite serveur (message « USAGE_LIMIT_… (cnt/lim) ») et l'analyse. */
export function parseUsageLimitError(error: unknown): { entity: UsageEntity; scope?: 'month' | 'year'; limit: number } | null {
  const msg = (error as any)?.message ?? (typeof error === 'string' ? error : '');
  if (typeof msg !== 'string' || !msg.includes('USAGE_LIMIT_')) return null;
  const m = msg.match(/\/\s*(\d+)\s*\)/); // « (cnt/lim) » → lim
  const limit = m ? parseInt(m[1], 10) : 0;
  if (msg.includes('TRANSACTIONS_MONTH')) return { entity: 'transaction', scope: 'month', limit };
  if (msg.includes('TRANSACTIONS_YEAR')) return { entity: 'transaction', scope: 'year', limit };
  if (msg.includes('ACCOUNTS')) return { entity: 'account', limit };
  if (msg.includes('PROJECTS')) return { entity: 'project', limit };
  if (msg.includes('CREDITS')) return { entity: 'credit', limit };
  if (msg.includes('AI_CONVERSATIONS')) return { entity: 'ai_conversation', limit };
  return null;
}

/**
 * Si `error` est une limite serveur, affiche le message convivial et renvoie true (erreur « gérée »).
 * Sinon renvoie false (laisser la gestion d'erreur habituelle faire son travail).
 */
export async function handleUsageLimitError(error: unknown, isPremium = getCachedIsPremium()): Promise<boolean> {
  const parsed = parseUsageLimitError(error);
  if (!parsed) return false;
  await showUsageLimitDialog({ entity: parsed.entity, isPremium, limit: parsed.limit, scope: parsed.scope });
  return true;
}

/** Bornes ISO (début/fin) du mois d'une date 'YYYY-MM-DD'. */
export function monthBounds(dateISO: string): { start: string; end: string } {
  const [y, m] = dateISO.slice(0, 7).split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { start, end };
}
/** Bornes ISO de l'année d'une date 'YYYY-MM-DD'. */
export function yearBounds(dateISO: string): { start: string; end: string } {
  const y = dateISO.slice(0, 4);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}
