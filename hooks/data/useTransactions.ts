import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { Account, Transaction, TransactionWithDetails, RecurrenceRule } from '../../types/database';
import { appChoice, appPrompt } from '../../lib/ui/appDialog';
import { convertAmount, currencySymbolFor } from '../../lib/finance/currency';
import { formatDateFrench } from '../../lib/dateUtils';
import { buildProjectTransactions, projectMode } from '../../lib/finance/projectTx';
import { isRegul } from '../../lib/finance/regul';
import { emitPulseOp } from '../../lib/pulse/pulseBus';
import { consumesVariableEnvelope } from '../../lib/pulse/pulseDelta';
import { applyOpToPilotage, type PilotageBalances } from '../../lib/finance/pilotagePatch';
import { recomputeReliabilityCalibration } from '../../lib/finance/reliabilityCalib';

const KEY = 'transactions';

/**
 * Plafond des listes de transactions. Exporté parce qu'un consommateur doit pouvoir savoir si son
 * jeu de données est TRONQUÉ : au-delà de cette limite, l'absence d'une opération ancienne ne veut
 * pas dire qu'elle n'existe pas (cf. la courbe de solde, qui refuse de remonter au-delà du connu).
 */
export const TX_FETCH_LIMIT = 500;

/** Date du jour (locale) au format YYYY-MM-DD. */
function localTodayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * Contribution d'une transaction au solde « à date » du compte.
 * - Un brouillon ne compte jamais.
 * - Toute transaction (récurrente OU non) datée dans le futur ne compte pas encore
 *   (l'argent n'est pas encore sorti/entré → ne doit pas modifier le solde du jour).
 *   Pour un modèle récurrent, seule sa PREMIÈRE échéance (sa date) est considérée ici ;
 *   les occurrences échues sont portées au solde par la matérialisation (migration 030/057),
 *   qui s'appuie sur le drapeau `posted` pour savoir si la base a déjà été comptée.
 */
function balanceContribution(opts: { amount: number; date: string; is_draft?: boolean | null; is_recurring?: boolean | null }): number {
  if (opts.is_draft) return 0;
  if (opts.date > localTodayISO()) return 0;
  return Number(opts.amount);
}

/*
 * §P12 — L'impact « effectif » d'une transaction sur le solde (neutralisé si elle est antérieure à
 * la dernière régularisation du compte) était calculé ICI, par une requête réseau par montant, pour
 * alimenter des ajustements INCRÉMENTAUX du solde. Ces ajustements ont été remplacés par
 * `recomputeBalances()` (recalcul serveur depuis les faits, source de vérité unique) : la règle §P12
 * est appliquée par la fonction SQL. Les requêtes restantes ne servaient donc plus qu'à alimenter
 * des fonctions vides — 2 à 3 allers-retours réseau bloquants sur CHAQUE modification de
 * transaction, pour rien. Supprimées.
 */

/**
 * §P12bis — Détecte une régularisation de solde datée EXACTEMENT du même jour qu'une transaction
 * que l'on est en train de saisir, sur le même compte. Cas ambigu : la transaction est-elle déjà
 * comptée dans le solde régularisé (→ ne pas réimpacter) ou s'agit-il d'une nouvelle opération
 * (→ impacter le solde) ? Renvoie le nom du compte si une régul existe ce jour-là, sinon null.
 */
async function regulOnSameDay(
  accountId: string,
  date: string,
  cachedTxs?: Array<{ account_id: string; date: string; category_id?: string | null; regul_target?: number | null; note?: string | null; account?: { name?: string; currency?: string | null } | null }> | null,
): Promise<{ accountName: string; balance: number | null; currency: string } | null> {
  if (!supabase) return null;
  // CACHE-FIRST : si la liste des transactions est déjà en cache (cas normal — l'écran de saisie
  // la charge), on décide localement, sans aller-retour réseau. Une régul créée à l'instant sur un
  // AUTRE appareil pourrait manquer au cache : cas limite accepté (le prompt n'est qu'une aide de
  // réconciliation, le recalcul du solde reste déterministe).
  // Le solde ACTUEL est nécessaire pour montrer les deux résultats possibles dans le dialogue :
  // c'est cette comparaison qui permet de trancher sans refaire le calcul de tête.
  const accountOf = async (): Promise<{ name: string; balance: number | null; currency: string } | null> => {
    const { data: acc, error: accErr } = await supabase!.from('accounts').select('name, balance, currency').eq('id', accountId).maybeSingle();
    if (accErr) throw accErr;
    if (!acc) return null;
    return { name: (acc as any).name ?? 'ce compte', balance: Number((acc as any).balance), currency: (acc as any).currency || 'EUR' };
  };

  /* ⚠️ CE FILTRE NE RECONNAISSAIT PLUS AUCUNE RÉGULARISATION.
     Il exigeait `category_id == null` — la façon dont on repérait une régul AVANT la migration 175.
     Depuis, toute régul créée par l'app est RANGÉE dans une catégorie (« Régularisation Solde »,
     cf. lib/finance/regul) et porte le marqueur `regul_target`. La condition était donc toujours
     fausse, et la question « Déjà comptée dans ce solde ? » ne se posait plus jamais : quelqu'un
     qui mettait son solde à jour le 15, puis saisissait une dépense oubliée datée du 15, la voyait
     retranchée UNE SECONDE FOIS du solde qu'il venait pourtant de confirmer.
     On réutilise la définition UNIQUE de l'app (`isRegul`, lib/finance/regul) plutôt que d'en
     recopier une variante ici : c'est cette recopie qui avait divergé. */
  if (Array.isArray(cachedTxs)) {
    const hit = cachedTxs.find((t) => t.account_id === accountId && t.date === date && isRegul(t));
    if (!hit) return null;
    const acc = await accountOf();
    return {
      accountName: hit.account?.name ?? acc?.name ?? 'ce compte',
      balance: acc?.balance ?? null,
      currency: hit.account?.currency || acc?.currency || 'EUR',
    };
  }
  const { data, error } = await supabase.from('transactions').select('id')
    .eq('account_id', accountId).eq('date', date)
    .or('regul_target.not.is.null,note.ilike.%gul%,note.eq.Ajustement de solde')
    .limit(1).maybeSingle();
  // Une lecture EN ÉCHEC n'est pas « aucune régul ce jour-là » : on lève plutôt que de laisser
  // passer une opération qui aurait dû poser la question (l'appelant décide quoi en faire).
  if (error) throw error;
  if (!data) return null;
  const acc = await accountOf();
  return {
    accountName: acc?.name ?? 'ce compte',
    balance: acc?.balance ?? null,
    currency: acc?.currency ?? 'EUR',
  };
}

/**
 * Recalcule (côté base) le solde STOCKÉ des comptes touchés via recompute_account_balance().
 * Source de vérité unique du solde → à appeler après TOUTE mutation qui modifie des transactions.
 * Élimine toute dérive : le solde ne dépend plus d'additions/réversions incrémentales.
 */
export async function recomputeBalances(
  accountIds: Array<string | null | undefined>,
  /** Client react-query : les soldes renvoyés par le serveur sont posés dans le cache `accounts`
   *  TOUT DE SUITE (cf. applyBalances). Absent → simple recalcul, comme avant. */
  client?: ReturnType<typeof useQueryClient>,
  profileId?: string,
): Promise<void> {
  if (!supabase) return;
  const today = localTodayISO();
  const ids = [...new Set(accountIds.filter((id): id is string => !!id))];
  // EN PARALLÈLE : chaque recalcul est indépendant (une fonction SQL par compte) — sur un virement,
  // les deux comptes se recalculent dans le même aller-retour au lieu de deux séquentiels.
  const results = await Promise.all(
    ids.map((id) => supabase!.rpc('recompute_account_balance', { p_account: id, p_today: today })),
  );
  /* ⚠️ NE PLUS AVALER L'ÉCHEC. C'est l'écriture la plus importante de l'app — le solde EST le
     produit de cet appel — et son erreur était ignorée : si le RPC échouait (fonction absente,
     droit manquant, réseau), la transaction restait en base et le solde gardait son ancienne
     valeur, sans que rien ne le signale. À l'écran, on voyait une régularisation de −450 € posée
     sur un compte dont le solde n'avait pas bougé d'un centime, et il n'existait aucun moyen de
     savoir pourquoi. Un solde faux est le pire de ce que cette application puisse produire : il
     doit échouer bruyamment, pas discrètement. */
  const failed = results.find((r) => (r as any)?.error);
  if (failed) {
    const msg = (failed as any).error?.message ?? 'inconnue';
    throw new Error(`Le solde n'a pas pu être recalculé (${msg}). Ton opération est enregistrée, mais le solde affiché n'est pas à jour.`);
  }
  // Le serveur vient de CALCULER le solde : il le renvoie (migration 173). L'attendre du refetch de
  // `accounts` était un aller-retour de plus, pendant lequel l'écran affichait l'ANCIEN solde comme
  // s'il était définitif. `data` vaut null tant que la migration 173 n'est pas déployée : on ignore
  // alors le patch, et le refetch reprend son rôle — aucun risque d'écrire n'importe quoi.
  if (!client || !profileId) return;
  const next: Record<string, number> = {};
  results.forEach((r, i) => {
    const v = Number((r as any)?.data);
    if (Number.isFinite(v)) next[ids[i]] = v;
  });
  if (Object.keys(next).length > 0) applyBalances(client, profileId, next);
}

