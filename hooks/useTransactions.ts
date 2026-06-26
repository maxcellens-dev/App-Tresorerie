import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Transaction, TransactionWithDetails, RecurrenceRule } from '../types/database';
import { appConfirm, appPrompt } from '../lib/appDialog';
import { convertAmount } from '../lib/currency';
import { formatDateFrench } from '../lib/dateUtils';

const KEY = 'transactions';

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

/**
 * §P12 — Impact RÉEL sur le solde d'une transaction, en tenant compte de la dernière
 * « régularisation de solde » du compte : une transaction datée AVANT cette régularisation
 * n'impacte pas le solde (la régul a déjà capturé l'état à sa date). La régularisation
 * elle-même compte toujours. (Le « Dépensé ce mois » du Pilotage n'est PAS affecté.)
 */
async function effectiveBalanceDelta(accountId: string, txDate: string, note: string | null | undefined, rawContribution: number): Promise<number> {
  if (rawContribution === 0 || !supabase) return rawContribution;
  const noteLc = (note ?? '').toLowerCase();
  if (noteLc.includes('gul') || note === 'Ajustement de solde') return rawContribution; // la régul compte
  const { data } = await supabase.from('transactions').select('date')
    .eq('account_id', accountId).is('category_id', null)
    .or('note.ilike.%gul%,note.eq.Ajustement de solde')
    .order('date', { ascending: false }).limit(1).maybeSingle();
  const baselineDate = (data as any)?.date as string | undefined;
  return (baselineDate && txDate < baselineDate) ? 0 : rawContribution;
}

/**
 * §P12bis — Détecte une régularisation de solde datée EXACTEMENT du même jour qu'une transaction
 * que l'on est en train de saisir, sur le même compte. Cas ambigu : la transaction est-elle déjà
 * comptée dans le solde régularisé (→ ne pas réimpacter) ou s'agit-il d'une nouvelle opération
 * (→ impacter le solde) ? Renvoie le nom du compte si une régul existe ce jour-là, sinon null.
 */
async function regulOnSameDay(accountId: string, date: string): Promise<{ accountName: string } | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('transactions').select('id')
    .eq('account_id', accountId).eq('date', date).is('category_id', null)
    .or('note.ilike.%gul%,note.eq.Ajustement de solde')
    .limit(1).maybeSingle();
  if (!data) return null;
  const { data: acc } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle();
  return { accountName: (acc as any)?.name ?? 'ce compte' };
}

/**
 * Recalcule (côté base) le solde STOCKÉ des comptes touchés via recompute_account_balance().
 * Source de vérité unique du solde → à appeler après TOUTE mutation qui modifie des transactions.
 * Élimine toute dérive : le solde ne dépend plus d'additions/réversions incrémentales.
 */
