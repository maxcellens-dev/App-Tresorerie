/**
 * Écran Succès — grille de trophées débloquables (style Duolingo).
 * Chaque badge montre son icône/image, son niveau atteint (Bronze/Argent/Or) et sa description.
 */
import { useMemo, useEffect, useState } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import { useAuth } from '../../../contexts/AuthContext';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useGamification } from '../../../hooks/engagement/useGamification';
import { useMonthClosures } from '../../../hooks/pilotage/useMonthlyClosure';
import { useFeatureFlags } from '../../../hooks/config/useFeatureFlags';
import { useProfile } from '../../../hooks/data/useProfile';
import { useTransactions } from '../../../hooks/data/useTransactions';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { buildBadgeMetrics } from '../../../lib/engagement/badgeMetrics';
import { UNLOCK_COLOR, WELCOME_BADGE_KEY, isImageIcon, currencyPlural, type BadgeDef } from '../../../lib/engagement/gamification';

/**
 * Icône d'un succès : image téléversée en admin, ou pictogramme Ionicons.
 *
 * Une URL cassée (image supprimée du bucket, adresse mal saisie) laissait un carré vide, sans rien
 * pour comprendre de quel trophée il s'agissait. On retombe alors sur le pictogramme par défaut.
 */
function BadgeIcon({ icon, size, tint, imgStyle }: { icon: string; size: number; tint: string; imgStyle: any }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [icon]);
  if (isImageIcon(icon) && !broken) {
    return <Image source={{ uri: icon }} style={imgStyle} onError={() => setBroken(true)} />;
  }
  const name = isImageIcon(icon) || !icon ? 'trophy' : icon;
  return <Ionicons name={name as any} size={size} color={tint} />;
}

