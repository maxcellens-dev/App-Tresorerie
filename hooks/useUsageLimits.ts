/**
 * useUsageLimits — config admin des limites d'usage + garde-fou CLIENT avant création.
 * Le blocage réel est en base (migration 135) ; ici on affiche un message amont convivial.
 */
import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePlan } from './usePlan';
import { todayISO } from '../lib/dateUtils';
import {
  resolveUsageLimits, showUsageLimitDialog, monthBounds, yearBounds,
  type UsageLimitsConfig, type UsageEntity,
} from '../lib/usageLimits';

/** Config des limites (app_config.usage_limits), défauts fusionnés. */
export function useUsageLimitsConfig() {
  return useQuery({
    queryKey: ['usage_limits_config'],
    queryFn: async (): Promise<UsageLimitsConfig> => {
      if (!supabase) return resolveUsageLimits(null);
      const { data } = await supabase.from('app_config').select('usage_limits').eq('id', 'default').single();
      return resolveUsageLimits((data as any)?.usage_limits ?? null);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** Enregistre la config (admin). */
export function useSaveUsageLimitsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: UsageLimitsConfig) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('app_config').update({ usage_limits: next, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return next;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usage_limits_config'] }); },
  });
}

async function countRows(table: string, userId: string): Promise<number> {
  const { count } = await supabase!.from(table).select('id', { count: 'exact', head: true }).eq('profile_id', userId);
  return count ?? 0;
}

/**
 * Garde-fou avant création. `guard(entity)` renvoie true si la création est permise, sinon affiche
 * le message de limite (et redirige éventuellement vers Premium) et renvoie false.
 * Pour une transaction, passe la date cible (`opts.date`) : les limites mois/an sont calculées sur
 * l'année/le mois de CETTE date (comme le serveur). Défaut : aujourd'hui.
 */
export function useUsageGuard(userId: string | undefined) {
  const { data: cfg } = useUsageLimitsConfig();
  const { isPremium } = usePlan(userId);

  const guard = useCallback(
    async (entity: UsageEntity, opts?: { date?: string }): Promise<boolean> => {
      if (!supabase || !userId || !cfg) return true; // repli : le serveur reste le vrai garde-fou
      const limits = isPremium ? cfg.premium : cfg.free;

      if (entity === 'transaction') {
        const date = (opts?.date ?? todayISO()).slice(0, 10);
        const mb = monthBounds(date);
        const yb = yearBounds(date);
        const base = () => supabase!.from('transactions').select('id', { count: 'exact', head: true })
          .eq('profile_id', userId).is('materialized_from', null);
        const [{ count: cm }, { count: cy }] = await Promise.all([
          base().gte('date', mb.start).lte('date', mb.end),
          base().gte('date', yb.start).lte('date', yb.end),
        ]);
        if ((cm ?? 0) >= limits.transactions_per_month) {
          await showUsageLimitDialog({ entity, isPremium, limit: limits.transactions_per_month, scope: 'month' });
          return false;
        }
        if ((cy ?? 0) >= limits.transactions_per_year) {
          await showUsageLimitDialog({ entity, isPremium, limit: limits.transactions_per_year, scope: 'year' });
          return false;
        }
        return true;
      }

      const table = entity === 'account' ? 'accounts'
        : entity === 'project' ? 'projects'
        : entity === 'credit' ? 'credits'
        : 'ai_conversations';
      const limit = entity === 'account' ? limits.accounts
        : entity === 'project' ? limits.projects
        : entity === 'credit' ? limits.credits
        : limits.ai_conversations;
      const cnt = await countRows(table, userId);
      if (cnt >= limit) {
        await showUsageLimitDialog({ entity, isPremium, limit });
        return false;
      }
      return true;
    },
    [userId, cfg, isPremium],
  );

  return { guard };
}
