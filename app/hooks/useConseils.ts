/**
 * useConseils — sélectionne et affiche le conseil du jour (1 général + 1 contextuel max).
 * - Général : rotation cyclique sur la liste active, 1 par jour.
 * - Contextuel : 1er critère actif correspondant aux données de l'utilisateur, 1 par jour.
 * - Fermé par l'utilisateur (croix) → dismissed pour aujourd'hui.
 */
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { PilotageData } from './usePilotageData';
import { computeMonthlyForecast } from '../lib/forecast';

export interface Conseil {
  id: string;
  type: 'general' | 'contextuel';
  message: string;
  critere_key: string | null;
  display_order: number;
  active: boolean;
}

export interface ConsilDuJour {
  general: Conseil | null;
  contextuel: Conseil | null;
}

/** Remplace les variables {accolades} par des vraies valeurs. */
export function interpolate(msg: string, vars: Record<string, string | number>): string {
  return msg.replace(/\{([^}]+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// ── Évaluation des critères contextuels ──────────────────────────────────────

export function evalCriteres(pilotage: PilotageData, transactions: any[], projects: any[], accounts: any[] = []): {
  key: string;
  vars: Record<string, string | number>;
}[] {
  const active: { key: string; vars: Record<string, string | number> }[] = [];
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

  // ── Vague 2 : conseils basés sur la trésorerie FUTURE (projection 6 mois) ──
  // Utile notamment pour les revenus irréguliers : on projette les soldes des prochains mois.
  if (accounts.length > 0) {
    const forecast = computeMonthlyForecast({
      transactions,
      accounts,
      variableMonthly: pilotage.variable_envelope_initial ?? 0,
      variableRemaining: pilotage.variable_envelope_remaining ?? 0,
      monthsCount: 6,
    });
    const currentBalance = pilotage.total_checking;
    const nextMonth = forecast[1];
    const lastMonth = forecast[forecast.length - 1];
    // Premier mois futur (hors mois courant) où le solde prévu devient négatif.
    const firstNegative = forecast.slice(1).find((m) => m.balance < 0);

    // 1. Mois prochain dans le rouge (priorité haute — revenus irréguliers, futur non saisi).
    if (nextMonth && nextMonth.balance < 0) {
      active.push({ key: 'treso_negatif_mois_prochain', vars: { mois: nextMonth.label, solde: fmt(nextMonth.balance) } });
    }
    // 2. Un des 6 prochains mois passe dans le rouge (si ce n'est pas déjà le mois prochain).
    if (firstNegative && !(nextMonth && nextMonth.balance < 0)) {
      active.push({ key: 'treso_negatif_6mois', vars: { mois: firstNegative.label, solde: fmt(firstNegative.balance) } });
    }
    // 3. Trésorerie qui s'érode : solde à 6 mois nettement plus bas qu'aujourd'hui (mais positif).
    if (lastMonth && lastMonth.balance >= 0 && currentBalance > 0 && lastMonth.balance < currentBalance * 0.5) {
      active.push({ key: 'treso_erosion_6mois', vars: { solde: fmt(lastMonth.balance), baisse: fmt(currentBalance - lastMonth.balance) } });
    }
    // 4. Trésorerie solide → poussé en fin de liste (priorité basse, voir plus bas).
  }

  // argent_qui_dort : courant > optimal + 3 000 ET investissements < 20% du courant
  if (pilotage.total_checking > pilotage.safety_threshold_optimal + 3000 && pilotage.total_invested < pilotage.total_checking * 0.2) {
    active.push({ key: 'argent_qui_dort', vars: { checking: fmt(pilotage.total_checking) } });
  }

  // epargne_confortable : savings ≥ 6 mois de charges fixes
  const monthlyFixed = (pilotage.remaining_fixed_expenses + pilotage.committed_allocations) || 1000;
  const savingsMonths = Math.floor(pilotage.total_savings / monthlyFixed);
  if (savingsMonths >= 6) {
    active.push({ key: 'epargne_confortable', vars: { savings_months: savingsMonths } });
  }

  // epargne_insuffisante : savings < 2 mois de charges
  if (savingsMonths < 2) {
    active.push({ key: 'epargne_insuffisante', vars: {} });
  }

  // budget_libre_inexploite : budget libre > 400 ET aucun virement récurrent vers épargne
  const hasRecurringSavings = transactions.some((t: any) => t.is_recurring && t.amount > 0 && t.linked_account?.type === 'savings');
  if (pilotage.safe_to_spend > 400 && !hasRecurringSavings) {
    active.push({ key: 'budget_libre_inexploite', vars: { budgetlibre: fmt(pilotage.safe_to_spend) } });
  }

  // budget_negatif : budget libre < 0
  if (pilotage.safe_to_spend < 0) {
    active.push({ key: 'budget_negatif', vars: {} });
  }

  // investissement_depasse_epargne
  if (pilotage.monthly_invest_planned > pilotage.monthly_savings_planned && pilotage.total_savings < pilotage.safety_threshold_optimal) {
    active.push({ key: 'investissement_depasse_epargne', vars: {} });
  }

  // patrimoine_trop_liquide : épargne liquide > 70% patrimoine & patrimoine > 20 000
  const patrimoine = pilotage.total_savings + pilotage.total_invested;
  if (patrimoine > 20000 && pilotage.total_savings > patrimoine * 0.7) {
    active.push({ key: 'patrimoine_trop_liquide', vars: {} });
  }

  // projet_sans_versement : projet > 60 jours, 0% avancé
  for (const p of projects) {
    if (p.status !== 'active') continue;
    const created = new Date(p.created_at ?? '2000-01-01');
    const daysSince = Math.floor((Date.now() - created.getTime()) / 86400000);
    const progress = pilotage.projects_with_progress?.find((pp: any) => pp.id === p.id);
    if (daysSince > 60 && progress && progress.progress_percentage < 1) {
      active.push({ key: 'projet_sans_versement', vars: { projet_nom: p.name, projet_jours: daysSince } });
      break;
    }
  }

  // projet_en_retard : délai < 3 mois et avancement < 50%
  for (const p of projects) {
    if (p.status !== 'active' || !p.target_date) continue;
    const msLeft = new Date(p.target_date).getTime() - Date.now();
    const monthsLeft = msLeft / (1000 * 60 * 60 * 24 * 30);
    const progress = pilotage.projects_with_progress?.find((pp: any) => pp.id === p.id);
    if (monthsLeft < 3 && monthsLeft > 0 && progress && progress.progress_percentage < 50) {
      active.push({ key: 'projet_en_retard', vars: { projet_nom: p.name, delai: Math.ceil(monthsLeft), pct: Math.round(progress.progress_percentage) } });
      break;
    }
  }

  // treso_solide_6mois : priorité basse (réassurance / opportunité), poussé en dernier
  // pour ne pas masquer un conseil plus actionnable.
  if (accounts.length > 0) {
    const forecast = computeMonthlyForecast({
      transactions, accounts,
      variableMonthly: pilotage.variable_envelope_initial ?? 0,
      variableRemaining: pilotage.variable_envelope_remaining ?? 0,
      monthsCount: 6,
    });
    const lastMonth = forecast[forecast.length - 1];
    const currentBalance = pilotage.total_checking;
    if (lastMonth && currentBalance > 0 && lastMonth.balance >= currentBalance && lastMonth.balance > 0) {
      active.push({ key: 'treso_solide_6mois', vars: { solde: fmt(lastMonth.balance) } });
    }
  }

  return active;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Charge tous les conseils actifs depuis la base. */
export function useAllConseils() {
  return useQuery({
    queryKey: ['conseils'],
    queryFn: async (): Promise<Conseil[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('conseils').select('*').eq('active', true).order('display_order');
      if (error) throw error;
      return (data ?? []) as Conseil[];
    },
    staleTime: 1000 * 60 * 10,
  });
}

/** Charge les IDs des conseils déjà vus/fermés aujourd'hui pour cet utilisateur. */
export function useConsilsSeenToday(userId: string | undefined) {
  return useQuery({
    queryKey: ['conseils_seen', userId, todayISO()],
    queryFn: async (): Promise<{ conseil_id: string; dismissed: boolean }[]> => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase.from('user_conseil_seen').select('conseil_id, dismissed').eq('profile_id', userId).eq('seen_date', todayISO());
      if (error) throw error;
      return (data ?? []) as any;
    },
    enabled: !!userId,
  });
}

/** Marque un conseil comme vu (inséré) ou fermé (update). */
export function useMarkConseilSeen(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conseilId, dismissed }: { conseilId: string; dismissed: boolean }) => {
      if (!supabase || !userId) return;
      await supabase.from('user_conseil_seen').upsert({ profile_id: userId, conseil_id: conseilId, seen_date: todayISO(), dismissed }, { onConflict: 'profile_id,conseil_id,seen_date' });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conseils_seen', userId] }); },
  });
}