async function recomputeBalances(accountIds: Array<string | null | undefined>): Promise<void> {
  if (!supabase) return;
  const today = localTodayISO();
  const seen = new Set<string>();
  for (const id of accountIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    await supabase.rpc('recompute_account_balance', { p_account: id, p_today: today });
  }
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
      const { data: byGroup } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('profile_id', profileId)
        .eq('transfer_group_id', r.transfer_group_id)
        .neq('id', r.id);
      paired = ((byGroup ?? []) as ReversalRow[]).find((c) => !byId.has(c.id)) ?? null;
    } else if (r.linked_account_id) {
      // Anciens virements (sans groupe) : heuristique historique (montant opposé, même date).
      const { data: candidates } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('profile_id', profileId)
        .eq('account_id', r.linked_account_id)
        .eq('date', r.date)
        .eq('amount', -Number(r.amount))
        .is('category_id', null);
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
        .limit(500);
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
      // La RLS de `accounts` renvoie mes comptes accessibles → on charge les transactions de ces comptes
      // (donc aussi celles des autres membres sur un compte joint).
      const { data: accs, error: accErr } = await supabase.from('accounts').select('id');
      if (accErr) throw accErr;
      const accountIds = (accs ?? []).map((a: any) => a.id);
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
        .limit(500);
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
      /** Pour une ligne de régularisation : solde cible saisi (affichage). */
      regul_target?: number | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const contribution = balanceContribution({ amount: input.amount, date: input.date, is_draft: input.is_draft, is_recurring: input.is_recurring });

      // §P12bis — Cas ambigu : transaction datée LE JOUR d'une régularisation. On demande si elle
      // est DÉJÀ incluse dans ce solde (→ regul_covered = true, le recalcul l'exclut) ou si c'est
      // une NOUVELLE opération postérieure à la régul (→ elle compte). L'absorption « avant la
      // régul » n'a PAS besoin d'être stockée : le recalcul la dérive de la date.
      let regulCovered = false;
      if (input.checkRegulConflict && contribution !== 0) {
        const noteLc = (input.note ?? '').toLowerCase();
        const isRegulItself = noteLc.includes('gul') || input.note === 'Ajustement de solde';
        if (!isRegulItself) {
          const conflict = await regulOnSameDay(input.account_id, input.date);
          if (conflict) {
            const alreadyCounted = await appConfirm({
              title: 'Déjà comptée dans ce solde ?',
              message: `Une régularisation de solde a été faite le ${formatDateFrench(input.date)} sur « ${conflict.accountName} ». Cette opération y est-elle déjà incluse, ou s'agit-il d'une nouvelle opération qui doit modifier le solde ?`,
              confirmText: 'Déjà incluse',
              cancelText: 'Nouvelle opération',
            });
            regulCovered = alreadyCounted; // « Déjà incluse » → couverte ; « Nouvelle »/fermeture → compte.
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
        })
        .select()
        .single();
      if (error) throw error;
      // Solde = recalcul depuis les faits (source de vérité, anti-dérive).
      await recomputeBalances([input.account_id]);
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
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
  /** Saisie interactive : demander, pour chaque jambe, si l'opération est déjà incluse dans une
   *  régularisation de solde du même jour (cf. addTransaction.checkRegulConflict). */
  checkRegulConflict?: boolean;
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
    // Chaque jambe vérifie sa propre date vs une éventuelle régul sur SON compte.
    checkRegulConflict: p.checkRegulConflict ?? false,
  };
  const firstLeg = await add.mutateAsync({
    account_id: p.fromAccountId,
    category_id: null,
    amount: -num,
    date: p.date,
    note: p.noteFrom ?? 'Virement interne',
    linked_account_id: p.toAccountId,
    ...common,
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
    });
  } catch (legErr) {
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
      // §P12 : neutralise l'impact solde des transactions pré-régularisation (sans dérive).
      const oldNote = (existing as any).note as string | null;
      const newNote = input.note !== undefined ? input.note : oldNote;
      const oldDelta = await effectiveBalanceDelta(oldAccId, oldDate ?? '', oldNote, oldContribution);
      const newDelta = await effectiveBalanceDelta(newAccId, newDate, newNote, newContribution);

      const { data, error } = await supabase.from('transactions').update(updates).eq('id', input.id).select().single();
      if (error) throw error;

      // No-op : le solde est recalculé par recomputeBalances() plus bas (source de vérité unique,
      // SECURITY DEFINER). L'ancien update incrémental est retiré car redondant ET bloqué par la RLS
      // pour un membre écrivant sur un compte joint/partagé qu'il ne possède pas (accounts UPDATE = owner).
      const adjustBalance = async (_accId: string, _delta: number) => {};
      if (newAccId === oldAccId) {
        await adjustBalance(oldAccId, newDelta - oldDelta);
      } else {
        await adjustBalance(oldAccId, -oldDelta);
        await adjustBalance(newAccId, newDelta);
      }

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
        let pairedList: PairedRow[];
        if (oldGroupId) {
          const { data: byGroup } = await supabase
            .from('transactions')
            .select('id, account_id, amount, is_draft, is_recurring, date, linked_account_id')
            .eq('transfer_group_id', oldGroupId)
            .neq('id', input.id);
          pairedList = (byGroup ?? []) as PairedRow[];
        } else {
          const { data: byHeur } = await supabase
            .from('transactions')
            .select('id, account_id, amount, is_draft, is_recurring, date, linked_account_id')
            .eq('account_id', oldLinkedAccId)
            .eq('date', oldDate ?? '')
            .eq('amount', -oldAmount)
            .is('category_id', null);
          pairedList = (byHeur ?? []) as PairedRow[];
        }
        // Préférer la jambe qui pointe en retour vers nous ; sinon la première candidate plausible.
        const paired = pairedList.find((c) => c.linked_account_id === oldAccId) ?? pairedList[0] ?? null;
        // Cross-devises : si les deux comptes ont des devises différentes, les montants des jambes
        // sont INDÉPENDANTS (réels débité/crédité) → on ne mirrore PAS automatiquement la jambe opposée.
        const { data: curRows } = await supabase.from('accounts').select('id, currency, name').in('id', [oldAccId, oldLinkedAccId]);
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
          await supabase.from('transactions').insert({
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
          });
          const creditDelta = await effectiveBalanceDelta(oldLinkedAccId, newDate, newNote, creditRaw);
          await adjustBalance(oldLinkedAccId, creditDelta);
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
            const { data: rateRows } = await supabase.from('currency_rates').select('code, rate');
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
          }
          // Solde du compte opposé : recalculé par recomputeBalances() plus bas (l'update incrémental
          // est retiré — redondant et bloqué par la RLS pour un membre non-propriétaire).
        }
      }
      // Solde = recalcul depuis les faits sur tous les comptes touchés (ancien/nouveau + jambe paire).
      await recomputeBalances([oldAccId, newAccId, oldLinkedAccId]);
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
    },
  });
}

