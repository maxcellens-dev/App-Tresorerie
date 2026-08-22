/**
 * useGamification — état de gamification de l'utilisateur (streak, gemmes, badges, inventaire)
 * + actions : valider la semaine (streak), évaluer/débloquer les succès, acheter en boutique.
 *
 * L'évaluation des badges est « data-driven » via la config admin (app_config.gamification).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useGamificationConfig } from './useGamificationConfig';
import { usePlan } from '../config/usePlan';
import {
  mondayOf, isUnlocked, isUniqueItem, shopFinalPrice,
  type BadgeContext, type GamificationConfig,
} from '../../lib/engagement/gamification';
import { emitStreakBump } from '../../lib/engagement/streakBump';

export interface GamificationState {
  profile_id: string;
  /** Nombre de semaines où l'utilisateur est venu. NE REDESCEND JAMAIS (cf. validateWeek). */
  streak: number;
  /** Conservé pour l'historique : depuis que la série ne redescend plus, il vaut toujours `streak`. */
  best_streak: number;
  last_validated_week: string | null;
  gems: number;
  gems_earned_total: number;
  tier: string;
  last_login_day: string | null;
  login_streak: number;
  best_login_streak: number;
  last_free_gems_day: string | null;
}

/** Clé du jour (YYYY-MM-DD, heure locale). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface UserBadge { badge_key: string; unlocked_at: string; celebrated_at: string | null }
export interface InventoryItem { item_key: string; qty: number }

/** Graine d'un compte qui n'a encore aucune ligne de gamification. */
function seedState(userId: string): GamificationState {
  return { profile_id: userId, streak: 0, best_streak: 0, last_validated_week: null, gems: 0, gems_earned_total: 0, tier: 'bronze', last_login_day: null, login_streak: 0, best_login_streak: 0, last_free_gems_day: null };
}

/**
 * `canSeed = false` → on ne CRÉE pas la ligne manquante.
 *
 * En « connecté en tant que », le jeton reste celui de l'administrateur : la RLS de
 * `user_gamification` (profil = auth.uid(), sans branche admin) ne rend aucune ligne pour la
 * personne visitée. On tentait alors de créer sa ligne — une ÉCRITURE sur le compte de quelqu'un
 * d'autre, refusée en 403, qui faisait tomber toute la page Succès en erreur. Consulter doit rester
 * consulter : on renvoie une graine en mémoire, et l'écran dit franchement que ces données ne sont
 * pas lisibles depuis un autre compte.
 */
async function fetchOrCreateState(userId: string, canSeed = true): Promise<GamificationState> {
  const { data, error } = await supabase!.from('user_gamification').select('*').eq('profile_id', userId).maybeSingle();
  /* ⚠️ LEVER, et surtout pas retomber sur la graine à zéro.
     `maybeSingle()` distingue déjà « aucune ligne » (data null, error null) d'un ÉCHEC de lecture.
     Confondre les deux était destructeur : `validateWeek` repart de l'état renvoyé ici et ÉCRIT
     `streak: state.streak + 1` et `gems: state.gems + …`. Une lecture ratée rendait donc une série
     de 0 et 0 gemme → la mise à jour écrasait en base la vraie série (remise à 1) et vidait les
     gemmes. La flamme ne redescend JAMAIS : c'est ici que ça se garantit. */
  if (error) throw error;
  if (data) return data as GamificationState;
  const seed = seedState(userId);
  if (!canSeed) return seed;
  // Idempotent : évite un conflit de clé si deux composants initialisent en même temps.
  const { error: seedError } = await supabase!.from('user_gamification').upsert(seed, { onConflict: 'profile_id', ignoreDuplicates: true });
  if (seedError) throw seedError;
  const { data: after, error: reReadError } = await supabase!.from('user_gamification').select('*').eq('profile_id', userId).maybeSingle();
  if (reReadError) throw reReadError;
  return (after ?? seed) as GamificationState;
}

