/**
 * usePilotageData — ACCÈS AUX DONNÉES du tableau de bord : requêtes Supabase, cache react-query,
 * préchargement. Le CALCUL, lui, vit dans `lib/pilotageEngine` : séparés, il devient testable sans
 * réseau ni module natif (cf. docs/PLAN_REFACTOR_TESTS.md).
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { type RatesMap } from '../../lib/finance/currency';
import { fetchSharedContribution, buildSharedContribution } from '../data/useSharedContribution';
import { buildCreditPilotTxs } from '../data/useCreditFlows';
import { computePilotageData, type PilotageInput, type TransactionWithCategory } from '../../lib/finance/pilotageEngine';
import { isoDay } from '../../lib/dateUtils';
import type { Account, Project, Profile } from '../../types/database';

/* Réexports : le moteur est la source de vérité de ces types, mais une vingtaine de fichiers les
   importent historiquement depuis ce hook. On ne casse pas ces chemins pour un déplacement interne. */
export type { PilotageData, TransactionWithCategory, ExpectedIncome, PilotageInput } from '../../lib/finance/pilotageEngine';
export { computePilotageData } from '../../lib/finance/pilotageEngine';

// Fetch multiple data types
/** Les lignes BRUTES dont le moteur a besoin, quelle que soit la façon dont on les a obtenues. */
interface PilotageRaw {
  profile: any | null;
  accounts: any[];
  transactions: any[];
  projects: any[];
  questionnaire: any | null;
  rates: { code: string; rate: number }[];
  overrides: { transaction_id: string; year: number; month: number; override_amount: number | null }[];
  credits: any[];
  creditEvents: any[];
  closures: any[];
  shared: Awaited<ReturnType<typeof fetchSharedContribution>>;
}

/**
 * Le RPC `pilotage_snapshot` n'est pas déployé sur cette base : on n'y retourne pas de la session.
 *
 * Une OTA arrive instantanément, une migration non — il existe donc une fenêtre pendant laquelle ce
 * code tourne devant une base qui ne connaît pas encore la fonction. Sans ce drapeau, chaque refetch
 * du tableau de bord paierait un aller-retour perdu avant de se replier : on aurait RALENTI l'app en
 * cherchant à l'accélérer.
 */
let snapshotUnavailable = false;

/** Clés que `pilotage_snapshot` DOIT renvoyer (cf. migration 174) — vérifiées à chaque réponse. */
const SNAPSHOT_KEYS = [
  'profile', 'accounts', 'transactions', 'projects', 'questionnaire', 'rates', 'overrides',
  'credits', 'credit_events', 'closures', 'shared_accounts', 'shared_members', 'shared_transactions',
] as const;

/**
 * UN SEUL ALLER-RETOUR pour toutes les entrées du Pilotage (cf. migration 174), ou `null` si le RPC
 * n'est pas disponible — l'appelant se replie alors sur les onze requêtes historiques.
 *
 * ⚠️ Le repli est un FILET, pas un mode de fonctionnement silencieux : il ne doit jamais masquer des
 * données absentes. Un profil vide vaut ici ce que valait `.single()` côté PostgREST — une erreur,
 * pas un tableau de bord reconstruit sur du néant (cf. la règle « lecture en erreur ≠ liste vide »).
 */
async function fetchPilotageSnapshot(profileId: string, histStart: string): Promise<PilotageRaw | null> {
  if (!supabase || snapshotUnavailable) return null;
  const { data, error } = await supabase.rpc('pilotage_snapshot', {
    p_profile: profileId,
    p_hist_start: histStart,
  });
  if (error || !data) {
    /* On ne condamne le raccourci POUR LA SESSION que si la fonction est réellement hors d'atteinte
       — absente, non exposée, ou interdite. Un simple incident réseau passait par ici lui aussi, et
       reléguait alors le tableau de bord sur le chemin historique (plusieurs requêtes) jusqu'au
       prochain redémarrage de l'app, longtemps après le retour de la connexion. Dans ce cas on
       repasse par le repli UNE fois, et le raccourci reste disponible au prochain chargement. */
    const code = (error as any)?.code ?? '';
    const permanent = !error                        // RPC muette : rien à réessayer
      || code === '42883'                           // fonction inexistante
      || code === '42501'                           // droits manquants
      || String(code).startsWith('PGRST');           // non exposée par PostgREST
    if (permanent) snapshotUnavailable = true;
    return null;
  }
  const s = data as any;
  /* FORME ATTENDUE, VÉRIFIÉE. Une clé manquante deviendrait un `[]` par défaut, et le tableau de
     bord se recalculerait tranquillement SANS les crédits, ou SANS les comptes partagés — faux,
     mais crédible. C'est le seul risque sérieux de ce raccourci, alors on le ferme : à la moindre
     clé absente, on considère le RPC inexploitable et on repasse par le chemin historique. */
  const missing = SNAPSHOT_KEYS.filter((k) => !(k in s));
  if (missing.length > 0) {
    snapshotUnavailable = true;
    return null;
  }
  if (!s.profile) throw new Error('Profil introuvable');
  return {
    profile: s.profile,
    accounts: s.accounts ?? [],
    transactions: s.transactions ?? [],
    projects: s.projects ?? [],
    questionnaire: s.questionnaire ?? null,
    rates: s.rates ?? [],
    overrides: s.overrides ?? [],
    credits: s.credits ?? [],
    creditEvents: s.credit_events ?? [],
    closures: s.closures ?? [],
    // La pondération par le % d'impact reste en TypeScript, écrite une seule fois.
    shared: buildSharedContribution(profileId, s.shared_accounts ?? [], s.shared_members ?? [], s.shared_transactions ?? []),
  };
}

