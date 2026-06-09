/**
 * useGamification — état de gamification de l'utilisateur (streak, gemmes, badges, inventaire)
 * + actions : valider la semaine (streak), évaluer/débloquer les succès, acheter en boutique.
 *
 * L'évaluation des badges est « data-driven » via la config admin (app_config.gamification).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useGamificationConfig } from './useGamificationConfig';
import { usePlan } from './usePlan';
import {
  mondayOf, weeksBetween, isUnlocked,
  type BadgeContext, type GamificationConfig,
} from '../lib/gamification';

export interface GamificationState {
  profile_id: string;
  streak: number;
  best_streak: number;
  last_validated_week: string | null;
  freezes: number;
  gems: number;
  gems_earned_total: number;
  tier: string;
  last_login_day: string | null;
  login_streak: number;
  best_login_streak: number;
}

/** Clé du jour (YYYY-MM-DD, heure locale). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface UserBadge { badge_key: string; unlocked_at: string }
export interface InventoryItem { item_key: string; qty: number }

async function fetchOrCreateState(userId: string): Promise<GamificationState> {
  const { data } = await supabase!.from('user_gamification').select('*').eq('profile_id', userId).maybeSingle();
  if (data) return data as GamificationState;
  const seed = { profile_id: userId, streak: 0, best_streak: 0, last_validated_week: null, freezes: 0, gems: 0, gems_earned_total: 0, tier: 'bronze', last_login_day: null, login_streak: 0, best_login_streak: 0 };
  // Idempotent : évite un conflit de clé si deux composants initialisent en même temps.
  await supabase!.from('user_gamification').upsert(seed, { onConflict: 'profile_id', ignoreDuplicates: true });
  const { data: after } = await supabase!.from('user_gamification').select('*').eq('profile_id', userId).maybeSingle();
  return (after ?? seed) as GamificationState;
}

export function useGamification(userId: string | undefined) {
  const qc = useQueryClient();
  const { data: config } = useGamificationConfig();
  const { isPremium } = usePlan(userId);

  const stateQuery = useQuery({
    queryKey: ['user_gamification', userId],
    queryFn: () => fetchOrCreateState(userId!),
    enabled: !!userId && !!supabase,
  });

  const badgesQuery = useQuery({
    queryKey: ['user_badges', userId],
    queryFn: async (): Promise<UserBadge[]> => {
      const { data } = await supabase!.from('user_badges').select('badge_key, unlocked_at').eq('profile_id', userId!);
      return (data ?? []) as UserBadge[];
    },
    enabled: !!userId && !!supabase,
  });

  const inventoryQuery = useQuery({
    queryKey: ['user_inventory', userId],
    queryFn: async (): Promise<InventoryItem[]> => {
      const { data } = await supabase!.from('user_inventory').select('item_key, qty').eq('profile_id', userId!);
      return (data ?? []) as InventoryItem[];
    },
    enabled: !!userId && !!supabase,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['user_gamification', userId] });
    qc.invalidateQueries({ queryKey: ['user_badges', userId] });
    qc.invalidateQueries({ queryKey: ['user_inventory', userId] });
  };

  /** Évalue les badges selon le contexte fourni + métriques internes (streak, gemmes).
   *  opts.closureEnabled = false → on ignore les badges liés à la clôture (métrique closures_count). */
  async function evaluate(ctx: BadgeContext = {}, opts?: { closureEnabled?: boolean }, cfg?: GamificationConfig) {
    if (!userId || !supabase) return;
    const conf = cfg ?? config;
    if (!conf) return;
    const closureEnabled = opts?.closureEnabled ?? true;
    const { data: stateRow } = await supabase.from('user_gamification').select('*').eq('profile_id', userId).maybeSingle();
    const state = (stateRow ?? await fetchOrCreateState(userId)) as GamificationState;
    const { data: badgeRows } = await supabase.from('user_badges').select('badge_key').eq('profile_id', userId);
    const unlocked = new Set<string>((badgeRows ?? []).map((b: any) => b.badge_key));

    const fullCtx: BadgeContext = {
      streak_weeks: state.best_streak,
      gems_earned: state.gems_earned_total,
      login_streak_days: state.login_streak ?? 0,
      ...ctx,
    };

    let gemsToAdd = 0;
    const upserts: { profile_id: string; badge_key: string; unlocked_at: string }[] = [];
    for (const def of conf.badges) {
      // Succès lié à la clôture désactivé si la fonctionnalité Clôture est off.
      if (def.metric === 'closures_count' && !closureEnabled) continue;
      if (unlocked.has(def.key)) continue;          // déjà débloqué
      if (!isUnlocked(def, fullCtx)) continue;       // seuil non atteint
      gemsToAdd += def.gems ?? 0;
      upserts.push({ profile_id: userId, badge_key: def.key, unlocked_at: new Date().toISOString() });
    }

    if (upserts.length > 0) {
      await supabase.from('user_badges').upsert(upserts, { onConflict: 'profile_id,badge_key' });
    }
    if (gemsToAdd > 0) {
      await supabase.from('user_gamification').update({
        gems: state.gems + gemsToAdd,
        gems_earned_total: state.gems_earned_total + gemsToAdd,
        updated_at: new Date().toISOString(),
      }).eq('profile_id', userId);
    }
    if (upserts.length > 0 || gemsToAdd > 0) invalidate();
    return { newBadges: upserts.length, gemsAwarded: gemsToAdd };
  }

  /** Enregistre la connexion du jour et met à jour la série quotidienne. À appeler une fois
   *  par ouverture d'app. Renvoie la série quotidienne en cours (jours consécutifs). */
  async function recordLogin(): Promise<number> {
    if (!userId || !supabase) return 0;
    const state = await fetchOrCreateState(userId);
    const today = dayKey(new Date());
    if (state.last_login_day === today) return state.login_streak ?? 0;
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    const newStreak = state.last_login_day === yesterday ? (state.login_streak ?? 0) + 1 : 1;
    const best = Math.max(state.best_login_streak ?? 0, newStreak);
    await supabase.from('user_gamification').update({
      last_login_day: today, login_streak: newStreak, best_login_streak: best,
      updated_at: new Date().toISOString(),
    }).eq('profile_id', userId);
    invalidate();
    return newStreak;
  }

  /** Valide la semaine en cours (incrémente le streak) — à appeler lors d'une activité. */
  async function validateWeek(extraCtx: BadgeContext = {}, opts?: { closureEnabled?: boolean }) {
    if (!userId || !supabase || !config) return;
    const state = await fetchOrCreateState(userId);
    const currentMonday = mondayOf(new Date());
    if (state.last_validated_week === currentMonday) {
      // Semaine déjà validée → on (ré)évalue seulement les badges.
      await evaluate(extraCtx, opts);
      return;
    }
    let streak = state.streak;
    let freezes = state.freezes;
    if (!state.last_validated_week) {
      streak = 1;
    } else {
      const gap = weeksBetween(state.last_validated_week, currentMonday);
      if (gap <= 0) { await evaluate(extraCtx, opts); return; }
      if (gap === 1) streak += 1;
      else {
        const missed = gap - 1;
        if (freezes >= missed) { freezes -= missed; streak += 1; }
        else streak = 1;
      }
    }
    const weeklyGems = config.streak.weeklyGems;
    const best = Math.max(state.best_streak, streak);
    await supabase.from('user_gamification').update({
      streak, best_streak: best, freezes, last_validated_week: currentMonday,
      gems: state.gems + weeklyGems, gems_earned_total: state.gems_earned_total + weeklyGems,
      updated_at: new Date().toISOString(),
    }).eq('profile_id', userId);
    invalidate();
    await evaluate(extraCtx, opts);
  }

  /** Achat boutique : débite les gemmes, crédite l'inventaire (gel → +1 freeze). */
  async function buyItem(itemKey: string): Promise<{ ok: boolean; reason?: string }> {
    if (!userId || !supabase || !config) return { ok: false, reason: 'non disponible' };
    const item = config.shop.find((s) => s.key === itemKey);
    if (!item) return { ok: false, reason: 'article introuvable' };
    const state = await fetchOrCreateState(userId);
    const price = isPremium ? Math.round(item.price * (1 - config.premium_discount_pct / 100)) : item.price;
    if (state.gems < price) return { ok: false, reason: 'gemmes insuffisantes' };

    const patch: Record<string, unknown> = { gems: state.gems - price, updated_at: new Date().toISOString() };
    if (item.type === 'freeze') patch.freezes = state.freezes + 1;
    await supabase.from('user_gamification').update(patch).eq('profile_id', userId);
    if (item.type !== 'freeze') {
      const { data: existing } = await supabase.from('user_inventory').select('qty').eq('profile_id', userId).eq('item_key', itemKey).maybeSingle();
      await supabase.from('user_inventory').upsert(
        { profile_id: userId, item_key: itemKey, qty: (existing?.qty ?? 0) + 1 },
        { onConflict: 'profile_id,item_key' },
      );
    }
    invalidate();
    return { ok: true };
  }

  return {
    state: stateQuery.data,
    badges: badgesQuery.data ?? [],
    inventory: inventoryQuery.data ?? [],
    config,
    isLoading: stateQuery.isLoading,
    validateWeek,
    recordLogin,
    evaluate,
    buyItem,
  };
}