/** Pose les soldes fraîchement recalculés dans les DEUX listes de comptes en cache (perso + toutes). */
function applyBalances(
  client: ReturnType<typeof useQueryClient>,
  profileId: string,
  balances: Record<string, number>,
): void {
  const patch = (list: Account[] | undefined) => {
    if (!list) return list;                          // requête jamais chargée : rien à devancer
    let touched = false;
    const out = list.map((a) => {
      const v = balances[a.id];
      if (v === undefined || Number(a.balance) === v) return a;
      touched = true;
      return { ...a, balance: v };
    });
    return touched ? out : list;                     // référence stable si rien ne change
  };
  client.setQueryData<Account[]>(['accounts', profileId], patch);
  client.setQueryData<Account[]>(['accounts', profileId, 'all'], patch);
}

/** Colonnes nécessaires pour réverser proprement l'impact solde avant suppression. */
export const TX_REVERSAL_COLS = 'id, account_id, amount, date, is_draft, is_recurring, note, linked_account_id, transfer_group_id';

interface ReversalRow {
  id: string; account_id: string; amount: number; date: string;
  is_draft: boolean | null; is_recurring: boolean | null;
  note: string | null; linked_account_id: string | null;
  transfer_group_id?: string | null;
}

/**
 * Supprime un lot de transactions EN RÉVERSANT leur impact « à date » sur le solde des
 * comptes (lignes posted uniquement), en incluant la jambe paire d'un virement si elle n'est
 * pas déjà dans le lot. À utiliser partout où l'on supprimait des transactions de PROJET en
 * masse : celles-ci peuvent désormais être validées (posted), et un `delete` brut laissait le
 * solde faux (symptôme « le point bas ne revient pas / ça s'accumule »).
 */
export async function reverseBalanceAndDeleteTransactions(profileId: string, baseRows: ReversalRow[]): Promise<void> {
  if (!supabase || baseRows.length === 0) return;
  const byId = new Map<string, ReversalRow>();
  for (const r of baseRows) byId.set(r.id, r);

  // Inclure la jambe paire éventuelle (même date, montant opposé, sur le compte d'en face)
  // si elle n'a pas déjà été sélectionnée par le filtre projet. Robuste (cf. useDeleteTransaction) :
  // pas de linked_account_id réciproque exigé, pas de maybeSingle() (null silencieux sur ≥2 lignes).
  for (const r of baseRows) {
    let paired: ReversalRow | null = null;
    if (r.transfer_group_id) {
      // Appariement fiable par GROUPE (cross-devises : montants des jambes différents).
      // Erreur LUE : conclure « pas de jambe opposée » sur une lecture ratée reviendrait à annuler
      // la moitié d'un virement seulement.
      const { data: byGroup, error: gErr } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('profile_id', profileId)
        .eq('transfer_group_id', r.transfer_group_id)
        .neq('id', r.id);
      if (gErr) throw gErr;
      paired = ((byGroup ?? []) as ReversalRow[]).find((c) => !byId.has(c.id)) ?? null;
    } else if (r.linked_account_id) {
      // Anciens virements (sans groupe) : heuristique historique (montant opposé, même date).
      const { data: candidates, error: cErr } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('profile_id', profileId)
        .eq('account_id', r.linked_account_id)
        .eq('date', r.date)
        .eq('amount', -Number(r.amount))
        .is('category_id', null);
      if (cErr) throw cErr;
      const list = (candidates ?? []) as ReversalRow[];
      // Préférer la jambe qui pointe en retour ; sinon la première pas déjà dans le lot.
      paired = list.find((c) => c.linked_account_id === r.account_id && !byId.has(c.id))
        ?? list.find((c) => !byId.has(c.id))
        ?? null;
    }
    if (paired) byId.set(paired.id, paired);
  }

  const affectedAccounts = Array.from(new Set(Array.from(byId.values()).map((r) => r.account_id)));

  await supabase.from('transactions').delete().in('id', Array.from(byId.keys())).eq('profile_id', profileId);

  // Solde = recalcul depuis les faits (anti-dérive) — plus de réversion incrémentale fragile.
  await recomputeBalances(affectedAccounts);
}

export function useTransactions(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<TransactionWithDetails[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          account:accounts!account_id(name, type, currency, profile_id, is_joint),
          category:categories!category_id(name, type),
          linked_account:accounts!linked_account_id(name, type, currency)
        `)
        .eq('profile_id', profileId)
        .order('date', { ascending: false })
        .limit(TX_FETCH_LIMIT);
      if (error) throw error;
      // Vue PERSO : uniquement mes transactions sur MES comptes non joints (mon argent). On exclut donc
      // mes écritures sur un compte partagé reçu (account.profile_id ≠ moi) et sur mes comptes joints.
      return (data ?? [])
        .filter((r: any) => r.account && r.account.profile_id === profileId && !r.account.is_joint)
        .map((r: any) => ({
          ...r,
          amount: Number(r.amount),
          account: r.account ?? null,
          category: r.category ?? null,
          linked_account: r.linked_account ?? null,
        })) as TransactionWithDetails[];
    },
    enabled: !!profileId,
  });

  return query;
}

/**
 * TOUTES les transactions accessibles : mes comptes perso + comptes joints + comptes partagés reçus
 * (y compris les legs créés par d'autres membres sur un compte joint). À n'utiliser QUE sur la page
 * Transactions et le détail d'un compte. Jamais pour des agrégats perso (pilotage/projection).
 */
export function useAllTransactions(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId, 'all'],
    enabled: !!profileId,
    queryFn: async (): Promise<TransactionWithDetails[]> => {
      if (!supabase || !profileId) return [];
      // ⚠️ RLS ≠ filtre de liste : un `select` NU sur accounts renvoyait « mes comptes » pour un
      // utilisateur normal… mais TOUS les comptes de TOUT LE MONDE pour un admin (branche
      // is_app_admin en OR dans la policy) → en « connecté en tant que », la page Transactions
      // affichait les opérations de tous les utilisateurs. On résout donc EXPLICITEMENT les comptes
      // accessibles au profil visité : ses comptes + ceux où il est membre (joints / partagés reçus),
      // même logique que useAllAccounts.
      const [ownRes, memRes] = await Promise.all([
        supabase.from('accounts').select('id').eq('profile_id', profileId),
        supabase.from('account_members').select('account_id').eq('user_id', profileId),
      ]);
      if (ownRes.error) throw ownRes.error;
      const accountIds = [...new Set([
        ...(ownRes.data ?? []).map((a: any) => a.id),
        ...((memRes.data ?? []) as any[]).map((m: any) => m.account_id),
      ])];
      if (accountIds.length === 0) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          account:accounts!account_id(name, type, currency, profile_id, is_joint),
          category:categories!category_id(name, type),
          linked_account:accounts!linked_account_id(name, type, currency)
        `)
        .in('account_id', accountIds)
        .order('date', { ascending: false })
        .limit(TX_FETCH_LIMIT);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        amount: Number(r.amount),
        account: r.account ?? null,
        category: r.category ?? null,
        linked_account: r.linked_account ?? null,
      })) as TransactionWithDetails[];
    },
  });
}

/**
 * PERF (ressenti) — insère la transaction qui vient d'être créée DANS le cache, tout de suite.
 *
 * L'invalidation qui suit déclenche un refetch de 500 lignes jointes (comptes, catégories, compte
 * lié) : tant qu'il n'est pas revenu, la liste montre l'état d'AVANT, et l'utilisateur voit son
 * opération « manquer » pendant tout l'aller-retour. On la pose donc en tête du cache dès que la
 * base a confirmé l'insert — le refetch, quand il arrive, ne fait plus que confirmer ce qui est
 * déjà à l'écran.
 *
 * Les libellés joints (compte, catégorie) sont repris des caches correspondants : ce sont les mêmes
 * données que celles que le serveur renverra. S'ils manquent, la ligne s'affiche sans eux et le
 * refetch les complète — jamais d'écran vide, jamais d'invention.
 */
function seedTransactionCache(client: ReturnType<typeof useQueryClient>, profileId: string, row: any) {
  if (!row?.id) return;
  writeTransactionCache(client, profileId, row.id, enrichTransactionRow(client, profileId, row));
}