/** Chemin HISTORIQUE : onze requêtes en quatre vagues. Conservé comme repli du RPC ci-dessus. */
async function fetchPilotageLegacy(profileId: string, histStart: string): Promise<PilotageRaw> {
  if (!supabase) throw new Error('Not authenticated');
  // PERF (latence) — la contribution des comptes PARTAGÉS ne dépend que du `profileId` : elle était
  // attendue APRÈS la vague ci-dessous, ce qui ajoutait une vague réseau complète (et elle en
  // enchaîne elle-même trois). On la lance ICI, en parallèle, et on l'attend plus bas.
  const sharedPromise = fetchSharedContribution(profileId);
  // Si la vague ci-dessous échoue AVANT qu'on n'attende celle-ci, son rejet serait « non géré »
  // (avertissement bruyant, voire fatal). Ce catch ne fait que le marquer comme observé : l'`await`
  // plus bas rejette toujours, la requête garde donc exactement le même comportement d'erreur.
  sharedPromise.catch(() => {});

  const [profileRes, accountsRes, transactionsRes, projectsRes, qaRes, ratesRes, overridesRes, creditsRes, creditEvtRes, closuresRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profileId).single(),
    supabase.from('accounts').select('*').eq('profile_id', profileId),
    // Jointure catégorie réduite aux champs consommés par le moteur (type/name/is_variable/parent).
    supabase.from('transactions').select('*, account:accounts!account_id(name), category:categories!category_id(id, name, type, is_variable, parent_id)')
      .eq('profile_id', profileId)
      .or(`date.gte.${histStart},is_recurring.eq.true`),
    supabase.from('projects').select('*').eq('profile_id', profileId),
    supabase.from('user_questionnaire_answers').select('*').eq('user_id', profileId).maybeSingle(),
    supabase.from('currency_rates').select('code, rate'),
    supabase.from('transaction_month_overrides').select('transaction_id, year, month, override_amount').eq('profile_id', profileId),
    supabase.from('credits').select('*, category:categories!category_id(id, name, is_variable, parent_id), insurance_category:categories!insurance_category_id(id, name, is_variable, parent_id)').eq('profile_id', profileId),
    supabase.from('credit_events').select('*').eq('profile_id', profileId),
    supabase.from('month_closures').select('month_key, status').eq('profile_id', profileId),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (accountsRes.error) throw accountsRes.error;
  if (transactionsRes.error) throw transactionsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (qaRes.error) throw qaRes.error;

  return {
    profile: profileRes.data ?? null,
    accounts: accountsRes.data ?? [],
    transactions: transactionsRes.data ?? [],
    projects: projectsRes.data ?? [],
    questionnaire: qaRes.data ?? null,
    // Taux : non bloquant (si erreur → EUR seul ; la conversion laissera les montants tels quels).
    rates: (ratesRes.data ?? []) as { code: string; rate: number }[],
    overrides: (overridesRes.data ?? []) as PilotageRaw['overrides'],
    credits: creditsRes.data ?? [],
    creditEvents: creditEvtRes.data ?? [],
    closures: closuresRes.data ?? [],
    shared: await sharedPromise,
  };
}

