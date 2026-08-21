import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { Account } from '../../types/database';
import { todayISO } from '../../lib/dateUtils';
import { effectiveImpactPct } from '../../lib/finance/sharedImpact';
import { sortAccounts } from '../../lib/finance/accountOrder';

const KEY = 'accounts';

const mapAccount = (r: any, profileId: string, roleById: Record<string, string>): Account => ({
  ...r,
  balance: Number(r.balance),
  initial_contributed: r.initial_contributed != null ? Number(r.initial_contributed) : null,
  current_contributed: r.current_contributed != null ? Number(r.current_contributed) : null,
  is_joint: !!r.is_joint,
  // 'owner' si c'est mon compte, sinon le rôle de membership (write/read).
  _role: r.profile_id === profileId ? 'owner' : ((roleById[r.id] as any) ?? 'read'),
});

/**
 * Comptes PERSONNELS (mes comptes non joints). C'est la vue « mon argent » : utilisée par le pilotage,
 * la projection, le reporting, les objectifs, les totaux… Les comptes JOINTS et les comptes PARTAGÉS
 * reçus d'autres utilisateurs en sont volontairement EXCLUS (aucun impact sur les agrégats perso).
 * → Pour la vue complète (page Comptes / virements / détail), utiliser useAllAccounts.
 */
export function useAccounts(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<Account[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('profile_id', profileId)
        .eq('is_active', true)
        .eq('is_joint', false)
        .order('name');
      if (error) throw error;
      // Ordre UNIQUE de l'app (défaut → type → nom) appliqué À LA SOURCE : toutes les listes
      // et sélecteurs en héritent, aucune page n'a à re-trier. Cf. lib/accountOrder.
      return sortAccounts((data ?? []).map((r) => mapAccount(r, profileId, {})));
    },
    enabled: !!profileId,
  });

  return query;
}

/**
 * TOUS les comptes accessibles : mes comptes perso + mes comptes joints + les comptes partagés reçus
 * d'autres utilisateurs (avec `_role` = owner/write/read et `is_joint`). À n'utiliser QUE là où l'on
 * veut voir les comptes partagés/joints (page Comptes, virements, détail de compte). Ne JAMAIS l'utiliser
 * pour des agrégats perso (pilotage/projection) → ça réintègrerait les comptes partagés.
 */
export function useAllAccounts(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId, 'all'],
    enabled: !!profileId,
    queryFn: async (): Promise<Account[]> => {
      if (!supabase || !profileId) return [];
      const ownP = supabase.from('accounts').select('*').eq('profile_id', profileId).eq('is_active', true);
      const memP = supabase.from('account_members').select('account_id, role').eq('user_id', profileId);
      const [{ data: own, error: ownErr }, memRes] = await Promise.all([ownP, memP]);
      if (ownErr) throw ownErr;
      /* Mes appartenances : c'est ce qui fait exister les comptes PARTAGÉS dans cette liste. Une
         lecture ratée les faisait tous disparaître, sans distinction d'avec « je n'en ai aucun ». */
      if (memRes?.error) throw memRes.error;

      const roleById: Record<string, string> = {};
      const memberIds: string[] = [];
      for (const m of (memRes?.data ?? []) as any[]) { roleById[m.account_id] = m.role; memberIds.push(m.account_id); }

      let memberAccounts: any[] = [];
      if (memberIds.length > 0) {
        const { data: ma, error: maErr } = await supabase
          .from('accounts').select('*').in('id', memberIds).eq('is_active', true).order('name');
        if (maErr) throw maErr;
        memberAccounts = (ma ?? []).filter((a: any) => a.profile_id !== profileId); // exclut mes propres comptes
      }

      const ownMapped = (own ?? []).map((r) => mapAccount(r, profileId, roleById));
      const memMapped = memberAccounts.map((r) => mapAccount(r, profileId, roleById));
      const all = [...ownMapped, ...memMapped];

      // #5 — % d'impact effectif par compte partagé/joint. On compte TOUS les participants (owner +
      // tous les membres) pour la part égale auto (100/N), et on lit le % explicite du participant courant.
      const sharedIds = all.filter((a) => a.is_joint || a._role !== 'owner').map((a) => a.id);
      if (sharedIds.length > 0) {
        /* ⚠️ Cette lecture donne le NOMBRE DE PARTICIPANTS, donc la part de chacun. Son erreur était
           avalée : `_impact_pct` restait alors indéfini, et tout ce qui le lit retombe sur 100 %
           (cf. useUserSnapshot, useCreditFlows). Un compte joint partagé à deux comptait donc pour
           sa totalité — une panne réseau doublait la contribution d'autrui dans les chiffres. */
        const { data: allMembers, error: membersErr } = await supabase
          .from('account_members').select('account_id, user_id, impact_pct').in('account_id', sharedIds);
        if (membersErr) throw membersErr;
        const membersByAcct: Record<string, any[]> = {};
        for (const m of (allMembers ?? []) as any[]) (membersByAcct[m.account_id] ??= []).push(m);
        for (const a of all) {
          if (!sharedIds.includes(a.id)) continue;
          const members = membersByAcct[a.id] ?? [];
          const N = 1 + members.length; // owner + membres (users ou non)
          const myExplicit = a._role === 'owner'
            ? (a.owner_impact_pct ?? null)
            : (members.find((m) => m.user_id === profileId)?.impact_pct ?? null);
          a._impact_pct = effectiveImpactPct(myExplicit, N);
        }
      }
      // Ordre UNIQUE de l'app (défaut → type → nom), appliqué À LA SOURCE. Cf. lib/accountOrder.
      return sortAccounts(all);
    },
  });
}

