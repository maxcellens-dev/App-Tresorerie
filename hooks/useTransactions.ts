import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Transaction, TransactionWithDetails, RecurrenceRule } from '../types/database';
import { appConfirm } from '../lib/appDialog';
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
export const TX_REVERSAL_COLS = 'id, account_id, amount, date, is_draft, is_recurring, note, linked_account_id';

interface ReversalRow {
  id: string; account_id: string; amount: number; date: string;
  is_draft: boolean | null; is_recurring: boolean | null;
  note: string | null; linked_account_id: string | null;
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
    if (!r.linked_account_id) continue;
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
    const paired = list.find((c) => c.linked_account_id === r.account_id && !byId.has(c.id))
      ?? list.find((c) => !byId.has(c.id))
      ?? null;
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
          account:accounts!account_id(name, type),
          category:categories!category_id(name, type),
          linked_account:accounts!linked_account_id(name, type)
        `)
        .eq('profile_id', profileId)
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
    enabled: !!profileId,
  });

  return query;
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
  amount: number; // montant POSITIF (le signe des jambes est géré ici)
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
  const num = Math.abs(p.amount);
  const common = {
    is_draft: p.isDraft ?? false,
    is_recurring: p.isRecurring ?? false,
    recurrence_rule: p.isRecurring ? (p.recurrenceRule ?? null) : null,
    recurrence_end_date: p.recurrenceEndDate ?? null,
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
      amount: num,
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
      const { data: existing, error: fetchErr } = await supabase.from('transactions').select('account_id, amount, is_draft, is_recurring, linked_account_id, date, note, project_id').eq('id', input.id).eq('profile_id', profileId).single();
      if (fetchErr || !existing) throw fetchErr || new Error('Transaction introuvable');
      const oldAccId = (existing as { account_id: string }).account_id;
      const oldAmount = Number((existing as { amount: number }).amount);
      const wasInDraft = Boolean((existing as { is_draft?: boolean }).is_draft);
      const wasRecurring = Boolean((existing as { is_recurring?: boolean }).is_recurring);
      const isNowDraft = input.is_draft !== undefined ? input.is_draft : wasInDraft;
      const oldLinkedAccId = (existing as { linked_account_id?: string | null }).linked_account_id ?? null;
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

      const { data, error } = await supabase.from('transactions').update(updates).eq('id', input.id).eq('profile_id', profileId).select().single();
      if (error) throw error;

      const adjustBalance = async (accId: string, delta: number) => {
        if (delta === 0) return;
        const { data: acc } = await supabase!.from('accounts').select('balance').eq('id', accId).single();
        if (acc) await supabase!.from('accounts').update({ balance: Number(acc.balance) + delta }).eq('id', accId);
      };
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
        const { data: pairedCandidates } = await supabase
          .from('transactions')
          .select('id, account_id, amount, is_draft, is_recurring, date, linked_account_id')
          .eq('profile_id', profileId)
          .eq('account_id', oldLinkedAccId)
          .eq('date', oldDate ?? '')
          .eq('amount', -oldAmount)
          .is('category_id', null);
        const pairedList = (pairedCandidates ?? []) as Array<{ id: string; account_id: string; amount: number; is_draft: boolean | null; is_recurring: boolean | null; date: string; linked_account_id: string | null }>;
        // Préférer la jambe qui pointe en retour vers nous ; sinon la première candidate plausible.
        const paired = pairedList.find((c) => c.linked_account_id === oldAccId) ?? pairedList[0] ?? null;
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
          // La jambe opposée porte le montant de signe inverse.
          const newMainAmount = input.amount !== undefined ? input.amount : oldAmount;
          const pairedNewAmt = -newMainAmount;
          const pairedNewDate = input.date !== undefined ? input.date : pairedOldDate;
          const pairedNewDraft = input.is_draft !== undefined ? input.is_draft : pairedWasDraft;
          const pairedOldContribution = balanceContribution({ amount: pairedOldAmt, date: pairedOldDate, is_draft: pairedWasDraft, is_recurring: pairedRecurring });
          const pairedNewContribution = balanceContribution({ amount: pairedNewAmt, date: pairedNewDate, is_draft: pairedNewDraft, is_recurring: pairedRecurring });
          const pairedUpdates: Record<string, unknown> = {};
          if (input.amount !== undefined) pairedUpdates.amount = pairedNewAmt;
          if (input.date !== undefined) pairedUpdates.date = input.date;
          if (input.note !== undefined) pairedUpdates.note = input.note;
          if (input.is_draft !== undefined) pairedUpdates.is_draft = input.is_draft;
          pairedUpdates.posted = pairedNewContribution !== 0;
          if (Object.keys(pairedUpdates).length > 0) {
            await supabase.from('transactions').update(pairedUpdates).eq('id', (paired as any).id).eq('profile_id', profileId);
          }
          // Réajuster le solde du compte opposé via la contribution « à date ».
          const pairedDelta = pairedNewContribution - pairedOldContribution;
          if (pairedDelta !== 0) {
            const { data: pacc } = await supabase.from('accounts').select('balance').eq('id', pairedAccId).single();
            if (pacc) {
              await supabase.from('accounts').update({ balance: Number(pacc.balance) + pairedDelta }).eq('id', pairedAccId);
            }
          }
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
        .select('account_id, amount, is_draft, is_recurring, project_id, date, linked_account_id, note, category_id')
        .eq('id', id)
        .eq('profile_id', profileId)
        .single();
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

      // ── Chercher la jambe symétrique de l'autre côté du virement ──
      // Robuste et symétrique (quel que soit le côté supprimé) : une jambe de virement est
      // identifiable par l'absence de catégorie ET (un linked_account_id OU une note « virement »).
      // On ne s'appuie PAS sur un linked_account_id parfaitement réciproque (les deux jambes
      // peuvent s'être désynchronisées, ou l'une être ancienne/sans linked_account_id), et on
      // n'utilise PAS maybeSingle() (qui renvoie null en silence dès qu'il y a 2 candidats).
      let pairedId: string | null = null;
      const looksLikeTransfer = txCategoryId === null && (!!linkedAccountId || (!!txNote && /virement/i.test(txNote)));
      if (looksLikeTransfer) {
        // Candidats = même date, montant exactement opposé, sans catégorie, sur un AUTRE compte.
        // Si on connaît le compte d'en face (linked_account_id), on s'y restreint (plus précis).
        let q = supabase
          .from('transactions')
          .select('id, amount, is_draft, linked_account_id, account_id')
          .eq('profile_id', profileId)
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

      // Supprimer la transaction principale
      const { error: delErr } = await supabase.from('transactions').delete().eq('id', id).eq('profile_id', profileId);
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
          .eq('profile_id', profileId)
          .maybeSingle();
        if (pairedRow) {
          await supabase.from('transactions').delete().eq('id', pairedId).eq('profile_id', profileId);
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

      // Mettre à jour le solde du compte source (seulement si l'échéance est échue)
      if (debitPosted) {
        const { data: srcAcc } = await supabase.from('accounts').select('balance').eq('id', sourceId).single();
        if (srcAcc) await supabase.from('accounts').update({ balance: Number(srcAcc.balance) + debitAmt }).eq('id', sourceId);
      }

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

      // Mettre à jour le solde du compte destination (seulement si l'échéance est échue)
      if (debitPosted) {
        const { data: dstAcc } = await supabase.from('accounts').select('balance').eq('id', linkedId).single();
        if (dstAcc) await supabase.from('accounts').update({ balance: Number(dstAcc.balance) + creditAmt }).eq('id', linkedId);
      }

      // Solde = recalcul depuis les faits sur les deux comptes du virement (anti-dérive).
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
