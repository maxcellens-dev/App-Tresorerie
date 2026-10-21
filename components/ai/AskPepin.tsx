/**
 * « Ta question » — l'onglet de Pépin où l'on pose ses questions (Conseils IA, Premium ou ouvert à
 * tous via ai_config.open_to_all / admin). L'appel au modèle passe par l'Edge Function `ai-advice`
 * (clé jamais côté client) ; l'instantané financier envoyé est ANONYMISÉ (montants et catégories).
 *
 * Mise en page :
 *   - en haut, une rangée de pastilles : la conversation (ouvre la liste), les requêtes restantes,
 *     « + » (nouveau fil), la corbeille ;
 *   - les ANALYSES : grandes lignes tant que le fil est vide ; dès qu'une conversation a démarré,
 *     repliées en une seule ligne « Lancer une analyse » (on les rouvre d'un geste) — la place va
 *     aux réponses ;
 *   - les réponses de Pépin en cartes du Jardin (components/ai/AiReport), pas en bulles de chat ;
 *   - la barre de saisie collée en bas, au-dessus du clavier.
 */
import { View, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { KeyboardEvents, useKeyboardHandler } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, useSharedValue, interpolate } from 'react-native-reanimated';
/* Depuis SDK 56, expo-router embarque sa PROPRE copie des onglets du bas. Pas de sous-export public
   pour ce hook — d'où l'import profond, à revérifier à chaque montée de version d'expo-router. */
import { useBottomTabBarHeight } from 'expo-router/build/react-navigation/bottom-tabs';
import AiRichText from './AiRichText';
import AiReport from './AiReport';
import Pico from '../garden/Pico';
import PicoBubble from '../garden/PicoBubble';
import GardenText from '../garden/GardenText';
import GardenButton from '../garden/GardenButton';
import GardenSheet from '../garden/GardenSheet';
import { withDeferredMount } from '../../hooks/platform/useDeferredMount';
import { useAuth } from '../../contexts/AuthContext';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { useUsageGuard } from '../../hooks/config/useUsageLimits';
import { useReadOnlyGuard } from '../../hooks/platform/useReadOnlyGuard';
import { usePlan } from '../../hooks/config/usePlan';
import { useProfile } from '../../hooks/data/useProfile';
import { useUserSnapshot } from '../../hooks/data/useUserSnapshot';
import { useUiPrefs } from '../../hooks/config/useUiPrefs';
import { useAiConfig, useAiQuota, useAiAnalyses, useAiMessages, useAiMessagesRealtime, useAiExtraCreditsRealtime, useAskAi, useSaveBilanMetrics, usePurchaseExtraCredits, useAiConversations, useCreateConversation, useRenameConversation, useDeleteConversation, type AiMessage, type AiCreditPack, type AiConversation } from '../../hooks/admin/useAi';
import { useAiConversationSession } from '../../hooks/platform/useAiConversationSession';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { parseUsageLimitError } from '../../lib/finance/usageLimits';
import { parseAiReport } from '../../lib/ai/aiReport';
import { reportTopic } from '../../lib/ai/reportTopic';
import { resolveAiAccess } from '../../lib/ai/aiAccess';
import { appPrompt } from '../../lib/ui/appDialog';
import { supabase } from '../../lib/platform/supabase';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_ICONS } from '../../lib/garden/icons';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';
import { contentWidth, pointer } from '../../lib/ui/webLayout';
import GardenIcon from '../garden/GardenIcon';

/** Longueur max d'une question (le serveur tronque au-delà : on le dit AVANT, plutôt que de couper en silence). */
const MAX_QUESTION = 2000;

/** Texte des réponses de Pépin (corps des cartes et bulles simples). */
const ANSWER_TEXT = { fontFamily: GF.body, color: G.ink, fontSize: 15, lineHeight: 22 } as const;

type RunPayload = { kind: 'analysis' | 'chat'; analysis_key?: string; question?: string };

export default withDeferredMount(AskPepin);