/** Comptes archivés (fermés), non utilisables pour virements ou nouvelles transactions. */
export function useArchivedAccounts(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId, 'archived'],
    queryFn: async (): Promise<Account[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('profile_id', profileId)
        .eq('is_active', false)
        .order('name');
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, balance: Number(r.balance), initial_contributed: r.initial_contributed != null ? Number(r.initial_contributed) : null, current_contributed: r.current_contributed != null ? Number(r.current_contributed) : null }));
    },
    enabled: !!profileId,
  });
  return query;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Crée le compte par défaut à la fin de l'onboarding si l'utilisateur n'en a aucun :
 * un seul compte courant. (Plus de Livret A / LDDS auto — l'utilisateur les crée au besoin.)
 * Idempotent.
 */
export function useSeedDefaultAccounts(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      /* ⚠️ L'erreur DOIT être lue : c'est ce test qui rend l'amorçage idempotent. Une lecture en
         échec le rendait faux (existing = null) et l'app recréait un « Compte courant » à 0 chez
         quelqu'un qui avait déjà les siens. */
      const { data: existing, error: existingError } = await supabase
        .from('accounts')
        .select('id')
        .eq('profile_id', profileId)
        .limit(1);
      if (existingError) throw existingError;
      if (existing && existing.length > 0) return; // déjà des comptes → ne rien faire

      // Devise : celle CHOISIE par l'utilisateur, jamais « EUR » en dur. Elle était ignorée ici,
      // si bien qu'un utilisateur suisse ou canadien démarrait avec un compte en euros alors qu'il
      // venait de sélectionner sa devise à l'écran précédent.
      const { data: prof } = await supabase
        .from('profiles').select('currency_code').eq('id', profileId).maybeSingle();

      const { error } = await supabase.from('accounts').insert({
        profile_id: profileId,
        name: 'Compte courant',
        type: 'checking',
        currency: (prof as any)?.currency_code || 'EUR',
        balance: 0,
        is_default: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useAddAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; type: string; currency: string; balance: number; fiscal_envelope?: string | null; init_date?: string | null; initial_contributed?: number | null; is_joint?: boolean; shared_mode?: string | null; is_default?: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      // SOURCE DE VÉRITÉ = l'utilisateur réellement authentifié (auth.uid()), pas le profileId du
      // contexte (qui peut être désynchronisé). La RLS exige profile_id = auth.uid() → on garantit
      // que le compte est créé pour le bon propriétaire, sinon « violates RLS » à coup sûr.
      const { data: sess } = await supabase.auth.getSession();
      const ownerId = sess?.session?.user?.id ?? profileId;
      if (!ownerId) throw new Error('Session expirée — déconnecte-toi puis reconnecte-toi.');
      const nameNorm = normalizeName(input.name);
      if (!nameNorm) throw new Error('Le nom du compte est requis.');
      // Lecture en échec ≠ « aucun compte » : sans ce test, le contrôle d'unicité du nom sautait en
      // silence et laissait créer un doublon.
      const { data: existing, error: existingError } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('profile_id', ownerId)
        .eq('is_active', true);
      if (existingError) throw existingError;
      const hasDuplicate = (existing ?? []).some(
        (r) => normalizeName((r as { name?: string }).name ?? '') === nameNorm
      );
      if (hasDuplicate) throw new Error('Un compte avec ce nom existe déjà.');
      // « Compte principal » à la création : réservé à un compte COURANT perso (contrainte serveur,
      // migration 146). On retire d'abord le défaut existant — l'index unique en base refuserait
      // deux `is_default` simultanés.
      const wantsDefault = !!input.is_default && (input.type || 'checking') === 'checking' && !input.is_joint;
      if (wantsDefault) {
        /* ⚠️ L'erreur DOIT être lue — c'est une ÉCRITURE dont dépend l'insertion qui suit.
           L'index unique de la migration 146 refuse deux `is_default` simultanés : si ce retrait
           échouait en silence, l'INSERT juste après explosait sur la contrainte, et l'utilisateur
           se voyait refuser la création de son compte avec un message brut de la base
           (« duplicate key value violates unique constraint »). On échoue ici, en expliquant.
           `useSetDefaultAccount` contrôlait déjà ses deux écritures : on s'aligne dessus. */
        const { error: clearDefaultErr } = await supabase.from('accounts').update({ is_default: false })
          .eq('profile_id', ownerId).eq('is_default', true);
        if (clearDefaultErr) {
          throw new Error("Impossible de changer de compte principal pour l'instant. Réessaie, ou crée le compte sans le marquer comme principal.");
        }
      }
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          profile_id: ownerId,
          name: input.name.trim(),
          type: input.type || 'checking',
          currency: input.currency || 'EUR',
          balance: 0,
          ...(wantsDefault ? { is_default: true } : {}),
          ...(input.is_joint ? { is_joint: true } : {}),
          ...(input.is_joint && input.shared_mode ? { shared_mode: input.shared_mode } : {}),
          ...(input.type === 'investment' && input.fiscal_envelope ? { fiscal_envelope: input.fiscal_envelope } : {}),
          ...(input.type === 'investment' && input.initial_contributed != null ? { initial_contributed: input.initial_contributed, current_contributed: input.initial_contributed } : {}),
          ...(input.init_date ? { init_date: input.init_date } : {}),
        })
        .select()
        .single();
      if (error) throw new Error([error.message, (error as any).details, (error as any).hint].filter(Boolean).join(' — ') || 'Erreur base de données');

      // Le solde est désormais DÉRIVÉ des transactions (recompute_account_balance). Le solde initial est
      // adossé à une transaction d'ANCRE DE RÉGULARISATION (même nature qu'une régul de solde) :
      // category_id NULL + note « Régularisation » + regul_target. Avantages : (a) traitée comme une
      // régul (pas de sous-catégorie exigée à l'édition), (b) solde déterministe dès le départ (ancre).
      const initBal = input.balance ?? 0;
      if (data && initBal !== 0) {
        const accId = (data as any).id as string;
        const initDate = input.init_date ?? todayISO();
        const { error: regErr } = await supabase.from('transactions').insert({
          profile_id: ownerId,
          account_id: accId,
          category_id: null,
          amount: initBal,
          date: initDate,
          note: 'Régularisation solde initial',
          regul_target: initBal,
          is_draft: false,
          is_recurring: false,
          posted: true,
        });
        if (regErr) throw new Error('Solde initial : ' + [regErr.message, (regErr as any).details, (regErr as any).hint].filter(Boolean).join(' — '));
        const { error: recErr } = await supabase.rpc('recompute_account_balance', { p_account: accId, p_today: todayISO() });
        if (recErr) throw new Error('Recalcul du solde : ' + recErr.message);
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: [KEY, profileId, 'archived'] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/** Fermer un compte : s'il a des écritures → archivage (is_active = false), sinon suppression. */
export function useCloseAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: acc, error: accErr } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', accountId)
        .eq('profile_id', profileId)
        .single();
      if (accErr || !acc) throw new Error('Compte introuvable.');

      /* ⚠️ Un compte qui porte un CRÉDIT ne peut pas être fermé tel quel — dans les deux branches
         ci-dessous, le crédit se retrouvait dans un état incohérent, sans le moindre signal :
           • suppression (0 écriture) → `credits.account_id` passe à NULL (ON DELETE SET NULL,
             migration 104). Le crédit reste dans la liste mais `useCreditFlows` l'ignore
             (`!c.account_id` → aucun flux) : il cesse d'exister pour la projection, le plan de
             trésorerie et le Relyka, sans que rien ne l'explique à l'écran.
           • archivage (avec écritures) → le compte sort de `useAllAccounts` (filtré is_active), donc
             là encore plus aucun flux projeté… alors que `useMaterializeCredits`, lui, continuait de
             créer de VRAIES transactions d'échéance sur ce compte devenu invisible. Les montants
             projetés et les montants réellement écrits en base racontaient deux histoires.
         On refuse donc, avec une consigne actionnable, plutôt que de laisser un crédit orphelin. */
      const { data: attached, error: creditErr } = await supabase
        .from('credits')
        .select('label')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .limit(1);
      if (creditErr) throw creditErr;
      if ((attached ?? []).length > 0) {
        throw new Error(
          `Ce compte est le compte de prélèvement du crédit « ${(attached as any[])[0].label} ». `
          + 'Rattache ce crédit à un autre compte (ou supprime-le) avant de fermer celui-ci.',
        );
      }

      const { count, error: countErr } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        const { error: updErr } = await supabase
          .from('accounts')
          .update({ is_active: false })
          .eq('id', accountId)
          .eq('profile_id', profileId);
        if (updErr) throw updErr;
      } else {
        const { error: delErr } = await supabase.from('accounts').delete().eq('id', accountId).eq('profile_id', profileId);
        if (delErr) throw delErr;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: [KEY, profileId, 'archived'] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/**
 * RÉACTIVER un compte archivé — l'inverse de `useCloseAccount`.
 *
 * L'archivage n'avait aucun retour en arrière : `is_active` passait à `false` et rien, nulle part,
 * ne le remettait à `true`. Un compte fermé par erreur disparaissait donc définitivement des
 * totaux, des virements et de la saisie, alors que ses transactions, elles, restaient en base.
 *
 * On refuse la réactivation si un compte ACTIF porte déjà le même nom : les écrans de création et
 * d'édition garantissent l'unicité des noms parmi les comptes actifs, et rouvrir par-dessus la
 * casserait en silence — deux lignes identiques dans toutes les listes.
 */
export function useReactivateAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: acc, error: accErr } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('id', accountId)
        .eq('profile_id', profileId)
        .single();
      if (accErr) throw accErr;
      if (!acc) throw new Error('Compte introuvable.');

      const nameNorm = normalizeName((acc as any).name ?? '');
      const { data: actives, error: activesError } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('profile_id', profileId)
        .eq('is_active', true);
      if (activesError) throw activesError;
      if ((actives ?? []).some((r: any) => normalizeName(r.name ?? '') === nameNorm)) {
        throw new Error(
          `Un compte actif s'appelle déjà « ${(acc as any).name} ». Renomme-le avant de rouvrir celui-ci.`,
        );
      }

      const { error } = await supabase
        .from('accounts')
        .update({ is_active: true })
        .eq('id', accountId)
        .eq('profile_id', profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: [KEY, profileId, 'archived'] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useUpdateAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; type?: string; currency?: string; balance?: number; fiscal_envelope?: string | null; current_contributed?: number | null; initial_contributed?: number | null }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      if (input.name !== undefined) {
        const nameNorm = normalizeName(input.name);
        if (!nameNorm) throw new Error('Le nom du compte est requis.');
        // Idem : une erreur de lecture ne doit pas faire passer le contrôle d'unicité du nom.
        const { data: existing, error: existingError } = await supabase
          .from('accounts')
          .select('id, name')
          .eq('profile_id', profileId)
          .eq('is_active', true);
        if (existingError) throw existingError;
        const duplicate = (existing ?? []).find(
          (r) => (r as { id: string }).id !== input.id && normalizeName((r as { name?: string }).name ?? '') === nameNorm
        );
        if (duplicate) throw new Error('Un compte avec ce nom existe déjà.');
      }
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.type !== undefined) updates.type = input.type;
      if (input.currency !== undefined) updates.currency = input.currency;
      if (input.balance !== undefined) updates.balance = input.balance;
      if (input.fiscal_envelope !== undefined) updates.fiscal_envelope = input.fiscal_envelope;
      if (input.current_contributed !== undefined) updates.current_contributed = input.current_contributed;
      if (input.initial_contributed !== undefined) updates.initial_contributed = input.initial_contributed;
      const { data, error } = await supabase
        .from('accounts')
        .update(updates)
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/**
 * Définit LE compte courant par défaut (migration 146) : pré-sélectionné à la saisie d'une
 * transaction et placé en tête de toutes les listes. Un seul par profil → on retire d'abord le
 * précédent (l'index unique partiel en base refuserait deux `is_default` simultanés).
 * Passer `null` retire simplement le défaut.
 */
export function useSetDefaultAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string | null) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      // 1. Retirer le défaut actuel (no-op s'il n'y en a pas).
      const { error: clearErr } = await supabase
        .from('accounts').update({ is_default: false })
        .eq('profile_id', profileId).eq('is_default', true);
      if (clearErr) throw clearErr;
      // 2. Poser le nouveau (la contrainte serveur vérifie : courant, actif, non joint).
      if (accountId) {
        const { error } = await supabase
          .from('accounts').update({ is_default: true })
          .eq('id', accountId).eq('profile_id', profileId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
    },
  });
}