async function fetchPilotageData(profileId: string): Promise<{
  profile: Profile | null;
  sharedFactor: Record<string, number>;
  sharedModeById: Record<string, string | null>;
  estimatedMonths: Set<string>;
  accounts: Account[];
  transactions: TransactionWithCategory[];
  questionnaireAnswers: any | null;
  projects: Project[];
  monthOverrides: { transaction_id: string; year: number; month: number; override_amount: number | null }[];
  rates: RatesMap;
}> {
  if (!supabase || !profileId) throw new Error('Not authenticated');

  // FENÊTRAGE des transactions : le moteur Pilotage ne regarde JAMAIS plus de 6 mois en arrière
  // (revenu inféré 4 mois, revenu moyen 6 mois, net 3 mois, tendance/enveloppe variables 3-6 mois) ;
  // le reste = mois courant + FUTUR + modèles récurrents. On borne donc le fetch à 8 mois glissants
  // (marge) + toutes les récurrentes (quelle que soit leur date de départ) : un compte avec des
  // années d'historique ne re-télécharge plus TOUT à chaque ouverture / après chaque saisie.
  // (Le « 1ᵉʳ mois utilisateur » de computeAvgMonthlyIncome est sécurisé par profiles.created_at.)
  const nowD = new Date();
  const histStart = isoDay(new Date(nowD.getFullYear(), nowD.getMonth() - 7, 1));

  // UN aller-retour (migration 174) au lieu de onze en quatre vagues. Repli automatique sur le
  // chemin historique tant que la migration n'est pas déployée — une OTA arrive avant elle.
  const raw = (await fetchPilotageSnapshot(profileId, histStart)) ?? (await fetchPilotageLegacy(profileId, histStart));

  const rates: RatesMap = { EUR: 1 };
  for (const r of raw.rates) rates[r.code] = Number(r.rate);

  // #5 — Comptes partagés/joints : PONDÉRÉS au % d'impact (au lieu d'être exclus). On prend les données
  // PERSO (hors comptes partagés) + la contribution des comptes partagés (toutes les tx de tous les
  // participants), soldes & montants ×facteur. Plus de doublon : on retire les comptes partagés du perso.
  const allAccounts = raw.accounts as Account[];
  const shared = raw.shared;
  const sharedIdSet = new Set(Object.keys(shared.factorByAccount));
  const persoAccounts = allAccounts.filter((a) => !sharedIdSet.has(a.id) && !(a as any).is_joint);
  // Échéances de crédit MATÉRIALISÉES (credit_kind, migration 143) : exclues du Pilotage — la charge
  // crédit y est représentée par les récurrentes synthétiques (creditPilotTx) qui couvrent TOUS les
  // mois (passés + futurs) ; garder les deux compterait chaque mensualité deux fois.
  const persoTransactions = raw.transactions.filter((t: any) => !sharedIdSet.has(t.account_id) && !t.credit_kind);

  // Crédit (Pilotage) — mensualités en récurrentes synthétiques (remboursement + assurance, catégorisées,
  // pondérées par le % d'impact du compte si partagé). Cohérent avec tréso/projection.
  const acctById: Record<string, any> = {};
  [...persoAccounts, ...shared.accounts].forEach((a: any) => { acctById[a.id] = a; });
  const evtByCredit: Record<string, any[]> = {};
  for (const e of raw.creditEvents as any[]) (evtByCredit[e.credit_id] ??= []).push(e);
  const creditPilotTx = (raw.credits as any[])
    .flatMap((c) => buildCreditPilotTxs(c as any, evtByCredit[c.id], acctById[c.account_id]));

  // Mois `estimated` (non confirmés) → exclus des baselines (moyennes variables, revenu moyen, σ).
  const estimatedMonths = new Set(
    (raw.closures as any[]).filter((c) => c.status === 'estimated').map((c) => c.month_key as string),
  );

  return {
    profile: (raw.profile as Profile) || null,
    sharedFactor: shared.factorByAccount,
    sharedModeById: shared.modeByAccount,
    estimatedMonths,
    accounts: [...persoAccounts, ...shared.accounts],
    transactions: [
      ...persoTransactions.map((t: any) => ({ ...t, amount: Number(t.amount), account: t.account, category: t.category })),
      // Même exclusion côté comptes partagés (les synthétiques crédit sont déjà pondérées par le % d'impact).
      ...shared.transactions.filter((t: any) => !t.credit_kind),
      ...creditPilotTx,
    ] as TransactionWithCategory[],
    projects: raw.projects.map((p: any) => ({
      ...p,
      target_amount: Number(p.target_amount),
      monthly_allocation: Number(p.monthly_allocation),
    })) as Project[],
    questionnaireAnswers: raw.questionnaire,
    monthOverrides: raw.overrides,
    rates,
  };
}



const PILOTAGE_STALE_MS = 45 * 1000;

/** Clé + fetcher partagés entre le hook et le préchargement (une seule source de vérité). */
const pilotageQueryOptions = (profileId: string) => ({
  queryKey: ['pilotage_data', profileId],
  queryFn: async () => computePilotageData(await fetchPilotageData(profileId)),
  staleTime: PILOTAGE_STALE_MS,
});

/**
 * Précharge les données de Pilotage AU PLUS TÔT (dès que l'utilisateur est connu), en parallèle du
 * profil — au lieu d'attendre la redirection vers l'écran d'accueil. Écrit dans la MÊME clé de cache
 * que `usePilotageData` → quand Pilotage monte, les données sont déjà là (ou en vol), pas de 2ᵉ
 * aller-retour en cascade. Sans effet si déjà frais. Les erreurs sont avalées (le hook réessaiera).
 */
export function prefetchPilotageData(qc: QueryClient, profileId: string | undefined): void {
  if (!supabase || !profileId) return;
  qc.prefetchQuery(pilotageQueryOptions(profileId)).catch(() => {});
}

export function usePilotageData(profileId: string | undefined) {
  return useQuery({
    ...pilotageQueryOptions(profileId ?? ''),
    enabled: !!profileId,
    // PERF : ce fetch est LOURD (toutes les transactions + jointures + partagés + crédits).
    // 45 s de fraîcheur → changer d'onglet ne re-télécharge pas tout ; les MUTATIONS (ajout/édition
    // de transaction, virement, régul…) invalident déjà cette clé → les données restent justes.
    // Hors-ligne : la requête se met en PAUSE (onlineManager/NetInfo) et REPREND à la reconnexion.
  });
}