export default withDeferredMount(SuccesScreen);
function SuccesScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user, isImpersonating } = useAuth();
  const { state, badges, config, markBadgesCelebrated, isReady, isError, refetch } = useGamification(user?.id);
  /* On lit les clôtures et le réglage DIRECTEMENT, au lieu de monter `useMonthlyClosure` : ce
     dernier tire le profil, toutes les transactions ET déclenche le marquage automatique des mois
     « estimés » — une ÉCRITURE, ici parfaitement hors sujet, qui partait à chaque ouverture de la
     page Succès (et visait le compte d'autrui en consultation admin). Consulter ses trophées ne
     doit rien modifier. */
  const { data: flags } = useFeatureFlags();
  const closureEnabled = Boolean(flags?.monthly_closure_enabled);
  const { data: closures = [] } = useMonthClosures(user?.id);
  const { data: profile } = useProfile(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);

  // « Bienvenue » est consommé ici (et non en pop-up) : à la 1ʳᵉ visite de la page Succès,
  // on le marque célébré s'il ne l'est pas encore. Idempotent → no-op aux visites suivantes.
  // En consultation admin : on ne consomme PAS le badge du compte cible (laissé à l'utilisateur).
  useEffect(() => {
    if (isImpersonating) return;
    const welcome = badges.find((b) => b.badge_key === WELCOME_BADGE_KEY && !b.celebrated_at);
    if (welcome) markBadgesCelebrated([WELCOME_BADGE_KEY]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges, isImpersonating]);

  // Succès affiché en grand au centre de l'écran (au clic sur une carte).
  const [selected, setSelected] = useState<BadgeDef | null>(null);

  /** Date de déverrouillage par clé — une seule passe, au lieu d'un `find` par comparaison de tri. */
  const unlockedAtByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of badges) m.set(b.badge_key, b.unlocked_at ?? '');
    return m;
  }, [badges]);

  /* Les succès liés à la CLÔTURE ne sont masqués que tant qu'ils sont À DÉBLOQUER.
     Avant, le filtre s'appliquait aussi aux succès DÉJÀ OBTENUS : le jour où la fonctionnalité
     Clôture est désactivée en admin, des trophées gagnés disparaissaient de la page et le compteur
     « Succès » baissait tout seul. On ne retire pas à quelqu'un ce qu'il a déjà gagné ; on cesse
     seulement de lui proposer un objectif devenu inatteignable. */
  const isClosureBadge = (metric: string) => metric === 'closures_count' || metric === 'consecutive_closures';
  const allBadges = config?.badges ?? [];
  // Succès débloqués triés du plus récent au plus ancien (date de déverrouillage)
  const unlockedBadges = useMemo(
    () => allBadges
      .filter((d) => unlockedAtByKey.has(d.key))
      .sort((a, b) => (unlockedAtByKey.get(b.key) ?? '').localeCompare(unlockedAtByKey.get(a.key) ?? '')),
    [allBadges, unlockedAtByKey],
  );
  const lockedBadges = useMemo(
    () => allBadges.filter((d) => !unlockedAtByKey.has(d.key) && (closureEnabled || !isClosureBadge(d.metric))),
    [allBadges, unlockedAtByKey, closureEnabled],
  );
  const unlockedCount = unlockedBadges.length;

  /* Progression ACTUELLE par métrique → barre « 7/12 » sur les succès à débloquer : LE levier
     d'envie n° 1. Les métriques viennent de `lib/engagement/badgeMetrics`, LE MÊME calcul que celui
     qui débloque réellement les succès (GamificationSync) : la barre mesure donc exactement ce que
     le seuil teste. Auparavant l'écran refaisait sa propre version, et n'en couvrait que 5 sur 9 —
     ancienneté, mois en excédent et recos suivies n'avaient jamais de barre, sans raison visible.
     Aucune requête supplémentaire : profil, transactions et clôtures sont déjà en cache. */
  const metricValues = useMemo((): Partial<Record<string, number>> => ({
    ...buildBadgeMetrics({
      transactions: transactions as any,
      closures: closures as any,
      createdAt: (profile as any)?.created_at ?? (user as any)?.created_at ?? null,
    }),
    // La série ne redescend plus : sa valeur courante EST son maximum (cf. useGamification).
    streak_weeks: state?.streak ?? 0,
    gems_earned: state?.gems_earned_total ?? 0,
    login_streak_days: state?.login_streak ?? 0,
  }), [state, closures, transactions, profile, user]);

  const renderBadge = (def: BadgeDef) => {
    const unlocked = unlockedAtByKey.has(def.key);
    const tint = unlocked ? UNLOCK_COLOR : COLORS.textSecondary;
    const current = metricValues[def.metric];
    /* Seuil non fini / négatif : une config admin peut contenir n'importe quoi, et `x / 0` donne
       `Infinity` — une barre à 100 % sur un succès jamais atteignable. */
    const threshold = Number(def.threshold);
    const hasThreshold = Number.isFinite(threshold) && threshold > 1;
    const showProgress = !unlocked && current != null && hasThreshold;
    const shown = Math.max(0, Math.min(current ?? 0, threshold));
    const pct = showProgress ? Math.min(100, Math.max(0, Math.round((shown / threshold) * 100))) : 0;
    const gems = Math.max(0, Number(def.gems) || 0);
    return (
      <TouchableOpacity
        key={def.key}
        style={[styles.card, unlocked && { borderColor: tint + '88' }]}
        onPress={() => setSelected(def)}
        activeOpacity={0.8}
        accessibilityRole="button"
        // L'état fait partie de l'information : un lecteur d'écran annonçait 25 fois le seul titre,
        // sans jamais dire lesquels étaient obtenus.
        accessibilityLabel={
          `${def.label} — ${unlocked ? 'débloqué' : 'à débloquer'}` +
          (showProgress ? `, progression ${shown} sur ${threshold}` : '')
        }
      >
        <View style={[styles.badgeIcon, { backgroundColor: tint + '22', opacity: unlocked ? 1 : 0.5 }]}>
          <BadgeIcon icon={def.icon} size={26} tint={tint} imgStyle={styles.badgeImg} />
          {!unlocked && (
            <View style={styles.lockOverlay}>
              <Ionicons name="lock-closed" size={12} color={COLORS.textSecondary} />
            </View>
          )}
        </View>
        <Text style={styles.badgeLabel} numberOfLines={2}>{def.label}</Text>
        <Text style={styles.badgeDesc} numberOfLines={3}>{def.description}</Text>
        {/* Récompense affichée uniquement sur les succès À DÉBLOQUER (motivation) ;
            sur les succès déjà obtenus, on la voit en grand au clic. */}
        {/* Barre de progression vers le déblocage (métriques calculables). */}
        {showProgress && (
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: pct >= 66 ? UNLOCK_COLOR : COLORS.emerald }]} />
            </View>
            <Text style={styles.progressText}>{shown}/{threshold}</Text>
          </View>
        )}
        {!unlocked && gems > 0 && (
          <View style={styles.rewardPill}>
            <Ionicons name="diamond" size={11} color={COLORS.textSecondary} />
            <Text style={[styles.rewardText, { color: COLORS.textSecondary }]}>+{gems}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'list')]} edges={[]}>
        <TouchableOpacity style={styles.backRow} onPress={goBack} accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Succès</Text>

        {/* ── Ce qu'on affiche quand on ne SAIT pas encore ──────────────────────────────────
            Un « 0 » n'est pas une absence de réponse : la page annonçait 0 relyk, 0 succès et une
            série à zéro pendant tout le chargement, et restait exactement dans cet état si la
            lecture échouait (réseau coupé). Quelqu'un qui a 500 relyks et 12 trophées lisait donc
            qu'il avait tout perdu. On attend, et on dit ce qui se passe. */}
        {isImpersonating ? (
          <View style={styles.notice}>
            <Ionicons name="eye-outline" size={22} color={COLORS.textSecondary} />
            <Text style={styles.noticeTitle}>Consultation seule</Text>
            <Text style={styles.noticeText}>
              Les succès, la série et les relyks appartiennent au compte visité : ils ne sont pas
              lisibles depuis le tien. Cette page ne montrerait que des zéros.
            </Text>
          </View>
        ) : isError ? (
          <View style={styles.notice}>
            <Ionicons name="cloud-offline-outline" size={22} color={COLORS.textSecondary} />
            <Text style={styles.noticeTitle}>Tes succès n’ont pas pu être chargés</Text>
            <Text style={styles.noticeText}>
              Rien n’est perdu : vérifie ta connexion et réessaie.
            </Text>
            <TouchableOpacity style={styles.noticeBtn} onPress={() => refetch()} accessibilityRole="button">
              <Ionicons name="refresh" size={15} color={COLORS.emerald} />
              <Text style={styles.noticeBtnText}>Réessayer</Text>
            </TouchableOpacity>
          </View>
        ) : !isReady ? (
          <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 48 }} />
        ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Résumé série / gemmes */}
          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryEmoji}>{config?.identity.streakIcon || '🔥'}</Text>
              <Text style={styles.summaryValue}>{state?.streak ?? 0}</Text>
              {/* La flamme compte les semaines où l'utilisateur est VENU (une visite entre lundi et
                  dimanche suffit). Elle ne redescend jamais : les semaines sans visite ne comptent
                  pas, elles n'effacent rien. Donc plus de « record » (il vaudrait toujours la
                  valeur affichée) ni de rappel à venir — il n'y a plus rien à perdre. */}
              <Text style={styles.summaryLabel}>{(state?.streak ?? 0) > 1 ? 'semaines' : 'semaine'}{'\n'}connectée{(state?.streak ?? 0) > 1 ? 's' : ''}</Text>
            </View>
            <View style={styles.summaryDivider} />
            {/* Toucher ses Relyks → boutique (onglet « Recharger en relyks »). */}
            <TouchableOpacity
              style={styles.summaryItem}
              onPress={() => router.push('/(tabs)/(secondary)/boutique?focus=gems' as any)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Recharger en relyks"
            >
              <Ionicons name="diamond" size={22} color={COLORS.blue} />
              <Text style={styles.summaryValue}>{state?.gems ?? 0}</Text>
              {/* Cette case OUVRE la boutique, les deux autres non — rien ne le disait : trois cases
                  strictement identiques, dont une seule réagit au toucher. Le petit « + » le dit. */}
              <View style={styles.summaryLinkRow}>
                <Text style={styles.summaryLabel}>{currencyPlural(config?.identity.currencyName || 'Relyk')}</Text>
                <Ionicons name="add-circle" size={12} color={COLORS.blue} />
              </View>
            </TouchableOpacity>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="trophy" size={22} color={COLORS.yellow} />
              <Text style={styles.summaryValue}>{unlockedCount}</Text>
              <Text style={styles.summaryLabel}>Succès</Text>
            </View>
          </View>

          {/* Accès Boutique */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.85}>
              <Ionicons name="bag-handle-outline" size={16} color={COLORS.emerald} />
              <Text style={styles.actionText}>Boutique</Text>
            </TouchableOpacity>
          </View>

          {/* Succès débloqués */}
          {unlockedBadges.length > 0 && (
            <>
              <Text style={styles.groupTitle}>Débloqués ({unlockedBadges.length})</Text>
              <View style={styles.grid}>{unlockedBadges.map(renderBadge)}</View>
            </>
          )}

          {/* Succès à débloquer */}
          {lockedBadges.length > 0 && (
            <>
              <Text style={styles.groupTitle}>À débloquer ({lockedBadges.length})</Text>
              <View style={styles.grid}>{lockedBadges.map(renderBadge)}</View>
            </>
          )}

          {/* Catalogue vide (aucun succès configuré) : la page n'affichait alors QUE le bandeau du
              haut, sans un mot — on croyait à un écran cassé. */}
          {unlockedBadges.length === 0 && lockedBadges.length === 0 && (
            <View style={styles.notice}>
              <Ionicons name="trophy-outline" size={22} color={COLORS.textSecondary} />
              <Text style={styles.noticeTitle}>Aucun succès pour le moment</Text>
              <Text style={styles.noticeText}>De nouveaux trophées arriveront bientôt.</Text>
            </View>
          )}
        </ScrollView>
        )}
      </SafeAreaView>

      {/* Succès agrandi au centre de l'écran */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          {selected && (() => {
            const unlocked = unlockedAtByKey.has(selected.key);
            const tint = unlocked ? UNLOCK_COLOR : COLORS.textSecondary;
            const date = unlockedAtByKey.get(selected.key);
            /* Une date illisible (ligne ancienne, valeur vide) donnait « Débloqué le Invalid Date ».
               Sans date sûre, on se contente de « Débloqué » — c'est l'essentiel. */
            const dateMs = date ? new Date(date).getTime() : NaN;
            const dateStr = Number.isFinite(dateMs)
              ? new Date(dateMs).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
              : null;
            const gems = Math.max(0, Number(selected.gems) || 0);
            /* La carte absorbe le clic pour qu'un appui dessus ne referme pas la fiche. Ce n'est
               PAS une commande : lui donner un rôle « bouton » posait un bouton AUTOUR du vrai
               bouton de fermeture — imbrication interdite en HTML — et annonçait au lecteur
               d'écran un « Fermer » qui ne ferme rien. */
            return (
              <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" style={styles.modalClose} onPress={() => setSelected(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
                {/* La fiche DÉFILE. Un libellé long, une description longue (les deux sont saisis en
                    admin, sans limite) ou un petit écran en mode paysage faisaient sortir le bas de
                    la carte de l'écran : le statut « Débloqué le … » devenait invisible et rien ne
                    permettait d'y accéder. */}
                <ScrollView
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <View style={[styles.modalIcon, { backgroundColor: tint + '22', opacity: unlocked ? 1 : 0.6 }]}>
                    <BadgeIcon icon={selected.icon} size={64} tint={tint} imgStyle={styles.modalIconImg} />
                    {!unlocked && (
                      <View style={styles.modalLockOverlay}>
                        <Ionicons name="lock-closed" size={18} color={COLORS.textSecondary} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.modalLabel}>{selected.label}</Text>
                  {!!selected.description && <Text style={styles.modalDesc}>{selected.description}</Text>}
                  {gems > 0 && (
                    <View style={[styles.modalReward, { borderColor: tint + '66', backgroundColor: tint + '14' }]}>
                      <Ionicons name="diamond" size={15} color={tint} />
                      <Text style={[styles.modalRewardText, { color: tint }]}>+{gems} {currencyPlural(config?.identity.currencyName || 'Relyk')}</Text>
                    </View>
                  )}
                  <View style={[styles.modalStatusPill, { backgroundColor: unlocked ? UNLOCK_COLOR + '1A' : COLORS.cardBorder + '55' }]}>
                    <Ionicons name={unlocked ? 'checkmark-circle' : 'lock-closed'} size={14} color={unlocked ? UNLOCK_COLOR : COLORS.textSecondary} />
                    <Text style={[styles.modalStatusText, { color: unlocked ? UNLOCK_COLOR : COLORS.textSecondary }]}>
                      {unlocked ? (dateStr ? `Débloqué le ${dateStr}` : 'Débloqué') : 'À débloquer'}
                    </Text>
                  </View>
                </ScrollView>
              </TouchableOpacity>
            );
          })()}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 26, fontWeight: '800', color: c.text, marginBottom: 12 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 60 },
    summary: { flexDirection: 'row', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, paddingVertical: 16, marginBottom: 18 },
    summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
    summaryDivider: { width: 1, backgroundColor: c.cardBorder, marginVertical: 4 },
    summaryEmoji: { fontSize: 22 },
    summaryValue: { fontSize: 20, fontWeight: '800', color: c.text },
    summaryLabel: { fontSize: 10, color: c.textSecondary, textAlign: 'center', paddingHorizontal: 4 },
    summaryLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    // Bandeau d'explication (chargement impossible, consultation admin, catalogue vide).
    notice: { alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 20, marginTop: 24 },
    noticeTitle: { fontSize: 15, fontWeight: '800', color: c.text, textAlign: 'center' },
    noticeText: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
    noticeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    noticeBtnText: { fontSize: 13, fontWeight: '700', color: c.emerald },
    actions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 12 },
    actionText: { fontSize: 13, fontWeight: '700', color: c.text },
    groupTitle: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start', marginBottom: 16 },
    card: { width: '31%', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 10, alignItems: 'center', gap: 3 },
    badgeIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
    badgeImg: { width: 34, height: 34, borderRadius: 8 },
    lockOverlay: { position: 'absolute', bottom: -2, right: -2, backgroundColor: c.card, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: c.cardBorder },
    badgeLabel: { fontSize: 12, fontWeight: '700', color: c.text, textAlign: 'center' },
    badgeDesc: { fontSize: 11, color: c.textSecondary, textAlign: 'center', lineHeight: 15 },
    rewardPill: { position: 'absolute', top: -8, right: -6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
    progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'stretch', marginTop: 6 },
    progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 3 },
    progressText: { fontSize: 9.5, fontWeight: '800', color: c.textSecondary },
    rewardText: { fontSize: 10.5, fontWeight: '800' },
    // ── Modal « succès en grand » ──
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    // `maxHeight` + ScrollView interne : la fiche ne peut plus dépasser de l'écran.
    modalCard: { width: '100%', maxWidth: 360, maxHeight: '100%', backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 24, paddingVertical: 28, paddingHorizontal: 24 },
    modalScrollContent: { alignItems: 'center' },
    modalClose: { position: 'absolute', top: 12, right: 12, padding: 4, zIndex: 2 },
    modalIcon: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
    modalIconImg: { width: 72, height: 72, borderRadius: 16 },
    modalLockOverlay: { position: 'absolute', bottom: 2, right: 2, backgroundColor: c.cardSolid ?? c.card, borderRadius: 14, padding: 5, borderWidth: 1, borderColor: c.cardBorder },
    modalLabel: { fontSize: 22, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 8 },
    modalDesc: { fontSize: 14.5, color: c.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
    modalReward: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 12 },
    modalRewardText: { fontSize: 14, fontWeight: '800' },
    modalStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    modalStatusText: { fontSize: 12.5, fontWeight: '700' },
  });
}