/** Reconstitue les libellés joints (compte, catégorie, compte lié) depuis les caches correspondants. */
function enrichTransactionRow(client: ReturnType<typeof useQueryClient>, profileId: string, row: any): TransactionWithDetails {
  /* ⚠️ Le cache `['accounts', profileId]` est la vue PERSO : elle EXCLUT les comptes joints et les
     comptes partagés reçus. Une opération enregistrée sur un compte joint n'y trouvait donc pas son
     compte, la ligne était posée avec `account: null`, et la liste l'affichait sans nom de compte.
     On interroge d'abord la vue COMPLÈTE (celle qu'utilise la page Transactions), la vue perso ne
     servant que de repli si elle n'a pas encore été chargée. */
  const accounts = client.getQueryData<any[]>(['accounts', profileId, 'all'])
    ?? client.getQueryData<any[]>(['accounts', profileId])
    ?? [];
  const categories = client.getQueryData<any[]>(['categories', profileId]) ?? [];
  const acc = accounts.find((a) => a.id === row.account_id);
  const cat = row.category_id ? categories.find((c) => c.id === row.category_id) : null;
  const linked = row.linked_account_id ? accounts.find((a) => a.id === row.linked_account_id) : null;
  return {
    ...row,
    amount: Number(row.amount),
    account: acc ? { name: acc.name, type: acc.type, currency: acc.currency, profile_id: acc.profile_id, is_joint: acc.is_joint } : null,
    category: cat ? { name: cat.name, type: cat.type } : null,
    linked_account: linked ? { name: linked.name, type: linked.type, currency: linked.currency } : null,
  } as TransactionWithDetails;
}

/**
 * Écrit une ligne dans les DEUX listes de transactions déjà en cache (« toutes » et « perso »).
 * `next === null` → suppression. Sinon insertion OU remplacement, en gardant le tri par date
 * décroissante (une opération antidatée ne doit pas apparaître en tête avant de sauter ailleurs).
 *
 * Sert de mise à jour IMMÉDIATE : l'invalidation qui suit déclenche un refetch de 500 lignes
 * jointes, et tant qu'il n'est pas revenu la liste montrerait l'état d'AVANT (montant/date/ligne
 * supprimée encore visibles). Le refetch ne fait plus que confirmer ce qui est déjà à l'écran.
 */
function writeTransactionCache(
  client: ReturnType<typeof useQueryClient>,
  profileId: string,
  id: string,
  next: TransactionWithDetails | null,
) {
  const apply = (list: TransactionWithDetails[] | undefined) => {
    if (!list) return list;                       // requête jamais chargée : rien à devancer
    const without = list.filter((t) => t.id !== id);
    if (!next) return without.length === list.length ? list : without;
    const at = without.findIndex((t) => String(t.date) < String(next.date));
    const out = without.slice();
    out.splice(at === -1 ? out.length : at, 0, next);
    return out;
  };
  const remove = (list: TransactionWithDetails[] | undefined) => {
    if (!list) return list;
    const without = list.filter((t) => t.id !== id);
    return without.length === list.length ? list : without;
  };

  client.setQueryData<TransactionWithDetails[]>([KEY, profileId, 'all'], apply);

  // Vue PERSO : mêmes conditions d'appartenance que la requête (mes comptes, non joints).
  if (!next) { client.setQueryData<TransactionWithDetails[]>([KEY, profileId], remove); return; }
  const acc = next.account as any;
  // Compte INCONNU du cache (comptes pas encore chargés) : on ne conclut rien. Retirer la ligne
  // « par défaut » la ferait disparaître de la liste perso jusqu'au refetch, alors qu'elle y est
  // parfaitement à sa place — le refetch tranchera. Ne jamais déduire d'une absence d'information.
  if (!acc) return;
  client.setQueryData<TransactionWithDetails[]>(
    [KEY, profileId],
    // Déplacée sur un compte joint/partagé → elle sort de la vue perso.
    acc.profile_id === profileId && !acc.is_joint ? apply : remove,
  );
}

/**
 * PERF (ressenti) — le TABLEAU DE BORD suit la saisie, sans attendre son refetch.
 *
 * Même intention que `seedTransactionCache` pour la liste, appliquée aux agrégats : `pilotage_data`
 * est le fetch le plus lourd de l'app (onze requêtes + le moteur), et c'est LUI qui porte le Relyka,
 * les soldes et le budget du quotidien. Tant qu'il n'était pas revenu, l'écran affichait les anciens
 * chiffres comme s'ils étaient définitifs, puis ils sautaient. On applique donc l'effet de
 * l'opération au cache tout de suite, par la même arithmétique que la carte de confirmation
 * (cf. lib/pilotagePatch) ; l'invalidation qui suit ne fait plus que confirmer.
 *
 * `signedAmount` est le montant porté sur le compte — négatif pour une suppression de recette, etc.
 */
function patchPilotageCache(
  client: ReturnType<typeof useQueryClient>,
  profileId: string,
  op: {
    accountId: string;
    /** Montant SIGNÉ de la transaction elle-même (négatif = dépense). */
    amount: number;
    /** `1` à la création, `-1` à la suppression (on applique alors l'effet inverse). */
    direction: 1 | -1;
    date: string;
    categoryId?: string | null;
    isRecurring?: boolean | null;
    projectId?: string | null;
    regulCovered?: boolean;
    /** Compte d'en face si c'est une JAMBE DE VIREMENT — elle n'entame pas l'enveloppe variable. */
    linkedAccountId?: string | null;
  },
): void {
  const accounts = client.getQueryData<Account[]>(['accounts', profileId])
    ?? client.getQueryData<Account[]>(['accounts', profileId, 'all']);
  const accountType = accounts?.find((a) => a.id === op.accountId)?.type;
  // Compte INCONNU du cache : on ne devine pas sur quel total imputer le montant (cf. §
  // writeTransactionCache — ne jamais déduire d'une absence d'information). Le refetch tranchera.
  if (!accountType) return;
  const categories = client.getQueryData<Array<{ id: string; type: string }>>(['categories', profileId]);
  const categoryType = op.categoryId ? categories?.find((c) => c.id === op.categoryId)?.type ?? null : null;

  // ⚠️ La NATURE de l'opération se lit sur son propre montant, jamais sur le sens du patch :
  // supprimer une dépense applique `+100` au compte, ce qui la ferait passer pour une recette —
  // et l'enveloppe variable ne serait alors jamais recréditée.
  const hitsVariableEnvelope = consumesVariableEnvelope({
    kind: op.linkedAccountId ? 'transfer' : op.amount < 0 ? 'expense' : 'income',
    accountType,
    isRecurring: op.isRecurring,
    projectId: op.projectId,
    categoryId: op.categoryId,
    categoryType,
    linkedAccountId: op.linkedAccountId,
  });

  client.setQueryData<PilotageBalances>(['pilotage_data', profileId], (data) =>
    applyOpToPilotage(data, {
      amount: op.amount * op.direction,
      accountType,
      date: op.date,
      regulCovered: op.regulCovered,
      hitsVariableEnvelope,
    }, localTodayISO()),
  );
}

/** Applique un jeu de champs modifiés à une ligne DÉJÀ en cache (jambe appariée d'un virement). */
function patchCachedTransaction(
  client: ReturnType<typeof useQueryClient>,
  profileId: string,
  id: string,
  updates: Record<string, unknown>,
) {
  const current = (client.getQueryData<TransactionWithDetails[]>([KEY, profileId, 'all']) ?? [])
    .find((t) => t.id === id)
    ?? (client.getQueryData<TransactionWithDetails[]>([KEY, profileId]) ?? []).find((t) => t.id === id);
  if (!current) return;
  writeTransactionCache(client, profileId, id, enrichTransactionRow(client, profileId, { ...current, ...updates }));
}