function AskPepin() {
  const { isDesktop } = useResponsive();
  const { user, isImpersonating } = useAuth();
  const uid = user?.id;
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  /* Clavier : les événements useKeyboardHandler (hauteur à onStart, interpolée par progress). Cet
     écran vit dans un ONGLET : son bas s'arrête au-dessus de la barre d'onglets, que le clavier
     recouvre — on lève donc de (hauteur clavier − hauteur RÉELLE de la barre). Pas de
     KeyboardAvoidingView : son calcul relatif au parent est faux dès que le contenu ne part pas du
     haut de la fenêtre. */
  const tabBarHeight = useBottomTabBarHeight();
  const kbProgress = useSharedValue(0);
  const kbHeightOpened = useSharedValue(0);
  useKeyboardHandler({
    onStart: (e) => { 'worklet'; if (e.height > 0) kbHeightOpened.value = e.height; },
    onMove: (e) => { 'worklet'; kbProgress.value = e.progress; },
    onInteractive: (e) => { 'worklet'; kbProgress.value = e.progress; },
    onEnd: (e) => { 'worklet'; kbProgress.value = e.progress; },
  }, []);
  const kbAvoid = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, interpolate(kbProgress.value, [0, 1], [0, kbHeightOpened.value]) - tabBarHeight),
  }), [tabBarHeight]);
  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = KeyboardEvents.addListener('keyboardDidShow', () => {
      timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => { sub.remove(); clearTimeout(timer); };
  }, []));

  const { isPremium, premiumEnabled, isResolved: planResolved } = usePlan(uid);
  const { data: profile, isSuccess: profileReady, isError: profileFailed, refetch: refetchProfile } = useProfile(uid);
  const isAdmin = (profile as any)?.is_admin === true;

  const { data: cfg, isSuccess: cfgReady, isError: cfgFailed, refetch: refetchCfg } = useAiConfig();
  const { data: quota, refetch: refetchQuota, isSuccess: quotaOk, isError: quotaFailed } = useAiQuota(uid);
  useAiExtraCreditsRealtime(uid); // crédit d'achat affiché dès qu'il tombe (webhook async)
  // Filet : à chaque retour sur l'écran, on relit le quota (crédit tardif).
  useFocusEffect(useCallback(() => { refetchQuota(); }, [refetchQuota]));
  const { data: analysesList } = useAiAnalyses();

  // ── Conversations séparées ──
  const { data: conversations = [], isSuccess: convsOk } = useAiConversations(uid);
  const [conversationId, setConversationId] = useAiConversationSession(uid);
  /* Conversation courante supprimée ailleurs → fil neuf. ⚠️ `convsOk` : sans lui, la liste vaut `[]`
     PENDANT SON CHARGEMENT et on dé-sélectionnait le fil qu'on venait de créer. */
  useEffect(() => {
    if (!convsOk) return;
    if (conversationId && !conversations.some((cv) => cv.id === conversationId)) setConversationId(null);
  }, [conversations, conversationId, convsOk, setConversationId]);
  const [showConvs, setShowConvs] = useState(false);
  const createConv = useCreateConversation(uid);
  const renameConv = useRenameConversation(uid);
  const delConv = useDeleteConversation(uid);
  const { guard: usageGuard } = useUsageGuard(uid);
  const roGuard = useReadOnlyGuard(); // « connecté en tant que » : aucune écriture sur le compte visité
  const currentConv = conversations.find((cv) => cv.id === conversationId) ?? null;

  const { data: history, isSuccess: historyOk } = useAiMessages(uid, conversationId ?? null);
  useAiMessagesRealtime(uid);
  const ask = useAskAi(uid);
  const purchase = usePurchaseExtraCredits(uid);

  /* Les conditions d'accès viennent TOUTES de requêtes (abonnement, rôle admin, ouverture à tous,
     crédits achetés) : on ne tranche qu'une fois les lectures posées, sinon « réservé aux abonnés »
     clignotait à chaque ouverture. Règles : lib/ai/aiAccess (pur, testé, aligné sur l'Edge Function).
     Compteur UNIQUE côté utilisateur : gratuit + rechargé confondus. */
  const packs: AiCreditPack[] = cfg?.extra_credit_packs ?? [];
  const access = resolveAiAccess({
    isPremium, planResolved, isAdmin, isImpersonating,
    profileReady, cfgReady, quotaSettled: quotaOk || quotaFailed,
    openToAll: !!cfg?.open_to_all,
    payToUseEnabled: !!cfg?.pay_to_use_enabled,
    paidFallbackEnabled: !!cfg?.paid_fallback_enabled,
    packsCount: packs.length,
    quota,
  });
  const { accessReady, allowed, readOnly, quotaLoaded, available, totalRequests, extraCredits, canSend, canRecharge, outOfRequests } = access;
  const accessFailed = profileFailed || cfgFailed;
  const [showPaywall, setShowPaywall] = useState(false);
  const openRecharge = () => { if (canRecharge) setShowPaywall(true); };

  const eur = (cents: number) => (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ` ${CURRENCY_SYMBOL}`;

  // Achat : verrou synchrone (un double tap = deux achats) + voyant sur la seule ligne tapée.
  const buyLock = useSubmitLock();
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const buyPack = async (pack: AiCreditPack) => {
    if (readOnly || !buyLock.acquire()) return;
    setBuyingId(pack.id);
    try {
      await purchase.mutateAsync(pack);
      setShowPaywall(false);
      Alert.alert('Merci ! 🙌', `Achat validé. Tes ${pack.credits} requêtes arrivent dans quelques secondes (le temps de la validation).`);
    } catch (e: any) {
      const reason = e?.reason; // 'cancelled' → l'utilisateur a annulé, on ne dit rien
      if (reason === 'not_supported') Alert.alert('Sur mobile uniquement', "La recharge de requêtes se fait depuis l'application mobile Relyka (iOS / Android).");
      else if (reason === 'not_configured') Alert.alert('Produit indisponible', e?.message ?? "Ce pack n'est pas encore disponible. Réessaie plus tard.");
      else if (reason !== 'cancelled') Alert.alert('Achat impossible', e?.message ?? 'Réessaie plus tard.');
    } finally {
      buyLock.release(); // sans ça, un achat annulé condamnerait le bouton pour de bon
      setBuyingId(null);
    }
  };

  // ── Instantané financier anonymisé (même logique que l'onglet Snapshot admin) ──
  const { ready: snapshotReady, build: buildSnap, currentBilanMetrics } = useUserSnapshot(uid);
  const saveBilanMetrics = useSaveBilanMetrics(uid);

  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  // Fil où la demande en cours est partie : le « Pépin réfléchit » ne s'affiche que sur celui-là.
  const [pendingConvId, setPendingConvId] = useState<string | null>(null);
  // Confirmation « utiliser 1 requête », avec « ne plus me demander » (ui_prefs.ai_confirm_skip).
  const { prefs: uiPrefs, patch: patchUiPrefs } = useUiPrefs(uid);
  const [confirmPayload, setConfirmPayload] = useState<RunPayload | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  // Analyses dépliées dans un fil commencé (repliées par défaut pour laisser la place aux réponses).
  const [analysesOpen, setAnalysesOpen] = useState(false);
  useEffect(() => { setAnalysesOpen(false); }, [conversationId]);

  const titleFor = (payload: RunPayload) =>
    payload.kind === 'analysis'
      ? ((analysesList ?? []).find((p) => p.key === payload.analysis_key)?.title ?? 'Analyse')
      : (payload.question ?? 'Nouvelle conversation');

  /* VERROU SYNCHRONE (useSubmitLock) : `pending` n'existe qu'au rendu SUIVANT — deux taps rapprochés
     partaient tous les deux (deux requêtes facturées, deux conversations). */
  const submit = useSubmitLock();

  /** Supprime le fil créé à la volée s'il est resté VIDE (échec réseau) — jamais un fil qui a des
   *  messages (la requête a pu aboutir côté serveur sans que la réponse nous revienne). */
  const dropEmptyConversation = async (convId: string) => {
    try {
      if (!supabase || !uid) return;
      const { count } = await supabase.from('ai_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', convId);
      if ((count ?? 0) === 0) await delConv.mutateAsync(convId);
    } catch { /* best effort */ }
  };

  // Envoi effectif (après validation) — consomme 1 requête en cas de succès.
  const execute = async (payload: RunPayload) => {
    if (!submit.acquire()) return;
    let createdConvId: string | null = null;
    const typed = payload.kind === 'chat' ? (payload.question ?? '') : '';
    try {
      // Nouvelle conversation = une ligne en base : limite vérifiée AVANT (le serveur reste le garde-fou).
      if (!conversationId && !(await usageGuard('ai_conversation'))) return;
      if (payload.kind === 'chat') setInput('');
      setPending(true);
      setAnalysesOpen(false);
      let convId = conversationId ?? null;
      if (!convId) {
        convId = (await createConv.mutateAsync(titleFor(payload))).id;
        createdConvId = convId;
        setConversationId(convId);
      }
      setPendingConvId(convId);
      const res = await ask.mutateAsync({ ...payload, snapshot: buildSnap(), conversation_id: convId });
      // Bilan global réussi → métriques gardées pour l'ÉVOLUTION du prochain bilan.
      if (res.ok && !res.queued && payload.kind === 'analysis' && payload.analysis_key === 'analysis_global' && currentBilanMetrics) {
        saveBilanMetrics.mutate(currentBilanMetrics);
      }
      if (res.queued) {
        Alert.alert('Réessai en cours', "Le service n'a pas pu répondre tout de suite. Ta demande a été transmise — tu seras notifié dès qu'une réponse est disponible. Cette requête n'a pas été décomptée.");
      } else if (!res.ok) {
        // Rien n'est parti vers le modèle → on rend sa question à l'utilisateur.
        if (typed) setInput((v) => v || typed);
        if (createdConvId) await dropEmptyConversation(createdConvId);
        if (res.error === 'quota_exceeded') {
          refetchQuota();
          if (canRecharge) setShowPaywall(true);
          else Alert.alert('Plus de requêtes', 'Tu as utilisé toutes tes requêtes pour ce mois-ci. Elles se renouvellent au début du mois prochain.');
        } else if (res.error === 'premium_required') {
          Alert.alert('Réservé Premium', 'Cette fonctionnalité est réservée aux abonnés Premium.');
        } else if (res.error === 'conversation_not_found') {
          setConversationId(null);
          Alert.alert('Conversation introuvable', "Cette conversation n'existe plus. Ta question n'a pas été envoyée — repose-la dans un nouveau fil.");
        } else if (res.error === 'empty_question' || res.error === 'invalid_analysis' || res.error === 'analysis_disabled') {
          Alert.alert('Demande invalide', "Cette demande n'est plus disponible. Recharge la page et réessaie.");
        } else {
          Alert.alert('Indisponible', `Le service de conseils est momentanément indisponible.${res.error ? `\n\n(détail : ${res.error})` : ''}`);
        }
      }
    } catch (e: any) {
      if (typed) setInput((v) => v || typed); // réseau coupé : la question reste dans le champ
      if (createdConvId) await dropEmptyConversation(createdConvId);
      // Limite d'usage : déjà signalée par le filet global → pas de doublon.
      if (!parseUsageLimitError(e)) Alert.alert('Erreur', e?.message ?? 'Échec de la requête.');
    } finally {
      submit.release();
      setPending(false);
      setPendingConvId(null);
    }
  };

  const run = (payload: RunPayload) => {
    if (readOnly || pending || submit.isBusy()) return;
    // Vrai dans les DEUX cas : chargement en cours… ou lecture en échec.
    if (!snapshotReady) { Alert.alert('Un instant', 'Tes données ne sont pas encore prêtes. Réessaie dans quelques secondes.'); return; }
    if (!canSend) {
      if (canRecharge) setShowPaywall(true);
      else Alert.alert('Plus de requêtes', `Tu as utilisé tes ${totalRequests} requête${totalRequests > 1 ? 's' : ''} de ce mois-ci. Elles se renouvellent au début du mois prochain.`);
      return;
    }
    if (uiPrefs.ai_confirm_skip === true) { execute(payload); return; }
    setConfirmSkip(false);
    setConfirmPayload(payload);
  };

  const confirmSend = () => {
    const payload = confirmPayload;
    setConfirmPayload(null);
    if (confirmSkip) patchUiPrefs({ ai_confirm_skip: true });
    if (payload) execute(payload);
  };

  const sendChat = () => {
    const q = input.trim().slice(0, MAX_QUESTION);
    if (q) run({ kind: 'chat', question: q });
  };

  // Fil neuf (créé en base au premier message) ; limite vérifiée AVANT, sauf si on y est déjà.
  const newConversation = async () => {
    if (readOnly) return;
    if (conversationId === null) { setShowConvs(false); return; }
    if (!(await usageGuard('ai_conversation'))) return;
    setConversationId(null);
    setInput('');
    setShowConvs(false);
  };

  /* Renommer / supprimer sont des ÉCRITURES : interdites en consultation admin (la RLS les laisserait
     passer et effacerait les conversations de la personne visitée). */
  const deleteConversation = (conv: AiConversation) => {
    if (roGuard.blocked()) return;
    Alert.alert('Supprimer la conversation', `« ${conv.title} » sera définitivement supprimée.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => delConv.mutate(conv.id, { onError: (e: unknown) => Alert.alert('Un souci', e instanceof Error ? e.message : "La conversation n'a pas pu être supprimée.") }) },
    ]);
  };

  // Renommage : dialogue IN-APP sur toutes les plateformes (Alert.prompt n'existe que sur iOS).
  const renamePrompt = async (conv: AiConversation) => {
    if (roGuard.blocked()) return;
    const t = await appPrompt({ title: 'Renommer la conversation', defaultValue: conv.title, placeholder: 'Nom de la conversation', confirmText: 'Renommer' });
    const clean = (t ?? '').trim().slice(0, 80);
    if (clean && clean !== conv.title) renameConv.mutate({ id: conv.id, title: clean }, { onError: (e: unknown) => Alert.alert('Un souci', e instanceof Error ? e.message : "Le nom n'a pas pu être modifié.") });
  };

  const analyses = analysesList ?? [];
  const questions = cfg?.predefined_questions ?? [];
  const lastMsg = history?.length ? history[history.length - 1] : null;
  const pendingHere = pending && (pendingConvId == null || pendingConvId === conversationId);
  /* Dernier message = une QUESTION sans réponse (le service n'a pas répondu, demande en file) : on
     l'explique dans le fil, sinon on croit avoir perdu une requête. */
  const awaitingAnswer = !pendingHere && !!lastMsg && lastMsg.role === 'user';
  const emptyThread = !pendingHere && !readOnly && (conversationId === null || (historyOk && !history?.length));
  const started = !!history?.length || pendingHere;

  // On ne sait pas encore si l'accès est ouvert : on attend plutôt que d'annoncer un refus à tort.
  if (!accessReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: GARDEN_SPACE.xxl, gap: GARDEN_SPACE.md }}>
        {accessFailed ? (
          <>
            <PicoBubble mood="thinking">Je n'arrive pas à charger tes conversations. Vérifie ta connexion, puis réessaie.</PicoBubble>
            <GardenButton label="Réessayer" variant="secondary" onPress={() => { refetchProfile(); refetchCfg(); }} />
          </>
        ) : <ActivityIndicator size="large" color={G.primary} />}
      </View>
    );
  }

  // L'offre Premium peut être coupée globalement (admin) : on n'invite alors pas à « passer Premium ».
  if (!allowed) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: GARDEN_SPACE.xl, gap: GARDEN_SPACE.lg }}>
        <PicoBubble mood="happy">
          {premiumEnabled
            ? 'Pose-moi tes questions sur ton argent, ou demande-moi une analyse complète avec tes vrais chiffres. Cet espace est réservé aux abonnés Premium.'
            : "Bientôt, tu pourras me poser tes questions sur ton argent et me demander des analyses avec tes vrais chiffres. Reviens vite !"}
        </PicoBubble>
        {premiumEnabled ? <GardenButton label="Passer Premium" onPress={() => router.navigate('/(tabs)/(secondary)/premium' as any)} /> : null}
      </View>
    );
  }

  const pill = { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: GARDEN_RADII.pill } as const;
  const round = { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } as const;

  return (
    <View style={{ flex: 1 }}>
      <Reanimated.View style={[{ flex: 1 }, kbAvoid, contentWidth(isDesktop)]}>
        {/* ── Pastilles du haut ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: GARDEN_SPACE.lg, paddingBottom: 8 }}>
          <Pressable onPress={() => setShowConvs(true)} accessibilityRole="button" accessibilityLabel="Mes conversations"
            style={[pill, { flex: 1, paddingHorizontal: 14, backgroundColor: G.card, borderWidth: 1, borderColor: G.line }, pointer]}>
            <Ionicons name="chatbubbles-outline" size={17} color={G.primary} />
            <GardenText variant="smallStrong" style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>{currentConv ? currentConv.title : 'Nouvelle conversation'}</GardenText>
            {conversations.length > 0 ? <GardenText variant="smallStrong" color={G.muted}>{conversations.length}</GardenText> : null}
            <Ionicons name="chevron-down" size={15} color={G.muted} />
          </Pressable>
          <Pressable disabled={!canRecharge} onPress={openRecharge} accessibilityRole={canRecharge ? 'button' : 'text'}
            accessibilityLabel={quotaLoaded ? `${available} requêtes disponibles sur ${totalRequests}` : 'Requêtes disponibles en cours de chargement'}
            style={[pill, { paddingHorizontal: 12, backgroundColor: G.branchesBg }]}>
            <Ionicons name="sparkles" size={14} color={G.branchesText} />
            <GardenText variant="smallStrong" color={G.branchesText} style={{ fontSize: 14 }}>{quotaLoaded ? available : '—'}</GardenText>
          </Pressable>
          <Pressable onPress={newConversation} disabled={readOnly} accessibilityRole="button" accessibilityLabel="Nouvelle conversation"
            style={[round, { backgroundColor: readOnly ? G.field : G.primary }, pointer]}>
            <Ionicons name="add" size={22} color={readOnly ? G.muted : G.onPrimary} />
          </Pressable>
          {currentConv && !readOnly ? (
            <Pressable onPress={() => deleteConversation(currentConv)} disabled={delConv.isPending} accessibilityRole="button" accessibilityLabel="Supprimer cette conversation"
              style={[round, { backgroundColor: G.card, borderWidth: 1, borderColor: G.line }, pointer]}>
              <Ionicons name="trash-outline" size={18} color={G.fruitsText} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GARDEN_SPACE.lg, paddingBottom: 48, gap: GARDEN_SPACE.md }} showsVerticalScrollIndicator={false}>
          {/* Plus aucune requête : recharge si elle est proposée, sinon l'état, simplement. */}
          {outOfRequests ? (
            <Notice icon={canRecharge ? 'flash' : 'time-outline'} tone={canRecharge ? 'action' : 'info'}
              title={canRecharge ? "Tu n'as plus de requêtes disponibles" : 'Tu as utilisé tes requêtes du mois'}
              text={canRecharge ? "Recharge des requêtes à l'unité pour continuer, sans attendre le mois prochain."
                : `Elles se renouvellent au début du mois prochain. Ton historique reste consultable.${!isPremium ? ' Passe Premium pour en avoir davantage chaque mois.' : ''}`}
              onPress={canRecharge ? openRecharge : !isPremium ? () => router.navigate('/(tabs)/(secondary)/premium' as any) : undefined} />
          ) : null}
          {/* Quota épuisé mais la bascule payante éditeur prend le relais : pas de mur, on le dit. */}
          {quotaLoaded && available <= 0 && !!cfg?.paid_fallback_enabled && !readOnly ? (
            <Notice icon="gift-outline" tone="info" title="Tu as utilisé tes requêtes du mois" text="Tu peux quand même continuer : c'est offert pendant la phase de lancement." />
          ) : null}
          {readOnly ? <Notice icon="eye-outline" tone="info" title={isImpersonating ? 'Mode consultation : lecture seule.' : 'Historique en lecture seule (offre gratuite).'} /> : null}

          {/* ── Analyses : grandes lignes sur un fil vide, une seule ligne repliée ensuite ── */}
          {analyses.length > 0 && !readOnly ? (
            started && !analysesOpen ? (
              <Pressable onPress={() => setAnalysesOpen(true)} accessibilityRole="button" accessibilityLabel={`Lancer une analyse (${analyses.length})`}
                style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: GARDEN_RADII.md, backgroundColor: G.card, borderWidth: 1, borderColor: G.line }, pointer]}>
                <Ionicons name="analytics-outline" size={16} color={G.primary} />
                <GardenText variant="smallStrong" style={{ flex: 1 }}>Lancer une analyse</GardenText>
                <GardenText variant="small" color={G.muted}>{analyses.length}</GardenText>
                <Ionicons name="chevron-down" size={15} color={G.muted} />
              </Pressable>
            ) : (
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <GardenText variant="label" style={{ flex: 1, paddingHorizontal: 4 }}>Analyses</GardenText>
                  {started ? (
                    <Pressable onPress={() => setAnalysesOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Replier les analyses" style={pointer}>
                      <Ionicons name="chevron-up" size={18} color={G.muted} />
                    </Pressable>
                  ) : null}
                </View>
                {analyses.map((a) => {
                  const look = GARDEN_ICONS[reportTopic(a.title)];
                  return (
                    <Pressable key={a.key} disabled={pending} onPress={() => run({ kind: 'analysis', analysis_key: a.key })} accessibilityRole="button" accessibilityLabel={a.title}
                      style={({ pressed, hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: pressed || hovered ? look.bg : G.card, borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line, paddingHorizontal: 12, paddingVertical: 7, opacity: pending ? 0.5 : 1 }, pointer]}>
                      <GardenIcon icon={look.icon} fg={look.fg} bg={look.bg} size={28} />
                      <GardenText variant="smallStrong" style={{ flex: 1, fontSize: 14 }} numberOfLines={2}>{a.title}</GardenText>
                      <Ionicons name="chevron-forward" size={16} color={look.fg} />
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : null}

          {/* Fil vide : on dit quoi faire, au lieu de laisser un blanc. */}
          {emptyThread ? (
            <PicoBubble mood="thinking">Choisis une analyse pour un point complet, ou pose-moi directement ta question en bas. Chaque demande utilise 1 requête, et je te réponds avec tes vrais chiffres.</PicoBubble>
          ) : null}

          {/* ── Le fil : tes questions, mes réponses en cartes ── */}
          {(history ?? []).map((m) => <Message key={m.id} m={m} />)}

          {pendingHere ? <PicoBubble mood="thinking">Je regarde tes chiffres…</PicoBubble> : null}
          {awaitingAnswer ? (
            <PicoBubble mood="thinking">Je n'ai pas pu te répondre tout de suite. Ta demande est transmise et cette requête n'a pas été décomptée : tu seras prévenu dès que ma réponse est prête.</PicoBubble>
          ) : null}

          {/* Questions rapides : sur un fil vide seulement (ensuite, la saisie suffit). */}
          {!readOnly && questions.length > 0 && !started ? (
            <View style={{ gap: 6 }}>
              <GardenText variant="label" style={{ paddingHorizontal: 4 }}>Questions rapides</GardenText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {questions.map((q, i) => (
                  <Pressable key={i} disabled={pending} onPress={() => run({ kind: 'chat', question: q })} accessibilityRole="button"
                    style={[{ maxWidth: '100%', flexShrink: 1, backgroundColor: G.card, borderWidth: 1.5, borderColor: G.line, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, opacity: pending ? 0.5 : 1 }, pointer]}>
                    <GardenText variant="smallStrong" color={G.primary} style={{ fontSize: 14 }}>{q}</GardenText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <GardenText variant="small" color={G.muted}>{cfg?.consent_text ?? "Un résumé anonymisé de tes finances est envoyé à un service d'IA tiers pour générer ces conseils."}</GardenText>
          {/* « Ne plus me demander » ne doit pas être un aller sans retour. */}
          {!readOnly && uiPrefs.ai_confirm_skip === true ? (
            <Pressable onPress={() => patchUiPrefs({ ai_confirm_skip: false })} accessibilityRole="button" style={pointer}>
              <GardenText variant="small" color={G.muted}>Envoi direct, sans confirmation. <GardenText variant="smallStrong" color={G.primary}>Redemander avant chaque requête</GardenText></GardenText>
            </Pressable>
          ) : null}
        </ScrollView>

        {/* ── Barre de saisie, collée en bas ── */}
        {!readOnly ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: G.line, backgroundColor: G.bg }}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={{ maxHeight: 110, backgroundColor: G.card, borderWidth: 1, borderColor: G.line, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, color: G.ink, fontSize: 15, fontFamily: GF.body }}
                value={input}
                onChangeText={setInput}
                placeholder="Pose ta question…"
                placeholderTextColor={G.muted}
                multiline
                editable={!pending}
                maxLength={MAX_QUESTION}
                onSubmitEditing={sendChat}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 350)}
              />
              {input.length > MAX_QUESTION * 0.8 ? <GardenText variant="small" color={G.muted} style={{ textAlign: 'right', marginTop: 3, marginRight: 6 }}>{input.length} / {MAX_QUESTION} caractères</GardenText> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Envoyer" disabled={pending || !input.trim()} onPress={sendChat}
              style={[{ width: 46, height: 46, borderRadius: 23, backgroundColor: G.primary, alignItems: 'center', justifyContent: 'center', opacity: pending || !input.trim() ? 0.5 : 1 }, pointer]}>
              <Ionicons name="send" size={18} color={G.onPrimary} />
            </Pressable>
          </View>
        ) : null}
      </Reanimated.View>

      {/* ── Recharge de requêtes ── */}
      <GardenSheet visible={showPaywall} onClose={() => setShowPaywall(false)} title="Recharge tes requêtes"
        subtitle={available > 0 ? `Il t'en reste ${available}. Les requêtes achetées ne périment pas.` : "Achètes-en à l'unité et continue tout de suite."}
        footer={<GardenButton label="Plus tard" variant="secondary" onPress={() => setShowPaywall(false)} />}>
        {extraCredits > 0 ? <GardenText variant="small" color={G.inkSoft}>Dont {extraCredits} requête{extraCredits > 1 ? 's' : ''} rechargée{extraCredits > 1 ? 's' : ''}, sans limite de date.</GardenText> : null}
        {packs.length === 0 ? <GardenText variant="body">Offres bientôt disponibles.</GardenText> : packs.map((p) => {
          const perUnit = p.credits > 0 ? p.price_cents / p.credits : p.price_cents;
          const busy = buyingId === p.id;
          return (
            <Pressable key={p.id} disabled={purchase.isPending} onPress={() => buyPack(p)} accessibilityRole="button" accessibilityLabel={`${p.credits} requêtes pour ${eur(p.price_cents)}`}
              style={[{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, backgroundColor: G.card, borderWidth: 1, borderColor: G.line, borderRadius: GARDEN_RADII.md, padding: 14, opacity: purchase.isPending && !busy ? 0.5 : 1 }, pointer]}>
              <View style={{ flex: 1 }}>
                <GardenText variant="bodyStrong">{p.credits} requête{p.credits > 1 ? 's' : ''}</GardenText>
                <GardenText variant="small" color={G.muted}>{eur(perUnit)} / requête</GardenText>
              </View>
              <View style={{ minWidth: 80, alignItems: 'center', backgroundColor: G.primary, borderRadius: GARDEN_RADII.pill, paddingVertical: 9, paddingHorizontal: 14 }}>
                {busy ? <ActivityIndicator color={G.onPrimary} /> : <GardenText variant="smallStrong" color={G.onPrimary}>{eur(p.price_cents)}</GardenText>}
              </View>
            </Pressable>
          );
        })}
        <GardenText variant="small" color={G.muted}>Paiement sécurisé via l'App Store / Google Play. Les crédits sont ajoutés à ton compte après l'achat.</GardenText>
      </GardenSheet>

      {/* ── Mes conversations ── */}
      <GardenSheet visible={showConvs} onClose={() => setShowConvs(false)} title="Mes conversations"
        footer={!readOnly ? <GardenButton label="Nouvelle conversation" onPress={newConversation} /> : undefined}>
        {conversations.length === 0 ? (
          <GardenText variant="small" color={G.muted} center>Aucune conversation pour l'instant. Pose une question pour en démarrer une.</GardenText>
        ) : conversations.map((cv) => {
          const active = cv.id === conversationId;
          return (
            <View key={cv.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: active ? G.branchesBg : G.card, borderWidth: 1, borderColor: active ? G.branches : G.line, borderRadius: GARDEN_RADII.md, paddingVertical: 8, paddingLeft: 14, paddingRight: 4 }}>
              <Pressable style={[{ flex: 1 }, pointer]} onPress={() => { setConversationId(cv.id); setShowConvs(false); }} accessibilityRole="button" accessibilityLabel={cv.title}>
                <GardenText variant="bodyStrong" color={active ? G.branchesText : G.ink} numberOfLines={1}>{cv.title}</GardenText>
                <GardenText variant="small" color={G.muted}>{new Date(cv.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</GardenText>
              </Pressable>
              {!readOnly ? (
                <>
                  <Pressable onPress={() => renamePrompt(cv)} style={[round, pointer]} accessibilityRole="button" accessibilityLabel="Renommer la conversation">
                    <Ionicons name="create-outline" size={17} color={G.inkSoft} />
                  </Pressable>
                  <Pressable onPress={() => deleteConversation(cv)} style={[round, pointer]} accessibilityRole="button" accessibilityLabel="Supprimer la conversation">
                    <Ionicons name="trash-outline" size={17} color={G.fruitsText} />
                  </Pressable>
                </>
              ) : null}
            </View>
          );
        })}
      </GardenSheet>

      {/* ── Confirmation « utiliser 1 requête » ── */}
      <GardenSheet visible={confirmPayload != null} onClose={() => setConfirmPayload(null)} title="Utiliser une requête ?"
        subtitle={`Cette demande utilise 1 requête.${quotaLoaded && available > 0 ? ` Il t'en restera ${available - 1} sur ${totalRequests}.` : ''}`}
        footer={(
          <View style={{ flexDirection: 'row', gap: GARDEN_SPACE.sm }}>
            <View style={{ flex: 1 }}><GardenButton label="Annuler" variant="secondary" onPress={() => setConfirmPayload(null)} /></View>
            <View style={{ flex: 1 }}><GardenButton label="Continuer" onPress={confirmSend} /></View>
          </View>
        )}>
        <Pressable onPress={() => setConfirmSkip((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmSkip }}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, pointer]}>
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: confirmSkip ? G.primary : G.line, backgroundColor: confirmSkip ? G.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {confirmSkip ? <Ionicons name="checkmark" size={14} color={G.onPrimary} /> : null}
          </View>
          <GardenText variant="small" style={{ flex: 1 }}>Ne plus me demander : envoyer directement les prochaines fois</GardenText>
        </Pressable>
      </GardenSheet>
    </View>
  );
}

/** Bandeau d'état (requêtes, consultation) : une carte teintée, touchable quand il y a un geste. */
function Notice({ icon, tone, title, text, onPress }: { icon: string; tone: 'action' | 'info'; title: string; text?: string; onPress?: () => void }) {
  const fg = tone === 'action' ? G.branchesText : G.inkSoft;
  const body = (
    <>
      <Ionicons name={icon as any} size={18} color={fg} />
      <View style={{ flex: 1, gap: 2 }}>
        <GardenText variant="bodyStrong" color={fg}>{title}</GardenText>
        {text ? <GardenText variant="small" color={G.inkSoft}>{text}</GardenText> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={fg} /> : null}
    </>
  );
  const style = { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: tone === 'action' ? G.branchesBg : G.field, borderRadius: GARDEN_RADII.md, padding: 12 } as const;
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" style={[style, pointer]}>{body}</Pressable> : <View style={style}>{body}</View>;
}

/** Date + heure d'une réponse (« 2 juil. · 14:32 »). Vide si date invalide. */
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Un message du fil. Ta question : une bulle à droite. La réponse de Pépin : des cartes illustrées
 * quand elle est structurée (synthèse ou plusieurs sections), sinon une carte simple avec son portrait.
 * Une réponse de l'ÉQUIPE Relyka (humaine) reste en texte, signée.
 * ⚠️ Le hook passe AVANT tout retour conditionnel (sinon l'ordre des hooks varie selon le rôle).
 */
function Message({ m }: { m: AiMessage }) {
  const isUser = m.role === 'user';
  const isTeam = m.role === 'admin';
  const report = useMemo(() => (isUser || isTeam ? null : parseAiReport(m.content)), [isUser, isTeam, m.content]);
  const stamp = formatStamp(m.created_at);

  if (isUser) {
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ maxWidth: '85%', backgroundColor: G.primary, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
          <GardenText variant="bodyStrong" color={G.onPrimary}>{m.content}</GardenText>
        </View>
      </View>
    );
  }
  const asCards = !!report && (!!report.summary || report.sections.length >= 2);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {isTeam ? <Ionicons name="people-circle-outline" size={28} color={G.primary} /> : <Pico avatar size={28} />}
        <GardenText variant="smallStrong" color={G.inkSoft} style={{ flex: 1 }}>{isTeam ? "L'équipe Relyka" : 'Pépin'}</GardenText>
        {stamp ? <GardenText variant="small" color={G.muted}>{stamp}</GardenText> : null}
      </View>
      {asCards && report ? <AiReport report={report} baseTextStyle={ANSWER_TEXT} /> : (
        <View style={{ backgroundColor: G.card, borderWidth: 1, borderColor: G.line, borderRadius: GARDEN_RADII.lg, padding: GARDEN_SPACE.lg }}>
          <AiRichText text={m.content} style={ANSWER_TEXT} />
        </View>
      )}
    </View>
  );
}
