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
import { supabase } from '../../lib/platform/supabase';
import { effectiveImpactPct } from '../../lib/finance/sharedImpact';
import type { Account } from '../../types/database';

export interface SharedContribution {
  accounts: Account[];                 // comptes partagés, balance ×facteur
  transactions: any[];                 // toutes les tx de ces comptes, amount ×facteur (devise d'origine)
  factorByAccount: Record<string, number>;
  /** Mode du USER COURANT pour chaque compte partagé (owner → accounts.shared_mode ; membre → account_members.shared_mode). */
  modeByAccount: Record<string, string | null>;
}

/**
 * LE CALCUL, séparé de sa provenance.
 *
 * Les lignes brutes arrivent soit par quatre requêtes enchaînées (`fetchSharedContribution`), soit
 * d'un seul bloc avec le reste du Pilotage (RPC `pilotage_snapshot`). La PONDÉRATION, elle, doit
 * rester écrite une seule fois : deux versions du facteur d'impact, ce serait deux tableaux de bord
 * qui ne racontent pas la même histoire selon le chemin emprunté.
 */
export function buildSharedContribution(
  profileId: string,
  sharedAccounts: any[],
  allMems: any[] | null,
  tx: any[] | null,
): SharedContribution {
  const sharedIds = sharedAccounts.map((a) => a.id);
  if (sharedIds.length === 0) return { accounts: [], transactions: [], factorByAccount: {}, modeByAccount: {} };

  const membersByAcct: Record<string, any[]> = {};
  for (const m of (allMems ?? []) as any[]) (membersByAcct[m.account_id] ??= []).push(m);

  const factorByAccount: Record<string, number> = {};
  const modeByAccount: Record<string, string | null> = {};
  for (const a of sharedAccounts) {
    const members = membersByAcct[a.id] ?? [];
    const N = 1 + members.length;
    const iAmOwner = a.profile_id === profileId;
    const myExplicit = iAmOwner ? (a.owner_impact_pct ?? null) : (members.find((m) => m.user_id === profileId)?.impact_pct ?? null);
    factorByAccount[a.id] = effectiveImpactPct(myExplicit, N) / 100;
    // Mode du USER COURANT (owner → colonne du compte ; membre → sa ligne account_members).
    modeByAccount[a.id] = iAmOwner ? (a.shared_mode ?? null) : (members.find((m) => m.user_id === profileId)?.shared_mode ?? null);
  }

  // À 0% d'impact, le compte partagé n'a AUCUN effet (soldes + transactions exclus de l'app).
  const accounts = sharedAccounts
    .filter((a) => (factorByAccount[a.id] ?? 1) > 0)
    .map((a) => {
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

  const transactions = (tx ?? [])
    .filter((t: any) => (factorByAccount[t.account_id] ?? 1) > 0) // 0% → non affichées / non comptées
    .map((t: any) => {
      const f = factorByAccount[t.account_id] ?? 1;
      return {
        ...t,
        amount: Number(t.amount) * f,
        regul_target: t.regul_target != null ? Number(t.regul_target) * f : t.regul_target,
        account: t.account,
        category: t.category,
        // #2 — % d'impact de CE compte partagé (annoté sur la ligne dans les modaux ; <100 = partagé).
        _impact_pct: Math.round(f * 100),
      };
    });

  return { accounts, transactions, factorByAccount, modeByAccount };
}

export async function fetchSharedContribution(profileId: string): Promise<SharedContribution> {
  if (!supabase) return { accounts: [], transactions: [], factorByAccount: {}, modeByAccount: {} };

  // Comptes auxquels je participe : joints que JE possède + comptes où je suis membre.
  /* ⚠️ TOUTES les erreurs sont levées, aucune n'est avalée.
     Ce que cette fonction produit alimente le PILOTAGE : le facteur d'impact décide de la fraction
     d'un compte partagé qui compte dans les chiffres de l'utilisateur. Or une lecture ratée était
     indiscernable d'une absence de données, et les replis vont tous dans le même sens — le PIRE :
       • `account_members` en échec → aucun membre → N = 1 → `effectiveImpactPct(null, 1)` = 100 %.
         Un compte joint partagé à deux comptait alors pour SA TOTALITÉ dans le Relyka, la
         projection et le plan de trésorerie. Un doublement silencieux des montants d'autrui.
       • la liste des comptes en échec → le compte partagé disparaît purement des agrégats.
     Dans les deux cas l'écran restait crédible, et c'est précisément ce qui rend la panne
     dangereuse. En levant, react-query garde le dernier état connu et réessaie. */
  const [ownJointsRes, myMemsRes] = await Promise.all([
    supabase.from('accounts').select('*').eq('profile_id', profileId).eq('is_joint', true).eq('is_active', true),
    supabase.from('account_members').select('account_id').eq('user_id', profileId),
  ]);
  if (ownJointsRes.error) throw ownJointsRes.error;
  if (myMemsRes.error) throw myMemsRes.error;
  const ownJoints = (ownJointsRes.data ?? []) as any[];
  const memberAcctIds = ((myMemsRes.data ?? []) as any[]).map((m) => m.account_id);

  let memberAccts: any[] = [];
  if (memberAcctIds.length > 0) {
    const { data, error } = await supabase.from('accounts').select('*').in('id', memberAcctIds).eq('is_active', true);
    if (error) throw error;
    memberAccts = (data ?? []).filter((a: any) => a.profile_id !== profileId); // exclut mes propres comptes
  }

  const sharedAccounts = [...ownJoints, ...memberAccts];
  const sharedIds = sharedAccounts.map((a) => a.id);
  if (sharedIds.length === 0) return { accounts: [], transactions: [], factorByAccount: {}, modeByAccount: {} };

  // Membres des comptes partagés + TOUTES leurs transactions : les deux ne dépendent que de
  // sharedIds → EN PARALLÈLE (1 aller-retour économisé sur ce fetch, qui est dans le chemin
  // critique du pilotage — donc de l'enrichissement de la carte Pouls après chaque saisie).
  const [memsRes, txRes] = await Promise.all([
    supabase.from('account_members').select('account_id, user_id, impact_pct, shared_mode').in('account_id', sharedIds),
    supabase.from('transactions')
      .select('*, account:accounts!account_id(name, currency, is_joint, profile_id), category:categories!category_id(*)')
      .in('account_id', sharedIds),
  ]);
  // `memsRes` porte le nombre de participants : sans lui, la part de chacun vaudrait 100 % (cf.
  // l'avertissement en tête de fonction). `txRes` porte l'activité du compte.
  if (memsRes.error) throw memsRes.error;
  if (txRes.error) throw txRes.error;

  return buildSharedContribution(profileId, sharedAccounts, memsRes.data as any[], txRes.data as any[]);
}

export function useSharedContribution(profileId: string | undefined) {
  return useQuery({
    queryKey: ['shared_contribution', profileId],
    enabled: !!profileId,
    queryFn: () => fetchSharedContribution(profileId!),
  });
}