export function useAddTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      account_id: string;
      category_id: string | null;
      amount: number;
      date: string;
      note?: string;
      is_forecast?: boolean;
      is_draft?: boolean;
      is_recurring?: boolean;
      recurrence_rule?: RecurrenceRule | null;
      recurrence_end_date?: string | null;
      project_id?: string | null;
      linked_account_id?: string | null;
      /** Identifiant de groupe partagé par les 2 jambes d'un virement (appariement robuste). */
      transfer_group_id?: string | null;
      /** Saisie interactive : si une régul existe le même jour, demander si l'opération y est
       *  déjà incluse (→ ne pas réimpacter le solde) ou si c'est une nouvelle opération. */
      checkRegulConflict?: boolean;
      /**
       * Réponse DÉJÀ donnée à la question « déjà comptée dans ce solde ? ».
       * L'écran de saisie la pose AVANT de rendre la main (cf. useAskRegulCoverage) : la question
       * porte sur l'opération en cours, elle ne peut pas surgir une fois l'utilisateur reparti.
       */
      regulCoveredAnswer?: boolean;
      /** Pour une ligne de régularisation : solde cible saisi (affichage). */
      regul_target?: number | null;
      /**
       * NATURE de la régularisation (migration 223). 'wealth' = mise à jour du solde d'un compte
       * d'épargne / d'investissement : elle ancre le solde comme les autres, mais se compte comme un
       * virement entrant/sortant (hors trésorerie, hors budget). Cf. lib/finance/regul.
       */
      regul_kind?: 'wealth' | null;
      /**
       * Compte d'investissement : NATURE de l'opération (migration 196).
       *  • 'gain' / 'loss' → plus ou moins-value : fait bouger la valeur, jamais l'apport ;
       *  • 'deposit'       → versement : fait bouger les deux.
       * Posé par les boutons dédiés du détail de compte. C'est ce marqueur qui fait foi, et non le
       * libellé — que l'utilisateur peut réécrire, ce qui reclassait l'opération en silence.
       */
      investment_kind?: 'gain' | 'loss' | 'deposit' | null;
      /**
       * Régularisation ÉCRITE PAR LA CLÔTURE : le mois clôturé qui l'a produite (YYYY-MM).
       * C'est la marque que la réouverture de ce mois cherche pour défaire exactement ce que la
       * clôture avait fait — et rien d'autre. Réservé à la clôture (cf. migration 179) : une
       * régularisation saisie à la main n'en porte jamais, et n'est donc jamais effacée.
       */
      closure_month?: string | null;
      /** #4bis — compte joint : opération saisie « au nom de » ce membre (non-user) pour simuler sa participation. */
      on_behalf_member_id?: string | null;
      /** Virement : ne pas recalculer le solde ICI — la 2ᵉ jambe fait UN SEUL recalcul groupé
       *  (`recomputeAccounts`) pour les deux comptes (2 allers-retours économisés par virement). */
      skipBalanceRecompute?: boolean;
      /** Comptes à recalculer À LA PLACE du seul compte de la ligne (recalcul groupé du virement),
       *  DANS la mutation → les invalidations (onSuccess) repartent sur des soldes déjà justes. */
      recomputeAccounts?: string[];
      /** Virement : la 1ʳᵉ jambe n'invalide pas les caches (la 2ᵉ le fait une seule fois). */
      skipInvalidations?: boolean;
      /** Virement : émis par la 2ᵉ jambe dès son INSERT réussi (= virement committé) — la carte
       *  Pouls apparaît sans attendre le recalcul des soldes. */
      pulseTransferOp?: { amount: number; fromAccountId: string; toAccountId: string; isFuture: boolean; date: string } | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const contribution = balanceContribution({ amount: input.amount, date: input.date, is_draft: input.is_draft, is_recurring: input.is_recurring });

      // §P12bis — Cas ambigu : transaction datée LE JOUR d'une régularisation. On demande si elle
      // est DÉJÀ incluse dans ce solde (→ regul_covered = true, le recalcul l'exclut) ou si c'est
      // une NOUVELLE opération postérieure à la régul (→ elle compte). L'absorption « avant la
      // régul » n'a PAS besoin d'être stockée : le recalcul la dérive de la date.
      let regulCovered = input.regulCoveredAnswer ?? false;
      if (input.regulCoveredAnswer === undefined && input.checkRegulConflict && contribution !== 0) {
        const noteLc = (input.note ?? '').toLowerCase();
        const isRegulItself = noteLc.includes('gul') || input.note === 'Ajustement de solde';
        if (!isRegulItself) {
          // CACHE-FIRST : le cas « régul le même jour » se décide depuis les transactions déjà en
          // cache (elles y sont, réguls comprises) → 1 aller-retour réseau économisé par saisie.
          // Repli réseau uniquement si le cache est absent (démarrage à froid).
          const cachedAll = client.getQueryData<TransactionWithDetails[]>([KEY, profileId, 'all']);
          const conflict = await regulOnSameDay(input.account_id, input.date, cachedAll ?? null);
          if (conflict) {
            /* Décision difficile à prendre dans l'abstrait : on montre donc les DEUX SOLDES qui en
               résultent, avec la date. « Déjà incluse » laisse le solde tel quel (l'opération est
               déjà dedans) ; « Nouvelle opération » l'applique. Une carte par option, validée d'un
               seul tap — au lieu de deux boutons qui obligent à refaire le calcul de tête. */
            const bal = conflict.balance;
            // Devise du COMPTE concerné (le solde y est libellé), et non un € codé en dur : ce dialogue
            // sert à comparer deux soldes, un mauvais symbole y rend la comparaison trompeuse.
            const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + currencySymbolFor(conflict.currency);
            const dateLbl = formatDateFrench(input.date);
            const choice = await appChoice({
              title: 'Déjà comptée dans ce solde ?',
              message: `Tu as fait une régularisation le ${dateLbl} sur « ${conflict.accountName} ». Cette opération y était-elle déjà comprise ?`,
              options: [
                {
                  icon: 'checkmark-done',
                  label: 'Oui, déjà incluse',
                  hint: 'Elle apparaît pour l’historique, mais ne rebouge pas le solde.',
                  tone: 'neutral',
                  result: bal != null ? fmt(bal) : undefined,
                  resultHint: `solde inchangé au ${dateLbl}`,
                },
                {
                  icon: 'add-circle',
                  label: 'Non, c’est une nouvelle opération',
                  hint: 'Elle s’ajoute au solde régularisé.',
                  tone: contribution < 0 ? 'danger' : 'accent',
                  result: bal != null ? fmt(bal + contribution) : undefined,
                  resultHint: `nouveau solde au ${dateLbl}`,
                },
              ],
            });
            // Fermeture sans choisir → on ne couvre pas : l'opération compte (comportement d'avant).
            regulCovered = choice === 0;
          }
        }
      }

      const { data, error } = await supabase
        .from('transactions')
        .insert({
          profile_id: profileId,
          account_id: input.account_id,
          category_id: input.category_id || null,
          amount: input.amount,
          date: input.date,
          note: input.note || null,
          is_forecast: input.is_forecast ?? false,
          is_draft: input.is_draft ?? false,
          is_recurring: input.is_recurring ?? false,
          recurrence_rule: input.recurrence_rule ?? null,
          recurrence_end_date: input.recurrence_end_date ?? null,
          project_id: input.project_id ?? null,
          linked_account_id: input.linked_account_id ?? null,
          transfer_group_id: input.transfer_group_id ?? null,
          posted: contribution !== 0,
          regul_covered: regulCovered,
          regul_target: input.regul_target ?? null,
          // Envoyé SEULEMENT s'il est renseigné : la colonne date de la migration 196, et une
          // installation qui ne l'a pas encore appliquée doit continuer d'enregistrer normalement.
          ...(input.investment_kind ? { investment_kind: input.investment_kind } : {}),
          // Idem pour `regul_kind` (migration 223) : absent = régularisation de trésorerie.
          ...(input.regul_kind ? { regul_kind: input.regul_kind } : {}),
          ...(input.closure_month ? { closure_month: input.closure_month } : {}),
          ...(input.on_behalf_member_id ? { on_behalf_member_id: input.on_behalf_member_id } : {}),
        })
        .select()
        .single();
      if (error) throw error;

      // La ligne existe en base : elle doit exister à l'écran MAINTENANT, pas au retour du refetch.
      seedTransactionCache(client, profileId, data);
      // …et le tableau de bord avec elle (Relyka, soldes, budget du quotidien). Un brouillon n'entre
      // dans aucun agrégat : il n'a rien à devancer.
      if (!input.is_draft) {
        patchPilotageCache(client, profileId, {
          accountId: input.account_id,
          amount: Number(input.amount),
          direction: 1,
          date: input.date,
          categoryId: input.category_id || null,
          isRecurring: input.is_recurring ?? false,
          projectId: input.project_id ?? null,
          regulCovered,
          linkedAccountId: input.linked_account_id ?? input.transfer_group_id ?? null,
        });
      }

      // POULS — émis DÈS l'insert réussi (la transaction existe : la confirmation peut apparaître),
      // sans attendre le recalcul des soldes ni les invalidations. On ignore : brouillons, réguls,
      // jambes de virement (la 2ᵉ jambe émet UN événement via pulseTransferOp).
      const isTransferLeg = !!input.transfer_group_id || !!input.linked_account_id;
      const signedAmount = Number(input.amount);
      if (!input.is_draft && !isTransferLeg && signedAmount !== 0 && !isRegul(input)) {
        emitPulseOp({
          kind: signedAmount > 0 ? 'income' : 'expense',
          amount: Math.abs(signedAmount),
          accountId: input.account_id,
          isFuture: input.date > localTodayISO(),
          date: input.date,
          // Contexte nécessaire à l'estimation de fin de mois (cf. lib/pulseDelta) : une opération
          // couverte par la régul du jour ne bouge aucun solde, et une dépense du quotidien est
          // absorbée par l'enveloppe variable.
          regulCovered,
          categoryId: input.category_id || null,
          isRecurring: input.is_recurring ?? false,
          projectId: input.project_id ?? null,
        });
      }
      if (input.pulseTransferOp) {
        // `regulCovered` de CETTE jambe (la 2ᵉ) : l'appariement jambe par jambe n'a pas de sens ici,
        // et le chiffre exact arrive de toute façon au recalcul.
        emitPulseOp({ kind: 'transfer', ...input.pulseTransferOp, regulCovered });
      }

      // Solde = recalcul depuis les faits (source de vérité, anti-dérive) — sauf si l'appelant
      // regroupe le recalcul (virement : un seul recompute pour les deux jambes, sur la 2ᵉ).
      if (!input.skipBalanceRecompute) await recomputeBalances(input.recomputeAccounts ?? [input.account_id], client, profileId);
      // §P30 — Récurrente dont la 1ʳᵉ échéance est PASSÉE : on matérialise tout de suite les occurrences
      // dues (mars→aujourd'hui) au lieu d'attendre le prochain démarrage. Sinon une seule échéance est
      // déduite et l'historique/le solde/le « total dépensé » ignorent les suivantes jusqu'à déco/reco.
      if ((input.is_recurring ?? false) && input.recurrence_rule && input.date <= localTodayISO()) {
        try {
          await supabase.rpc('materialize_due_recurring', { p_profile: profileId, p_today: localTodayISO() });
          await recomputeBalances([input.account_id], client, profileId);
        } catch { /* best effort : le démarrage suivant rattrapera */ }
      }

      // Invalidations ICI (fin de mutationFn) et pas en onSuccess : (1) elles tournent même si
      // l'écran appelant est démonté (navigation optimiste) ; (2) UNE SEULE invalidation par
      // enregistrement → jamais de double refetch de pilotage_data (le fetch le plus lourd).
      // Virement : la 1ʳᵉ jambe saute (skipInvalidations), la 2ᵉ invalide pour les deux.
      if (!input.skipInvalidations) {
        client.invalidateQueries({ queryKey: [KEY, profileId] });
        client.invalidateQueries({ queryKey: ['accounts', profileId] });
        client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      }
      return data;
    },
  });
}