export function useGamification(userId: string | undefined) {
  const qc = useQueryClient();
  const { data: config } = useGamificationConfig();
  const { isPremium } = usePlan(userId);
  // Consultation admin : aucune écriture, et les lectures ne renvoient rien (RLS « chacun ses
  // lignes ») → les écrans doivent le SAVOIR plutôt qu'afficher des zéros.
  const { isImpersonating } = useAuth();

  const stateQuery = useQuery({
    queryKey: ['user_gamification', userId],
    queryFn: () => fetchOrCreateState(userId!, !isImpersonating),
    enabled: !!userId && !!supabase,
  });

  const badgesQuery = useQuery({
    queryKey: ['user_badges', userId],
    queryFn: async (): Promise<UserBadge[]> => {
      // Erreur de lecture ≠ « aucun succès » : sans ce test, une panne réseau vidait la page Succès
      // et pouvait faire rejouer des célébrations déjà vues (celebrated_at perdu de vue).
      const { data, error } = await supabase!.from('user_badges').select('badge_key, unlocked_at, celebrated_at').eq('profile_id', userId!);
      if (error) throw error;
      return (data ?? []) as UserBadge[];
    },
    enabled: !!userId && !!supabase,
  });

  const inventoryQuery = useQuery({
    queryKey: ['user_inventory', userId],
    queryFn: async (): Promise<InventoryItem[]> => {
      // Idem : une lecture en échec faisait disparaître les articles déjà achetés de l'inventaire.
      const { data, error } = await supabase!.from('user_inventory').select('item_key, qty').eq('profile_id', userId!);
      if (error) throw error;
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
    /* ⚠️ Cette liste sert à SAUTER les succès déjà débloqués. Une lecture en échec la rendait vide :
       on re-upsertait alors TOUS les succès (leur `unlocked_at` repartait à maintenant) et on
       recréditait leurs gemmes une seconde fois. Une erreur doit interrompre l'évaluation. */
    const { data: badgeRows, error: badgesError } = await supabase.from('user_badges').select('badge_key').eq('profile_id', userId);
    if (badgesError) throw badgesError;
    const unlocked = new Set<string>((badgeRows ?? []).map((b: any) => b.badge_key));

    const fullCtx: BadgeContext = {
      // La série ne redescend plus : sa valeur COURANTE est aussi son maximum.
      streak_weeks: state.streak,
      gems_earned: state.gems_earned_total,
      login_streak_days: state.login_streak ?? 0,
      ...ctx,
    };

    const gemsByKey = new Map<string, number>();
    const upserts: { profile_id: string; badge_key: string; unlocked_at: string }[] = [];
    for (const def of conf.badges) {
      // Succès lié à la clôture désactivé si la fonctionnalité Clôture est off.
      if ((def.metric === 'closures_count' || def.metric === 'consecutive_closures') && !closureEnabled) continue;
      if (unlocked.has(def.key)) continue;          // déjà débloqué
      if (!isUnlocked(def, fullCtx)) continue;       // seuil non atteint
      if (gemsByKey.has(def.key)) continue;          // config admin avec une clé en double
      gemsByKey.set(def.key, Math.max(0, Number(def.gems) || 0));
      upserts.push({ profile_id: userId, badge_key: def.key, unlocked_at: new Date().toISOString() });
    }

    if (upserts.length === 0) return { newBadges: 0, gemsAwarded: 0 };

    /* ⚠️ ON NE PAIE QUE CE QU'ON A RÉELLEMENT ENREGISTRÉ.
       Avant : l'écriture des succès n'était pas vérifiée et les relyks étaient crédités juste
       derrière, quoi qu'il arrive. Deux conséquences, l'une comme l'autre bien réelles :
         • écriture en échec (réseau coupé, RLS) → relyks crédités pour un succès non enregistré.
           Au passage suivant, le succès manquait toujours à l'appel : on repayait. À chaque
           ouverture. C'est un robinet à relyks ouvert par une simple panne réseau.
         • deux appareils (ou deux onglets) en même temps → les deux voyaient le succès comme
           « pas encore débloqué » et le créditaient chacun leur tour.
       `ignoreDuplicates` (ON CONFLICT DO NOTHING) + `select()` : la base nous rend les lignes
       qu'elle a VRAIMENT insérées. On crédite exactement celles-là, une seule fois. Un doublon de
       course rend une liste vide → aucun relyk en double. */
    const { data: inserted, error: upsertError } = await supabase
      .from('user_badges')
      .upsert(upserts, { onConflict: 'profile_id,badge_key', ignoreDuplicates: true })
      .select('badge_key');
    if (upsertError) throw upsertError;

    const awardedKeys = (inserted ?? []).map((r: any) => r.badge_key as string);
    const gemsToAdd = awardedKeys.reduce((sum, k) => sum + (gemsByKey.get(k) ?? 0), 0);

    if (gemsToAdd > 0) {
      /* La récompense n'est plus rattrapable une fois le succès enregistré (il ne repassera plus
         dans la boucle) : une erreur ici doit remonter, pas disparaître. `GamificationSync` la
         rattrape et réarme sa signature → nouvelle tentative à la prochaine occasion. */
      const { error: gemsError } = await supabase.from('user_gamification').update({
        gems: state.gems + gemsToAdd,
        gems_earned_total: state.gems_earned_total + gemsToAdd,
        updated_at: new Date().toISOString(),
      }).eq('profile_id', userId);
      if (gemsError) { invalidate(); throw gemsError; }
    }
    invalidate();
    return { newBadges: awardedKeys.length, gemsAwarded: gemsToAdd };
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

  /**
   * Valide la semaine en cours — appelée à chaque OUVERTURE de l'app.
   *
   * LA SÉRIE NE FAIT QUE MONTER. On compte les semaines où l'utilisateur EST VENU (une visite entre
   * lundi et dimanche suffit) et on ignore purement et simplement celles où il n'est pas venu :
   * qu'il ait manqué une semaine ou six mois ne change rien, sa prochaine visite fait +1. Plus de
   * remise à zéro, donc plus de gels, plus de rachat, plus d'alerte « ta série est en danger ».
   *
   * L'incrément est ANNONCÉ (lib/streakBump) pour que la pastille de l'en-tête le mette en scène.
   */
  async function validateWeek(extraCtx: BadgeContext = {}, opts?: { closureEnabled?: boolean }) {
    if (!userId || !supabase || !config) return;
    const state = await fetchOrCreateState(userId);
    const currentMonday = mondayOf(new Date());
    if (state.last_validated_week === currentMonday) {
      // Semaine déjà validée → on (ré)évalue seulement les badges.
      await evaluate(extraCtx, opts);
      return;
    }
    const streak = state.streak + 1;
    const weeklyGems = config.streak.weeklyGems;
    await supabase.from('user_gamification').update({
      // `best_streak` suit la série : elle ne redescend plus, les deux sont désormais confondus.
      streak, best_streak: streak, last_validated_week: currentMonday,
      gems: state.gems + weeklyGems, gems_earned_total: state.gems_earned_total + weeklyGems,
      updated_at: new Date().toISOString(),
    }).eq('profile_id', userId);
    invalidate();
    // En consultation admin, on ne fête pas la semaine de quelqu'un d'autre (validateWeek n'est de
    // toute façon pas appelée dans ce mode — garde-fou de lisibilité).
    emitStreakBump({ userId, from: state.streak, to: streak });
    await evaluate(extraCtx, opts);
  }

  /** Achat boutique en gemmes : débite les gemmes, applique l'effet, crédite l'inventaire si besoin. */
  async function buyItem(itemKey: string): Promise<{ ok: boolean; reason?: string }> {
    if (!userId || !supabase || !config) return { ok: false, reason: 'non disponible' };
    const item = config.shop.find((s) => s.key === itemKey);
    if (!item) return { ok: false, reason: 'article introuvable' };
    const state = await fetchOrCreateState(userId);

    // Cadeau du jour : 5 gemmes gratuites, 1×/jour.
    if (item.type === 'daily_gems') {
      const today = dayKey(new Date());
      if (state.last_free_gems_day === today) return { ok: false, reason: 'déjà réclamé aujourd’hui' };
      const reward = Number((item.payload as any)?.gems) || 5;
      /* L'erreur DOIT être lue : sans ça, un crédit refusé (réseau, RLS) renvoyait quand même
         « ok », l'écran affichait « Acheté ✓ » et le cadeau n'était nulle part. */
      const { error: giftError } = await supabase.from('user_gamification').update({
        gems: state.gems + reward,
        gems_earned_total: state.gems_earned_total + reward,
        last_free_gems_day: today,
        updated_at: new Date().toISOString(),
      }).eq('profile_id', userId);
      if (giftError) return { ok: false, reason: 'le cadeau n’a pas pu être enregistré, réessaie' };
      invalidate();
      return { ok: true };
    }

    // Les packs de gemmes (gems_iap) se paient en argent réel → gérés via purchaseGemsPack, pas ici.
    if (item.type === 'gems_iap') return { ok: false, reason: 'achat en argent réel' };

    // Article exclusif Premium : verrouillé pour les non-abonnés (visible mais figé en boutique).
    if (item.premiumOnly && !isPremium) return { ok: false, reason: 'réservé aux abonnés Premium' };

    // Produit unique (couleurs, cosmétiques, thèmes) : déblocage permanent → un seul achat possible.
    if (isUniqueItem(item)) {
      // Lecture en échec ≠ « pas encore acquis » : sans ce test, l'article unique pouvait être
      // racheté (et repayé) alors qu'il était déjà dans l'inventaire.
      const { data: owned, error: ownedError } = await supabase.from('user_inventory').select('qty').eq('profile_id', userId).eq('item_key', itemKey).maybeSingle();
      if (ownedError) return { ok: false, reason: 'vérification impossible, réessaie' };
      if ((owned?.qty ?? 0) > 0) return { ok: false, reason: 'déjà acquis' };
    }

    // Prix final = remise Premium le cas échéant (il n'y a plus d'autre remise).
    const price = shopFinalPrice(item.price, { isPremium, premiumPct: config.premium_discount_pct });
    if (state.gems < price) return { ok: false, reason: 'relyks insuffisants' };

    /* ── PAYER PUIS LIVRER, ET VÉRIFIER LES DEUX ────────────────────────────────────────────────
       Aucune de ces deux écritures ne lisait son erreur. Les deux issues étaient réelles :
         • DÉBIT en échec → l'article était livré quand même, gratuitement ;
         • LIVRAISON en échec → les relyks étaient partis et l'écran affichait « Acheté ✓ ».
       On débite d'abord (on ne livre jamais sans paiement), puis on livre — et si la livraison
       échoue, on REND les relyks : sans transaction côté base, c'est la seule façon de ne pas
       laisser quelqu'un payer pour rien. */
    const { error: debitError } = await supabase.from('user_gamification')
      .update({ gems: state.gems - price, updated_at: new Date().toISOString() })
      .eq('profile_id', userId);
    if (debitError) return { ok: false, reason: 'le paiement n’a pas pu être enregistré, réessaie' };

    /* ⚠️ Lecture avalée + upsert derrière = stock détruit : une erreur ici rendait `existing` null,
       et la quantité de l'article était RÉÉCRITE à 1 par-dessus les exemplaires déjà possédés. */
    const { data: existing, error: existingError } = await supabase.from('user_inventory').select('qty').eq('profile_id', userId).eq('item_key', itemKey).maybeSingle();
    const { error: grantError } = existingError ? { error: existingError } : await supabase.from('user_inventory').upsert(
      { profile_id: userId, item_key: itemKey, qty: (existing?.qty ?? 0) + 1 },
      { onConflict: 'profile_id,item_key' },
    );
    if (grantError) {
      // Remboursement (le verrou de l'écran garantit qu'aucun autre achat n'a bougé le solde entre-temps).
      await supabase.from('user_gamification')
        .update({ gems: state.gems, updated_at: new Date().toISOString() })
        .eq('profile_id', userId);
      invalidate();
      return { ok: false, reason: 'l’article n’a pas pu être livré — tes relyks t’ont été rendus' };
    }
    invalidate();
    return { ok: true };
  }

  /** Marque des succès comme « célébrés » (côté compte) → la célébration ne réapparaît plus,
   *  quel que soit l'appareil. Idempotent : ne touche que les lignes pas encore célébrées. */
  async function markBadgesCelebrated(keys: string[]): Promise<void> {
    if (!userId || !supabase || keys.length === 0) return;
    await supabase.from('user_badges')
      .update({ celebrated_at: new Date().toISOString() })
      .eq('profile_id', userId)
      .in('badge_key', keys)
      .is('celebrated_at', null);
    qc.invalidateQueries({ queryKey: ['user_badges', userId] });
  }

  /** Crédite des gemmes (après un achat en argent réel validé par le store / RevenueCat). */
  async function creditGems(amount: number): Promise<{ ok: boolean }> {
    if (!userId || !supabase || amount <= 0) return { ok: false };
    /* Appelée APRÈS un achat en argent réel : on ne laisse pas passer une erreur en silence. Elle
       est renvoyée comme `ok: false` pour que l'écran le DISE — avant, une lecture ratée renvoyait
       un état à zéro et l'écriture derrière remettait le solde de relyks à la valeur du seul pack
       acheté, effaçant tout ce que l'utilisateur avait déjà. */
    try {
      const state = await fetchOrCreateState(userId);
      const { error } = await supabase.from('user_gamification').update({
        gems: state.gems + amount,
        gems_earned_total: state.gems_earned_total + amount,
        updated_at: new Date().toISOString(),
      }).eq('profile_id', userId);
      if (error) throw error;
      invalidate();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /** true si le cadeau du jour est encore réclamable aujourd'hui. */
  const canClaimDailyGems = (stateQuery.data?.last_free_gems_day ?? null) !== dayKey(new Date());

  return {
    state: stateQuery.data,
    badges: badgesQuery.data ?? [],
    inventory: inventoryQuery.data ?? [],
    config,
    isLoading: stateQuery.isLoading,
    /* Un écran ne doit pas afficher « 0 relyk, 0 succès » tant qu'il ne SAIT pas.
       `isSuccess` (et jamais `isFetched`, vrai aussi après un échec) : tant que les trois sources
       ne sont pas là, on attend ; si l'une échoue, on le dit. */
    isReady: stateQuery.isSuccess && badgesQuery.isSuccess && !!config,
    isError: stateQuery.isError || badgesQuery.isError,
    refetch: () => {
      stateQuery.refetch();
      badgesQuery.refetch();
    },
    isImpersonating,
    validateWeek,
    recordLogin,
    evaluate,
    buyItem,
    creditGems,
    markBadgesCelebrated,
    canClaimDailyGems,
  };
}
