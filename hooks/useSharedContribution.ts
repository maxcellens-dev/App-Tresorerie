// #5 — Contribution des comptes PARTAGÉS/JOINTS aux agrégats perso, pondérée par le % d'impact.
//
// Renvoie, pour TOUS les comptes auxquels je participe (joints que je possède + comptes partagés reçus
// d'un autre user), les comptes et TOUTES leurs transactions (de tous les participants), avec soldes et
// montants MIS À L'ÉCHELLE de MON facteur d'impact (0..1). Les montants restent dans la devise d'origine
// (la conversion en devise de référence est faite par chaque écran consommateur).
//
// Pilotage/projection/trésorerie fusionnent ce résultat avec les données perso (qui, elles, excluent les
// comptes partagés) → pas de doublon.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { effectiveImpactPct } from '../lib/sharedImpact';
import type { Account } from '../types/database';

export interface SharedContribution {
  accounts: Account[];                 // comptes partagés, balance ×facteur
  transactions: any[];                 // toutes les tx de ces comptes, amount ×facteur (devise d'origine)
  factorByAccount: Record<string, number>;
}

export async function fetchSharedContribution(profileId: string): Promise<SharedContribution> {
  if (!supabase) return { accounts: [], transactions: [], factorByAccount: {} };

  // Comptes auxquels je participe : joints que JE possède + comptes où je suis membre.
  const [ownJointsRes, myMemsRes] = await Promise.all([
    supabase.from('accounts').select('*').eq('profile_id', profileId).eq('is_joint', true).eq('is_active', true),
    supabase.from('account_members').select('account_id').eq('user_id', profileId),
  ]);
  const ownJoints = (ownJointsRes.data ?? []) as any[];
  const memberAcctIds = ((myMemsRes.data ?? []) as any[]).map((m) => m.account_id);

  let memberAccts: any[] = [];
  if (memberAcctIds.length > 0) {
    const { data } = await supabase.from('accounts').select('*').in('id', memberAcctIds).eq('is_active', true);
    memberAccts = (data ?? []).filter((a: any) => a.profile_id !== profileId); // exclut mes propres comptes
  }

  const sharedAccounts = [...ownJoints, ...memberAccts];
  const sharedIds = sharedAccounts.map((a) => a.id);
  if (sharedIds.length === 0) return { accounts: [], transactions: [], factorByAccount: {} };

  // Tous les membres des comptes partagés (pour la part égale auto = 100/N) + le % explicite du courant.
  const { data: allMems } = await supabase
    .from('account_members').select('account_id, user_id, impact_pct').in('account_id', sharedIds);
  const membersByAcct: Record<string, any[]> = {};
  for (const m of (allMems ?? []) as any[]) (membersByAcct[m.account_id] ??= []).push(m);

  const factorByAccount: Record<string, number> = {};
  for (const a of sharedAccounts) {
    const members = membersByAcct[a.id] ?? [];
    const N = 1 + members.length;
    const iAmOwner = a.profile_id === profileId;
    const myExplicit = iAmOwner ? (a.owner_impact_pct ?? null) : (members.find((m) => m.user_id === profileId)?.impact_pct ?? null);
    factorByAccount[a.id] = effectiveImpactPct(myExplicit, N) / 100;
  }

  // TOUTES les transactions de ces comptes (de tous les participants).
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, account:accounts!account_id(name, currency, is_joint, profile_id), category:categories!category_id(*)')
    .in('account_id', sharedIds);

  const accounts = sharedAccounts.map((a) => {
    const f = factorByAccount[a.id] ?? 1;
    return {
      ...a,
      balance: Number(a.balance) * f,
      initial_contributed: a.initial_contributed != null ? Number(a.initial_contributed) * f : null,
      current_contributed: a.current_contributed != null ? Number(a.current_contributed) * f : null,
      regul_target: a.regul_target != null ? Number(a.regul_target) * f : a.regul_target,
      _role: a.profile_id === profileId ? 'owner' : 'write',
      _impact_pct: Math.round(f * 100),
    } as Account;
  });

  const transactions = (tx ?? []).map((t: any) => {
    const f = factorByAccount[t.account_id] ?? 1;
    return {
      ...t,
      amount: Number(t.amount) * f,
      regul_target: t.regul_target != null ? Number(t.regul_target) * f : t.regul_target,
      account: t.account,
      category: t.category,
    };
  });

  return { accounts, transactions, factorByAccount };
}

export function useSharedContribution(profileId: string | undefined) {
  return useQuery({
    queryKey: ['shared_contribution', profileId],
    enabled: !!profileId,
    queryFn: () => fetchSharedContribution(profileId!),
  });
}