export interface CreateTransferLegsInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number; // montant POSITIF débité de la source (le signe des jambes est géré ici)
  /** Virement CROSS-DEVISES : montant POSITIF réellement crédité sur la destination (devise dest).
   *  Absent ou égal à `amount` → virement mono-devise classique (jambes miroir). */
  amountTo?: number;
  date: string;
  noteFrom?: string | null; // libellé de la jambe de débit (source)
  noteTo?: string | null;   // libellé de la jambe de crédit (destination)
  isDraft?: boolean;
  isRecurring?: boolean;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceEndDate?: string | null;
  /** Rattachement à un PROJET (mode « Mettre de côté ») : posé sur les DEUX jambes, comme le fait
   *  la validation d'un brouillon de projet (useValidateProjectDraft). */
  projectId?: string | null;
  /** Saisie interactive : demander, pour chaque jambe, si l'opération est déjà incluse dans une
   *  régularisation de solde du même jour (cf. addTransaction.checkRegulConflict). */
  checkRegulConflict?: boolean;
  /** Réponse déjà obtenue par l'écran (cf. useAskRegulCoverage). */
  regulCoveredAnswer?: boolean;
  /** #4bis — virement saisi « au nom de » ce membre (non-user) d'un compte joint. */
  onBehalfMemberId?: string | null;
}

/**
 * Crée les 2 jambes d'un virement de façon ATOMIQUE : débit sur la source, crédit sur la
 * destination. Si la 2ᵉ jambe échoue, la 1ʳᵉ est annulée (réversion du solde via
 * useDeleteTransaction) pour ne jamais laisser un virement à une seule jambe.
 *
 * Logique UNIQUE partagée par les deux écrans de saisie (transfer.tsx et transactions/add.tsx)
 * afin d'éviter toute divergence entre les deux chemins.
 */
export async function createTransferLegs(
  add: ReturnType<typeof useAddTransaction>,
  del: ReturnType<typeof useDeleteTransaction>,
  p: CreateTransferLegsInput,
): Promise<void> {
  const num = Math.abs(p.amount);                                   // débité de la source
  const numTo = p.amountTo != null ? Math.abs(p.amountTo) : num;    // crédité sur la destination
  // Identifiant de groupe partagé par les 2 jambes → appariement robuste (édition/suppression),
  // indispensable en cross-devises où les montants des jambes diffèrent (−num ≠ +numTo).
  const groupId = transferUuid();
  const common = {
    is_draft: p.isDraft ?? false,
    is_recurring: p.isRecurring ?? false,
    recurrence_rule: p.isRecurring ? (p.recurrenceRule ?? null) : null,
    recurrence_end_date: p.recurrenceEndDate ?? null,
    transfer_group_id: groupId,
    project_id: p.projectId ?? null,
    // Chaque jambe vérifie sa propre date vs une éventuelle régul sur SON compte.
    checkRegulConflict: p.checkRegulConflict ?? false,
    regulCoveredAnswer: p.regulCoveredAnswer,
    on_behalf_member_id: p.onBehalfMemberId ?? null,
  };
  const firstLeg = await add.mutateAsync({
    account_id: p.fromAccountId,
    category_id: null,
    amount: -num,
    date: p.date,
    note: p.noteFrom ?? 'Virement interne',
    linked_account_id: p.toAccountId,
    ...common,
    // La 1ʳᵉ jambe ne recalcule NI n'invalide rien : la 2ᵉ fait le recalcul GROUPÉ des deux comptes
    // (dans sa mutation, donc avant les invalidations) et déclenche les invalidations uniques.
    skipBalanceRecompute: true,
    skipInvalidations: true,
  });
  const firstLegId = (firstLeg as any)?.id ?? null;
  try {
    await add.mutateAsync({
      account_id: p.toAccountId,
      category_id: null,
      amount: numTo,
      date: p.date,
      note: p.noteTo ?? 'Virement interne',
      linked_account_id: p.fromAccountId,
      ...common,
      recomputeAccounts: [p.fromAccountId, p.toAccountId],
      // POULS — un virement = UN événement, émis par la 2ᵉ jambe DÈS son insert (= committé),
      // sans attendre le recalcul groupé des soldes.
      pulseTransferOp: (p.isDraft ?? false) ? null : {
        amount: num,
        fromAccountId: p.fromAccountId,
        toAccountId: p.toAccountId,
        isFuture: p.date > localTodayISO(),
        date: p.date,
      },
    });
  } catch (legErr) {
    // Rollback : la suppression recalcule elle-même le solde de la source (aucune dérive).
    if (firstLegId) { try { await del.mutateAsync(firstLegId); } catch { /* best-effort */ } }
    throw legErr;
  }
}

/** UUID v4 léger (groupement de jambes — pas un usage cryptographique). */
function transferUuid(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Libère (supprime) tous les brouillons « Conservés » (is_reserved) d'un projet. */
export function useReleaseReservedByProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('profile_id', profileId)
        .eq('project_id', projectId)
        .eq('is_draft', true)
        .eq('is_reserved', true);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
    },
  });
}