export function useDeleteTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: row, error: fetchErr } = await supabase
        .from('transactions')
        .select('account_id, amount, is_draft, is_recurring, project_id, date, linked_account_id, note, category_id, transfer_group_id')
        .eq('id', id)
        .single(); // pas de filtre profile_id : la RLS autorise mes lignes + celles d'un compte où je suis owner/write
      if (fetchErr) throw fetchErr;

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
      let pairedId: string | null = null;
      if (txGroupId) {
        // Appariement fiable par GROUPE (indépendant du montant → marche en cross-devises où les
        // jambes ont des montants différents). On exclut soi-même.
        const { data: byGroup } = await supabase
          .from('transactions')
          .select('id')
          .eq('transfer_group_id', txGroupId)
          .neq('id', id);
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
          const { data: candidates } = await q;
          const list = (candidates ?? []) as Array<{ id: string; linked_account_id: string | null; account_id: string }>;
          // Préférer la jambe qui pointe en retour vers nous ; sinon la première candidate plausible.
          const best = list.find((c) => c.linked_account_id === txAccountId) ?? list[0] ?? null;
          pairedId = best?.id ?? null;
        }
      }

      // Supprimer la transaction principale (RLS : ma ligne OU compte où je suis owner/write).
      const { error: delErr } = await supabase.from('transactions').delete().eq('id', id);
      if (delErr) throw delErr;

      // On ne retire du solde que ce qui y avait effectivement été ajouté
      // (contribution « à date » : ni brouillon, ni dépense future non récurrente ;
      //  §P12 : ni une transaction pré-régularisation, qui n'avait pas impacté le solde).
      // Solde = recalcul depuis les faits (anti-dérive).
      await recomputeBalances([txAccountId]);

      // Supprimer le côté symétrique si trouvé
      if (pairedId) {
        const { data: pairedRow } = await supabase
          .from('transactions')
          .select('account_id')
          .eq('id', pairedId)
          .maybeSingle();
        if (pairedRow) {
          await supabase.from('transactions').delete().eq('id', pairedId);
          await recomputeBalances([(pairedRow as any).account_id as string]);
        }
      }

      // Recalcul de l'allocation mensuelle en mode "Date cible" si suppression d'un débit projet
      if (projectId && txAmount < 0) {
        const today = localTodayISO();
        const { data: project } = await supabase
          .from('projects')
          .select('allocation_type, target_date, target_amount, source_account_id, linked_account_id, transaction_day, name')
          .eq('id', projectId)
          .eq('profile_id', profileId)
          .single();

        const isDateMode = project && project.target_date &&
          (project.allocation_type === 'date' || !project.allocation_type);
        if (isDateMode) {
          // Somme des débits passés et validés restants
          const { data: remainingTxns } = await supabase
            .from('transactions')
            .select('amount')
            .eq('project_id', projectId)
            .eq('profile_id', profileId)
            .eq('is_draft', false)
            .lt('amount', 0)
            .lte('date', today);

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

          // Supprimer les transactions futures brouillon du projet
          await supabase.from('transactions').delete()
            .eq('project_id', projectId).eq('profile_id', profileId)
            .eq('is_draft', true).gt('date', today);

          const { data: projetsCat } = await supabase.from('categories').select('id')
            .eq('profile_id', profileId).eq('name', 'Projets').eq('type', 'expense').maybeSingle();
          const projetsCategoryId = projetsCat?.id ?? null;
          const sameAccount = project!.source_account_id && project!.linked_account_id &&
            project!.source_account_id === project!.linked_account_id;
          const txnsToInsert: any[] = [];

          while (cursor <= endLimit) {
            const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            if (sameAccount) {
              txnsToInsert.push({
                profile_id: profileId, account_id: project!.source_account_id,
                category_id: projetsCategoryId, amount: 0, date: d,
                note: project!.name ?? null, is_forecast: false, is_recurring: false,
                recurrence_rule: null, recurrence_end_date: null,
                project_id: projectId, is_draft: true,
              });
            } else if (project!.source_account_id) {
              // Virement vers un autre compte → brouillon de VIREMENT (linked_account_id), pas une dépense.
              txnsToInsert.push({
                profile_id: profileId, account_id: project!.source_account_id,
                category_id: null, linked_account_id: project!.linked_account_id ?? null,
                amount: -newMonthly, date: d,
                note: project!.name ?? null, is_forecast: false, is_recurring: false,
                recurrence_rule: null, recurrence_end_date: null,
                project_id: projectId, is_draft: true,
              });
            }
            cursor.setMonth(cursor.getMonth() + 1);
          }
          if (txnsToInsert.length > 0) {
            await supabase.from('transactions').insert(txnsToInsert);
          }
        }
      }
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
      await recomputeBalances([sourceId, linkedId]);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
    },
  });
}