/** Hook principal : renvoie le conseil du jour (général + contextuel) + actions. */
export function useConseilDuJour(userId: string | undefined, pilotage: PilotageData | undefined, transactions: any[], projects: any[], accounts: any[] = []): {
  general: (Conseil & { vars: Record<string, string | number> }) | null;
  contextuel: (Conseil & { vars: Record<string, string | number> }) | null;
  dismiss: (id: string) => void;
} {
  const { data: all = [] } = useAllConseils();
  const { data: seenToday = [] } = useConsilsSeenToday(userId);
  const markSeen = useMarkConseilSeen(userId);

  const dismissedIds = React.useMemo(
    () => new Set(seenToday.filter((s) => s.dismissed).map((s) => s.conseil_id)),
    [seenToday]
  );

  const today = new Date();
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);

  // Général : 1 SEUL conseil par jour, choisi de façon déterministe sur la liste complète
  // (rotation par jour de l'année). On NE retire PAS les conseils fermés AVANT de choisir,
  // sinon fermer le conseil du jour en ferait apparaître un autre. On choisit d'abord le
  // conseil du jour, puis on le masque s'il a été fermé → plus rien jusqu'au lendemain.
  const generalsAll = all.filter((c) => c.type === 'general');
  const generalPick = generalsAll.length > 0 ? generalsAll[dayOfYear % generalsAll.length] : null;
  const general = generalPick && !dismissedIds.has(generalPick.id) ? generalPick : null;

  // Contextuel : 1 SEUL conseil par jour = celui du 1er critère actif. Même principe :
  // on fige le choix avant de tester la fermeture, donc fermer le conseil « Pour vous »
  // ne le remplace pas par un autre — il disparaît jusqu'au lendemain.
  let contextuel: (Conseil & { vars: Record<string, string | number> }) | null = null;
  if (pilotage) {
    const activeCriteres = evalCriteres(pilotage, transactions, projects, accounts);
    const contextuelsAll = all.filter((c) => c.type === 'contextuel');
    for (const { key, vars } of activeCriteres) {
      const match = contextuelsAll.find((c) => c.critere_key === key);
      if (match) {
        // Premier critère actif trouvé = conseil contextuel du jour (fermé ⇒ masqué, pas remplacé).
        contextuel = dismissedIds.has(match.id) ? null : { ...match, vars };
        break;
      }
    }
  }

  const dismiss = React.useCallback((id: string) => markSeen.mutate({ conseilId: id, dismissed: true }), [markSeen]);

  return {
    general: general ? { ...general, vars: {} } : null,
    contextuel,
    dismiss,
  };
}