export function useUpdateTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      account_id?: string;
      category_id?: string | null;
      amount?: number;
      date?: string;
      note?: string | null;
      is_draft?: boolean;
      is_reserved?: boolean;
      is_recurring?: boolean;
      recurrence_rule?: RecurrenceRule | null;
      recurrence_end_date?: string | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: existing, error: fetchErr } = await supabase.from('transactions').select('account_id, amount, is_draft, is_recurring, linked_account_id, date, note, project_id, transfer_group_id, materialized_from').eq('id', input.id).single();
      if (fetchErr || !existing) throw fetchErr || new Error('Transaction introuvable');
      // Garde anti-doublon : une occurrence MATÉRIALISÉE appartient déjà à une série récurrente
      // (modèle parent = materialized_from). La repasser en récurrente créerait un 2ᵉ modèle qui
      // doublerait le futur → on neutralise toute tentative d'activer la récurrence sur cette ligne.
      if ((existing as { materialized_from?: string | null }).materialized_from) {
        input = { ...input, is_recurring: false, recurrence_rule: null, recurrence_end_date: null };
      }
      const oldAccId = (existing as { account_id: string }).account_id;
      const oldAmount = Number((existing as { amount: number }).amount);
      const wasInDraft = Boolean((existing as { is_draft?: boolean }).is_draft);
      const wasRecurring = Boolean((existing as { is_recurring?: boolean }).is_recurring);
      const isNowDraft = input.is_draft !== undefined ? input.is_draft : wasInDraft;
      const oldLinkedAccId = (existing as { linked_account_id?: string | null }).linked_account_id ?? null;
      const oldGroupId = (existing as { transfer_group_id?: string | null }).transfer_group_id ?? null;
      const oldDate = (existing as { date?: string }).date as string | undefined;
      const oldProjectId = (existing as { project_id?: string | null }).project_id ?? null;

      const updates: Record<string, unknown> = {};
      if (input.account_id !== undefined) updates.account_id = input.account_id;
      if (input.category_id !== undefined) updates.category_id = input.category_id;
      if (input.amount !== undefined) updates.amount = input.amount;
      if (input.date !== undefined) updates.date = input.date;
      if (input.note !== undefined) updates.note = input.note;
      if (input.is_draft !== undefined) updates.is_draft = input.is_draft;
      if (input.is_reserved !== undefined) updates.is_reserved = input.is_reserved;
      if (input.is_recurring !== undefined) updates.is_recurring = input.is_recurring;
      if (input.recurrence_rule !== undefined) updates.recurrence_rule = input.recurrence_rule;
      if (input.recurrence_end_date !== undefined) updates.recurrence_end_date = input.recurrence_end_date;

      // ── Contributions au solde « à date » (avant / après) ──
      // brouillon, date future non récurrente et changement de compte sont gérés par
      // balanceContribution. Couvre tous les cas : montant, date (passé⇄futur),
      // validation d'un brouillon, déplacement de compte.
      const newAccId = (input.account_id !== undefined ? input.account_id : oldAccId) as string;
      const newAmount = input.amount !== undefined ? input.amount : oldAmount;
      const newDate = (input.date !== undefined ? input.date : oldDate) ?? '';
      const newRecurring = input.is_recurring !== undefined ? input.is_recurring : wasRecurring;
      const oldContribution = balanceContribution({ amount: oldAmount, date: oldDate ?? '', is_draft: wasInDraft, is_recurring: wasRecurring });
      const newContribution = balanceContribution({ amount: newAmount, date: newDate, is_draft: isNowDraft, is_recurring: newRecurring });
      updates.posted = newContribution !== 0;
      const oldNote = (existing as any).note as string | null;
      const newNote = input.note !== undefined ? input.note : oldNote;

      const { data, error } = await supabase.from('transactions').update(updates).eq('id', input.id).select().single();
      if (error) throw error;

      // La ligne est modifiée en base : elle doit s'afficher modifiée MAINTENANT, pas au retour du
      // refetch (500 lignes jointes). Sans ça, l'utilisateur revenait sur la liste et y voyait
      // encore l'ancien montant / l'ancienne date pendant tout l'aller-retour.
      seedTransactionCache(client, profileId, data);

      // ── Synchronisation de l'autre jambe d'un virement ──
      // Un virement est composé de deux transactions reliées par linked_account_id.
      // Si on modifie le montant / la date / le libellé d'une jambe, l'autre doit suivre,
      // sinon le couple se désynchronise (et les soldes deviennent faux).
      if (oldLinkedAccId && (input.amount !== undefined || input.date !== undefined || input.note !== undefined || input.is_draft !== undefined)) {
        // Retrouver la jambe opposée de façon robuste (cf. useDeleteTransaction) : même date,
        // montant exactement opposé, sans catégorie, sur le compte d'en face — sans exiger un
        // linked_account_id réciproque parfait (jambes désynchronisées/anciennes), et sans
        // maybeSingle() (qui renvoie null en silence dès qu'il y a ≥2 candidats).
        // Appariement de la jambe opposée : par GROUPE si disponible (fiable, indépendant du
        // montant → indispensable en cross-devises) ; sinon heuristique historique (montant opposé).
        type PairedRow = { id: string; account_id: string; amount: number; is_draft: boolean | null; is_recurring: boolean | null; date: string; linked_account_id: string | null };
        /* ⚠️ CES LECTURES DOIVENT RÉUSSIR — leur échec ne vaut PAS « pas de jambe opposée ».
           Leur erreur n'était pas lue : une lecture ratée rendait `undefined`, donc une liste vide,
           donc `paired = null`. Or plus bas, `!paired` déclenche la CRÉATION d'une jambe de crédit
           (cas du virement de projet validé) : sur une simple erreur réseau, on fabriquait une
           SECONDE jambe et le compte de destination était crédité deux fois. Et dans les autres cas,
           la jambe opposée n'était tout simplement pas mise à jour — un virement dont les deux
           moitiés ne disent plus la même chose. */
        let pairedList: PairedRow[];
        if (oldGroupId) {
          const { data: byGroup, error: gErr } = await supabase
            .from('transactions')
            .select('id, account_id, amount, is_draft, is_recurring, date, linked_account_id')
            .eq('transfer_group_id', oldGroupId)
            .neq('id', input.id);
          if (gErr) throw gErr;
          pairedList = (byGroup ?? []) as PairedRow[];
        } else {
          const { data: byHeur, error: hErr } = await supabase
            .from('transactions')
            .select('id, account_id, amount, is_draft, is_recurring, date, linked_account_id')
            .eq('account_id', oldLinkedAccId)
            .eq('date', oldDate ?? '')
            .eq('amount', -oldAmount)
            .is('category_id', null);
          if (hErr) throw hErr;
          pairedList = (byHeur ?? []) as PairedRow[];
        }
        // Préférer la jambe qui pointe en retour vers nous ; sinon la première candidate plausible.
        const paired = pairedList.find((c) => c.linked_account_id === oldAccId) ?? pairedList[0] ?? null;
        // Cross-devises : si les deux comptes ont des devises différentes, les montants des jambes
        // sont INDÉPENDANTS (réels débité/crédité) → on ne mirrore PAS automatiquement la jambe opposée.
        /* Idem : sans les devises, `crossCurrency` retombe à `false` et l'app MIROITE le montant sur
           l'autre jambe — ce qui est faux entre deux devises, où les deux montants sont indépendants. */
        const { data: curRows, error: curErr } = await supabase.from('accounts').select('id, currency, name').in('id', [oldAccId, oldLinkedAccId]);
        if (curErr) throw curErr;
        const curOf = new Map((curRows ?? []).map((a: any) => [a.id, (a.currency || 'EUR') as string]));
        const nameOf = new Map((curRows ?? []).map((a: any) => [a.id, a.name as string]));
        const crossCurrency = (curOf.get(oldAccId) || 'EUR') !== (curOf.get(oldLinkedAccId) || 'EUR');
        if (!paired && wasInDraft && !isNowDraft) {
          // Validation d'un virement dont la jambe de CRÉDIT n'existe pas encore : c'est le cas
          // d'un virement de projet validé via l'écran « Modifier » (et non via « Valider » de la
          // liste, qui passe par useValidateProjectDraft). On crée la transaction de crédit sur le
          // compte de destination + on crédite son solde, comme le fait validateProjectDraft.
          const creditAmt = Math.abs(newAmount);
          // `posted` reflète si le montant est DÉJÀ dans le solde : vrai seulement si la date est
          // échue. Si le virement est validé à une date future, posted=false → le solde de
          // destination n'est PAS impacté maintenant ; reconcile_posted() l'y portera le jour venu.
          const creditRaw = balanceContribution({ amount: creditAmt, date: newDate, is_draft: false, is_recurring: false });
          // Une ÉCRITURE dont on ne lit pas l'erreur : la jambe de crédit pouvait ne jamais exister
          // (droit, limite de saisie, réseau) pendant que l'app annonçait un virement validé.
          const { data: creditRow, error: creditErr } = await supabase.from('transactions').insert({
            profile_id: profileId,
            account_id: oldLinkedAccId,
            category_id: null,
            amount: creditAmt,
            date: newDate,
            note: newNote ?? null,
            is_draft: false,
            is_recurring: false,
            recurrence_rule: null,
            recurrence_end_date: null,
            project_id: oldProjectId,
            linked_account_id: oldAccId,
            posted: creditRaw !== 0,
          }).select().single();
          if (creditErr) throw creditErr;
          // La jambe de crédit vient d'exister : elle s'affiche tout de suite (RETURNING, pas de
          // requête supplémentaire). Le solde, lui, est recalculé par recomputeBalances() en fin de mutation.
          if (creditRow) seedTransactionCache(client, profileId, creditRow);
        } else if (paired) {
          const pairedOldAmt = Number((paired as any).amount);
          const pairedWasDraft = Boolean((paired as any).is_draft);
          const pairedRecurring = Boolean((paired as any).is_recurring);
          const pairedOldDate = (paired as any).date as string;
          const pairedAccId = (paired as any).account_id as string;
          // Mono-devise : la jambe opposée porte TOUJOURS le montant de signe inverse (miroir).
          // Cross-devises : montants indépendants. Si le MONTANT change, on PROPOSE (popup) de
          // recalculer aussi l'autre jambe au taux du jour — sinon il faudrait l'éditer à la main.
          const newMainAmount = input.amount !== undefined ? input.amount : oldAmount;
          let pairedNewAmt = crossCurrency ? pairedOldAmt : -newMainAmount;
          let updatePairedAmount = !crossCurrency && input.amount !== undefined;
          if (crossCurrency && input.amount !== undefined && newMainAmount !== oldAmount) {
            const thisCur = curOf.get(oldAccId) || 'EUR';
            const pairedCur = curOf.get(pairedAccId) || 'EUR';
            const { data: rateRows, error: rateErr } = await supabase.from('currency_rates').select('code, rate');
            if (rateErr) throw rateErr;
            const ratesMap: Record<string, number> = { EUR: 1 };
            for (const rr of (rateRows ?? []) as any[]) ratesMap[rr.code] = Number(rr.rate);
            const conv = convertAmount(Math.abs(newMainAmount), thisCur, pairedCur, ratesMap);
            if (conv != null) {
              // Signe OPPOSÉ à la jambe éditée (un virement a un débit et un crédit).
              const sign = -Math.sign(newMainAmount || 1);
              const proposedMag = Math.round(conv * 100) / 100; // proposition au taux du jour
              // Champ pré-rempli au taux mais LIBREMENT modifiable (le vrai montant reçu peut différer).
              const entered = await appPrompt({
                title: "Montant sur l'autre compte ?",
                message: `Virement entre devises différentes. Montant sur « ${nameOf.get(pairedAccId) ?? "l'autre compte"} » — proposé au taux du jour, ajustable. « Laisser » pour ne pas y toucher.`,
                defaultValue: proposedMag.toFixed(2),
                suffix: pairedCur,
                keyboardType: 'decimal-pad',
                confirmText: 'Mettre à jour',
                cancelText: 'Laisser',
              });
              if (entered !== null) {
                const n = parseFloat(entered.replace(',', '.'));
                if (Number.isFinite(n) && n > 0) { pairedNewAmt = sign * (Math.round(n * 100) / 100); updatePairedAmount = true; }
              }
            }
          }
          const pairedNewDate = input.date !== undefined ? input.date : pairedOldDate;
          const pairedNewDraft = input.is_draft !== undefined ? input.is_draft : pairedWasDraft;
          const pairedOldContribution = balanceContribution({ amount: pairedOldAmt, date: pairedOldDate, is_draft: pairedWasDraft, is_recurring: pairedRecurring });
          const pairedNewContribution = balanceContribution({ amount: pairedNewAmt, date: pairedNewDate, is_draft: pairedNewDraft, is_recurring: pairedRecurring });
          const pairedUpdates: Record<string, unknown> = {};
          if (updatePairedAmount) pairedUpdates.amount = pairedNewAmt;
          if (input.date !== undefined) pairedUpdates.date = input.date;
          if (input.note !== undefined) pairedUpdates.note = input.note;
          if (input.is_draft !== undefined) pairedUpdates.is_draft = input.is_draft;
          pairedUpdates.posted = pairedNewContribution !== 0;
          if (Object.keys(pairedUpdates).length > 0) {
            await supabase.from('transactions').update(pairedUpdates).eq('id', (paired as any).id);
            // L'autre jambe change aussi à l'écran (mêmes raisons) : on l'y reporte immédiatement.
            patchCachedTransaction(client, profileId, (paired as any).id, pairedUpdates);
          }
          // Solde du compte opposé : recalculé par recomputeBalances() plus bas (l'update incrémental
          // est retiré — redondant et bloqué par la RLS pour un membre non-propriétaire).
        }
      }
      // Solde = recalcul depuis les faits sur tous les comptes touchés (ancien/nouveau + jambe paire).
      await recomputeBalances([oldAccId, newAccId, oldLinkedAccId], client, profileId);
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
    },
    // Échec en cours de route (jambe appariée, réseau) : le cache a pu être écrit en avance sur la
    // base → on redemande la vérité au serveur plutôt que de laisser un écran optimiste faux.
    onError: () => { client.invalidateQueries({ queryKey: [KEY, profileId] }); },
  });
}

export function useDeleteTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: row, error: fetchErr } = await supabase
        .from('transactions')
        .select('account_id, amount, is_draft, is_recurring, project_id, date, linked_account_id, note, category_id, transfer_group_id, regul_target')
        .eq('id', id)
        .single(); // pas de filtre profile_id : la RLS autorise mes lignes + celles d'un compte où je suis owner/write
      if (fetchErr) throw fetchErr;
      // Supprimer une RÉGULARISATION change l'ensemble des « vérifications » → il faut recalibrer la
      // dérive de fiabilité (sinon une régul ajoutée puis retirée fige une dérive surestimée et tout
      // passe en « estimé »). Détecté avant la suppression, appliqué après (best-effort, plus bas).
      const wasRegul = isRegul(row as any);

      const isDraft = !!(row as any).is_draft;
      const isRecurringRow = !!(row as any).is_recurring;
      const projectId = (row as any).project_id as string | null;
      const txDate = (row as any).date as string;
      const txAmount = Number((row as any).amount);
      const linkedAccountId = (row as any).linked_account_id as string | null;
      const txNote = (row as any).note as string | null;
      const txCategoryId = (row as any).category_id as string | null;
      const txAccountId = (row as { account_id: string }).account_id;
      const txGroupId = (row as any).transfer_group_id as string | null;

      // ── Chercher la jambe symétrique de l'autre côté du virement ──
      // Robuste et symétrique (quel que soit le côté supprimé) : une jambe de virement est
      // identifiable par l'absence de catégorie ET (un linked_account_id OU une note « virement »).
      // On ne s'appuie PAS sur un linked_account_id parfaitement réciproque (les deux jambes
      // peuvent s'être désynchronisées, ou l'une être ancienne/sans linked_account_id), et on
      // n'utilise PAS maybeSingle() (qui renvoie null en silence dès qu'il y a 2 candidats).
      /* ⚠️ UNE LECTURE EN ÉCHEC N'EST PAS « PAS DE JAMBE OPPOSÉE ». L'erreur n'était pas lue : on
         concluait à l'absence de contrepartie, on supprimait la jambe principale juste en dessous,
         et l'autre restait ORPHELINE — à peser sur le solde du compte de destination, sans plus
         rien pour la rattacher au virement. Irrattrapable une fois la première partie. */
      let pairedId: string | null = null;
      if (txGroupId) {
        // Appariement fiable par GROUPE (indépendant du montant → marche en cross-devises où les
        // jambes ont des montants différents). On exclut soi-même.
        const { data: byGroup, error: gErr } = await supabase
          .from('transactions')
          .select('id')
          .eq('transfer_group_id', txGroupId)
          .neq('id', id);
        if (gErr) throw gErr;
        pairedId = ((byGroup ?? [])[0] as any)?.id ?? null;
      } else {
        // Anciens virements (sans groupe) : heuristique historique (montant opposé, même date).
        const looksLikeTransfer = txCategoryId === null && (!!linkedAccountId || (!!txNote && /virement/i.test(txNote)));
        if (looksLikeTransfer) {
          let q = supabase
            .from('transactions')
            .select('id, amount, is_draft, linked_account_id, account_id')
            .eq('date', txDate)
            .eq('amount', -txAmount)
            .is('category_id', null)
            .neq('id', id);
          q = linkedAccountId ? q.eq('account_id', linkedAccountId) : q.neq('account_id', txAccountId);
          const { data: candidates, error: cErr } = await q;
          if (cErr) throw cErr;
          const list = (candidates ?? []) as Array<{ id: string; linked_account_id: string | null; account_id: string }>;
          // Préférer la jambe qui pointe en retour vers nous ; sinon la première candidate plausible.
          const best = list.find((c) => c.linked_account_id === txAccountId) ?? list[0] ?? null;
          pairedId = best?.id ?? null;
        }
      }

      // Supprimer la transaction principale (RLS : ma ligne OU compte où je suis owner/write).
      const { error: delErr } = await supabase.from('transactions').delete().eq('id', id);
      if (delErr) throw delErr;

      // La ligne n'existe plus : elle disparaît de la liste MAINTENANT, sans attendre le refetch de
      // 500 lignes jointes (sinon la transaction supprimée reste visible pendant tout l'aller-retour).
      // Idem pour la jambe appariée d'un virement, supprimée juste après.
      writeTransactionCache(client, profileId, id, null);
      if (pairedId) writeTransactionCache(client, profileId, pairedId, null);

      // Le tableau de bord aussi : supprimer, c'est appliquer l'effet INVERSE de la ligne. Sans ça,
      // on revenait sur un Relyka et des soldes d'avant la suppression, définitifs en apparence,
      // qui sautaient une ou deux secondes plus tard. (Une régul n'entre dans aucun agrégat de la
      // même façon — son effet passe par le recalcul serveur, pas par ce raccourci.)
      if (!isDraft && !isRegul(row as any)) {
        patchPilotageCache(client, profileId, {
          accountId: txAccountId,
          amount: txAmount,
          direction: -1,
          date: txDate,
          categoryId: txCategoryId,
          isRecurring: isRecurringRow,
          projectId,
          linkedAccountId: linkedAccountId ?? txGroupId ?? null,
        });
      }

      // On ne retire du solde que ce qui y avait effectivement été ajouté
      // (contribution « à date » : ni brouillon, ni dépense future non récurrente ;
      //  §P12 : ni une transaction pré-régularisation, qui n'avait pas impacté le solde).
      // Solde = recalcul depuis les faits (anti-dérive).
      await recomputeBalances([txAccountId], client, profileId);

      // Supprimer le côté symétrique si trouvé
      if (pairedId) {
        // Sans ce compte, le solde de l'autre côté du virement ne serait pas recalculé.
        const { data: pairedRow, error: pairedErr } = await supabase
          .from('transactions')
          .select('account_id')
          .eq('id', pairedId)
          .maybeSingle();
        if (pairedErr) throw pairedErr;
        if (pairedRow) {
          await supabase.from('transactions').delete().eq('id', pairedId);
          await recomputeBalances([(pairedRow as any).account_id as string], client, profileId);
        }
      }

      // Recalcul de l'allocation mensuelle en mode « Date cible » si suppression d'un débit projet.
      // UNIQUEMENT pour un versement RÉALISÉ (is_draft = false) : la régénération ci-dessous recrée
      // TOUT l'échéancier futur (de la prochaine échéance jusqu'à la date cible). Sur un BROUILLON,
      // elle recréait donc aussitôt l'échéance qu'on venait de supprimer — d'où la corbeille « sans
      // effet » et la ligne qui réapparaît toute seule. Supprimer un brouillon le supprime, point.
      if (projectId && txAmount < 0 && !isDraft) {
        const today = localTodayISO();
        const { data: project, error: projErr } = await supabase
          .from('projects')
          .select('allocation_type, target_date, target_amount, source_account_id, linked_account_id, transaction_day, name, mode, expense_category_id')
          .eq('id', projectId)
          .eq('profile_id', profileId)
          .single();
        if (projErr) throw projErr;

        const isDateMode = project && project.target_date &&
          (project.allocation_type === 'date' || !project.allocation_type);
        if (isDateMode) {
          // Somme des débits passés et validés restants
          const { data: remainingTxns, error: remErr } = await supabase
            .from('transactions')
            .select('amount')
            .eq('project_id', projectId)
            .eq('profile_id', profileId)
            .eq('is_draft', false)
            .lt('amount', 0)
            .lte('date', today);
          if (remErr) throw remErr;

          const accumulated = (remainingTxns ?? []).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
          const remaining = Math.max(0, Number(project!.target_amount) - accumulated);
          const nowDate = new Date();

          // Cursor for generation: first payment day after today
          const paymentDay = project!.transaction_day ?? nowDate.getDate();
          const cursor = new Date(nowDate.getFullYear(), nowDate.getMonth(), paymentDay);
          if (cursor <= nowDate) cursor.setMonth(cursor.getMonth() + 1);
          const endLimit = new Date(project!.target_date! + 'T23:59:59');

          // Count months exactly as the generation loop would produce
          let monthsLeft = 0;
          const countCursor = new Date(cursor);
          while (countCursor <= endLimit) {
            monthsLeft++;
            countCursor.setMonth(countCursor.getMonth() + 1);
          }
          monthsLeft = Math.max(1, monthsLeft);
          const newMonthly = remaining / monthsLeft;

          const newFirstPaymentDate = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
          await supabase.from('projects').update({ monthly_allocation: newMonthly, first_payment_date: newFirstPaymentDate }).eq('id', projectId);

          const mode = projectMode(project);
          // Supprimer les échéances FUTURES à refaire : brouillons (virement / réservation) ou, en
          // mode « Dépenser », les dépenses à venir (validées d'emblée mais pas encore réalisées).
          let futureQuery = supabase.from('transactions').select(TX_REVERSAL_COLS)
            .eq('project_id', projectId).eq('profile_id', profileId).gt('date', today);
          if (mode !== 'spend') futureQuery = futureQuery.eq('is_draft', true);
          const { data: futureRows } = await futureQuery;
          await reverseBalanceAndDeleteTransactions(profileId, (futureRows ?? []) as any);

          const projetsCategoryId = mode === 'reserve'
            ? ((await supabase.from('categories').select('id')
                .eq('profile_id', profileId).eq('name', 'Projets').eq('type', 'expense').maybeSingle()).data?.id ?? null)
            : null;
          const txnsToInsert: any[] = [];

          while (cursor <= endLimit) {
            const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            txnsToInsert.push(...buildProjectTransactions({
              profileId,
              projectId,
              projectName: project!.name ?? '',
              mode,
              amount: newMonthly,
              date: d,
              accountId: project!.source_account_id ?? null,
              linkedAccountId: project!.linked_account_id ?? null,
              projetsCategoryId,
              expenseCategoryId: (project as any)!.expense_category_id ?? null,
              today,
            }));
            cursor.setMonth(cursor.getMonth() + 1);
          }
          if (txnsToInsert.length > 0) {
            await supabase.from('transactions').insert(txnsToInsert);
            if (mode === 'spend') await recomputeBalances([project!.source_account_id]);
          }
        }
      }

      // Régul supprimée → recalibrer la dérive depuis les régularisations restantes (best-effort).
      if (wasRegul) {
        try { await recomputeReliabilityCalibration(profileId); } catch { /* non bloquant */ }
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
      client.invalidateQueries({ queryKey: ['profile', profileId] });
    },
    // Idem : un échec après le retrait optimiste doit rendre la main au serveur.
    onError: () => { client.invalidateQueries({ queryKey: [KEY, profileId] }); },
  });
}

/**
 * Valider un brouillon lié à un projet → le transforme en virement réel entre les
 * deux comptes du projet (source → destination), en validant aussi le crédit associé.
 */
export function useValidateProjectDraft(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (debitTx: { id: string; project_id: string; amount: number; date: string; account_id: string }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');

      // Récupérer le projet pour avoir source et destination
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .select('source_account_id, linked_account_id, name')
        .eq('id', debitTx.project_id)
        .eq('profile_id', profileId)
        .single();
      if (projErr || !project) throw new Error('Projet introuvable');

      const sourceId = project.source_account_id as string;
      const linkedId = project.linked_account_id as string;
      const debitAmt = Number(debitTx.amount); // négatif
      const creditAmt = Math.abs(debitAmt);
      // Un virement validé à une date FUTURE ne doit pas impacter les soldes maintenant :
      // posted=false → reconcile_posted() portera les deux jambes au solde le jour venu.
      const debitPosted = balanceContribution({ amount: debitAmt, date: debitTx.date, is_draft: false, is_recurring: false }) !== 0;

      // 1. Valider le débit et le transformer en virement (linked_account_id = destination)
      await supabase
        .from('transactions')
        .update({ is_draft: false, linked_account_id: linkedId, posted: debitPosted })
        .eq('id', debitTx.id)
        .eq('profile_id', profileId);

      // Soldes recalculés par recomputeBalances() en fin de mutation (updates incrémentaux retirés —
      // redondants et bloqués par la RLS pour un membre non-propriétaire).

      // 2. Créer le crédit sur le compte de destination
      await supabase.from('transactions').insert({
        profile_id: profileId,
        account_id: linkedId,
        category_id: null,
        amount: creditAmt,
        date: debitTx.date,
        note: project.name,
        is_draft: false,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
        project_id: debitTx.project_id,
        linked_account_id: sourceId,
        posted: debitPosted,
      });

      // Solde = recalcul depuis les faits sur les deux comptes du virement (anti-dérive, SECURITY DEFINER).
      await recomputeBalances([sourceId, linkedId], client, profileId);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
    },
  });
}

/**
 * Pose la question « déjà comptée dans ce solde ? » AVANT de quitter l'écran de saisie.
 *
 * La saisie rend la main immédiatement (perf) et termine l'enregistrement en arrière-plan. Or cette
 * question porte sur l'opération en cours et attend une décision : posée dans la mutation, elle
 * surgissait une fois l'utilisateur DÉJÀ revenu sur la liste, par-dessus un autre écran. On la pose
 * donc ici, avant la navigation, et on transmet la réponse à la mutation (`regulCoveredAnswer`).
 *
 * Renvoie `undefined` quand il n'y a aucun conflit (cas normal) : la mutation n'a alors rien à faire.
 */
export function useAskRegulCoverage(profileId: string | undefined) {
  const client = useQueryClient();
  return async (accountId: string, date: string, note: string | null, contribution: number): Promise<boolean | undefined> => {
    if (!profileId || !accountId || contribution === 0) return undefined;
    const noteLc = (note ?? '').toLowerCase();
    if (noteLc.includes('gul') || note === 'Ajustement de solde') return undefined; // la régul elle-même
    const cachedAll = client.getQueryData<TransactionWithDetails[]>([KEY, profileId, 'all']);
    const conflict = await regulOnSameDay(accountId, date, cachedAll ?? null);
    if (!conflict) return undefined;

    const bal = conflict.balance;
    // Devise du COMPTE concerné (le solde y est libellé), et non un € codé en dur : ce dialogue
            // sert à comparer deux soldes, un mauvais symbole y rend la comparaison trompeuse.
            const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + currencySymbolFor(conflict.currency);
    const dateLbl = formatDateFrench(date);
    const choice = await appChoice({
      title: 'Déjà comptée dans ce solde ?',
      message: `Tu as fait une régularisation le ${dateLbl} sur « ${conflict.accountName} ». Cette opération y était-elle déjà comprise ?`,
      options: [
        {
          icon: 'checkmark-done',
          label: 'Oui, déjà incluse',
          hint: 'Elle apparaît pour l’historique, mais ne rebouge pas le solde.',
          tone: 'neutral',
          result: bal != null ? fmt(bal) : undefined,
          resultHint: `solde inchangé au ${dateLbl}`,
        },
        {
          icon: 'add-circle',
          label: 'Non, c’est une nouvelle opération',
          hint: 'Elle s’ajoute au solde régularisé.',
          tone: contribution < 0 ? 'danger' : 'accent',
          result: bal != null ? fmt(bal + contribution) : undefined,
          resultHint: `nouveau solde au ${dateLbl}`,
        },
      ],
    });
    // Fermeture sans choisir → on ne couvre pas : l'opération compte (comportement d'avant).
    return choice === 0;
  };
}
