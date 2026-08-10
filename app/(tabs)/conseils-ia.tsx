/**
 * Conseils IA — page Premium (ou ouverte à tous via ai_config.open_to_all / admin).
 * Affiche le compteur de requêtes, 3 analyses structurées, un chat avec questions prédéfinies, et
 * l'historique. L'appel au modèle passe par l'Edge Function `ai-advice` (clé API jamais côté client).
 * L'instantané financier envoyé est ANONYMISÉ (montants + catégories uniquement).
 */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform, Modal, Pressable } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import CalculatorButton from '../../components/CalculatorButton';
import { withDeferredMount } from '../../hooks/useDeferredMount';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { useResponsive } from '../../hooks/useResponsive';
import { pageColumn } from '../../lib/webLayout';
import { useNavBack } from '../../hooks/useNavBack';
import { useUsageGuard } from '../../hooks/useUsageLimits';
import { parseUsageLimitError } from '../../lib/usageLimits';
import { sheetWidth, useSheetBottomPadding } from '../../lib/appLayout';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { usePlan } from '../../hooks/usePlan';
import { useProfile } from '../../hooks/useProfile';
import { useUserSnapshot } from '../../hooks/useUserSnapshot';
import { useUiPrefs } from '../../hooks/useUiPrefs';
import { KeyboardEvents, useKeyboardHandler } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, useSharedValue, interpolate } from 'react-native-reanimated';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import AiRichText from '../../components/AiRichText';
import AiReport from '../../components/AiReport';
import { parseAiReport } from '../../lib/aiReport';
import { useAiConfig, useAiQuota, useAiPrompts, useAiMessages, useAiMessagesRealtime, useAiExtraCreditsRealtime, useAskAi, useSaveBilanMetrics, usePurchaseExtraCredits, useAiConversations, useCreateConversation, useRenameConversation, useDeleteConversation, type AiMessage, type AiCreditPack, type AiConversation } from '../../hooks/useAi';

export default withDeferredMount(ConseilsIaScreen, 'list');
function ConseilsIaScreen() {
  const c = useAppColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(32);
  const { isDesktop } = useResponsive(); // web bureau : conversation dans une colonne lisible
  const { user, isImpersonating } = useAuth();
  const uid = user?.id;
  const goBack = useNavBack();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  // Clavier : STRICTEMENT la même source que le KeyboardAvoidingView de la lib (validé sur appareil
  // dans SupportThreadModal) — les événements useKeyboardHandler (hauteur à onStart, interpolée par
  // progress), PAS la valeur partagée `reanimated.height` du contexte (constatée divergente ici).
  // Géométrie : cet écran est un ONGLET → son bas s'arrête AU-DESSUS de la barre d'onglets, que le
  // clavier recouvre. Le déplacement exact est donc (hauteur clavier − hauteur barre d'onglets),
  // cette dernière étant la hauteur RÉELLE mesurée par React Navigation — c'était le « vide sous la
  // barre » : lever de toute la hauteur du clavier sur-levait d'une barre d'onglets.
  // Ne PAS utiliser un KeyboardAvoidingView ici : son calcul repose sur un onLayout RELATIF AU
  // PARENT, faux dès que le contenu ne part pas du haut de la fenêtre.
  const tabBarHeight = useBottomTabBarHeight();
  const kbProgress = useSharedValue(0);
  const kbHeightOpened = useSharedValue(0);
  useKeyboardHandler({
    onStart: (e) => {
      'worklet';
      if (e.height > 0) kbHeightOpened.value = e.height;
    },
    onMove: (e) => {
      'worklet';
      kbProgress.value = e.progress;
    },
    onInteractive: (e) => {
      'worklet';
      kbProgress.value = e.progress;
    },
    onEnd: (e) => {
      'worklet';
      kbProgress.value = e.progress;
    },
  }, []);
  const kbAvoid = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, interpolate(kbProgress.value, [0, 1], [0, kbHeightOpened.value]) - tabBarHeight),
  }), [tabBarHeight]);
  useEffect(() => {
    const sub = KeyboardEvents.addListener('keyboardDidShow', () => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => sub.remove();
  }, []);

  const { isPremium } = usePlan(uid);
  const { data: profile, isSuccess: profileReady } = useProfile(uid);
  const isAdmin = (profile as any)?.is_admin === true;

  const { data: cfg, isSuccess: cfgReady } = useAiConfig();
  const { data: quota, refetch: refetchQuota } = useAiQuota(uid);
  useAiExtraCreditsRealtime(uid); // crédit d'achat affiché dès qu'il tombe (webhook async)
  // Filet de sécurité : à chaque fois qu'on revient sur l'écran, on relit le quota (crédit tardif).
  useFocusEffect(useCallback(() => { refetchQuota(); }, [refetchQuota]));
  const { data: prompts } = useAiPrompts();

  // ── Conversations séparées (comme ChatGPT/Claude) ──
  const { data: conversations = [] } = useAiConversations(uid);
  // undefined = pas encore initialisé ; null = « nouvelle conversation » vide (pas encore créée en base).
  const [conversationId, setConversationId] = useState<string | null | undefined>(undefined);
  // Initialise sur la conversation la plus récente (ou « nouvelle » si aucune) une fois la liste chargée.
  useEffect(() => {
    if (conversationId === undefined) setConversationId(conversations[0]?.id ?? null);
  }, [conversations, conversationId]);
  // Si la conversation courante disparaît (supprimée ailleurs), on bascule sur la plus récente.
  useEffect(() => {
    if (conversationId && !conversations.some((cv) => cv.id === conversationId)) {
      setConversationId(conversations[0]?.id ?? null);
    }
  }, [conversations, conversationId]);
  const [showConvs, setShowConvs] = useState(false);
  const createConv = useCreateConversation(uid);
  const renameConv = useRenameConversation(uid);
  const delConv = useDeleteConversation(uid);
  const { guard: usageGuard } = useUsageGuard(uid);
  const currentConv = conversations.find((cv) => cv.id === conversationId) ?? null;

  const { data: history } = useAiMessages(uid, conversationId ?? null);
  useAiMessagesRealtime(uid);
  const ask = useAskAi(uid);
  const purchase = usePurchaseExtraCredits(uid);

  // ── Défilement : on amène la QUESTION en HAUT de l'écran (on lit la réponse depuis son début),
  //    au lieu de sauter en bas. Vaut pour l'envoi d'une question ET le clic sur une analyse. ──
  const questionAnchorRef = useRef<View>(null);
  const lastUserId = useMemo(() => {
    const h = history ?? [];
    for (let i = h.length - 1; i >= 0; i--) if (h[i].role === 'user') return h[i].id;
    return null;
  }, [history]);
  const scrollToQuestion = useCallback(() => {
    const node = scrollRef.current as any;
    const anchor = questionAnchorRef.current as any;
    if (!node || !anchor?.measureLayout) return;
    const inner = node.getInnerViewNode?.() ?? node;
    try {
      anchor.measureLayout(
        inner,
        (_x: number, y: number) => node.scrollTo?.({ y: Math.max(0, y - 12), animated: true }),
        () => {},
      );
    } catch { /* noop */ }
  }, []);
  const prevLastUserId = useRef<string | null>(null);
  useEffect(() => {
    if (lastUserId && lastUserId !== prevLastUserId.current) {
      prevLastUserId.current = lastUserId;
      // La question vient d'apparaître (envoi ou analyse) → on la remonte en tête, une fois posée.
      setTimeout(scrollToQuestion, 120);
      setTimeout(scrollToQuestion, 480);
    }
  }, [lastUserId, scrollToQuestion]);

  /* ⚠️ Les TROIS conditions d'accès viennent de requêtes : l'abonnement (profil), le rôle admin
     (profil) et l'ouverture à tous (config IA). Tant qu'elles n'ont pas répondu, elles valent toutes
     `false` — l'écran « réservé aux abonnés » s'affichait donc une fraction de seconde à CHAQUE
     ouverture, y compris pour un abonné ou quand l'accès est ouvert à tous. On ne tranche qu'une
     fois les deux lectures posées. */
  const accessReady = profileReady && cfgReady;
  const allowed = isPremium || isAdmin || !!cfg?.open_to_all;
  const readOnly = isImpersonating || (!isPremium && !isAdmin && !cfg?.open_to_all); // consultation : pas d'envoi
  const remaining = quota?.remaining ?? 0;
  // Crédits payants (rechargés) : utilisables quand le quota mensuel est épuisé.
  const extraCredits = quota?.extra_credits ?? 0;
  // ── Compteur UNIQUE côté user : requêtes gratuites + rechargées confondues. En arrière-plan le
  //    serveur consomme d'abord le gratuit, puis le payant — mais l'utilisateur voit juste « X / Y ».
  const available = remaining + extraCredits;         // requêtes utilisables maintenant
  const totalRequests = (quota?.limit ?? 0) + extraCredits; // capacité totale du cycle
  const canSend = available > 0;
  const packs: AiCreditPack[] = cfg?.extra_credit_packs ?? [];
  const [showPaywall, setShowPaywall] = useState(false);

  const eur = (cents: number) => (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  const buyPack = async (pack: AiCreditPack) => {
    try {
      await purchase.mutateAsync(pack);
      setShowPaywall(false);
      Alert.alert('Merci ! 🙌', `Achat validé. Tes ${pack.credits} requêtes arrivent dans quelques secondes (le temps de la validation).`);
    } catch (e: any) {
      const reason = e?.reason;
      if (reason === 'cancelled') return; // l'utilisateur a annulé → silencieux
      if (reason === 'not_supported') {
        Alert.alert('Sur mobile uniquement', 'La recharge de requêtes se fait depuis l\'application mobile Relyka (iOS / Android).');
      } else if (reason === 'not_configured') {
        Alert.alert('Produit indisponible', e?.message ?? 'Ce pack n\'est pas encore disponible. Réessaie plus tard.');
      } else {
        Alert.alert('Achat impossible', e?.message ?? 'Réessaie plus tard.');
      }
    }
  };

  // ── Instantané financier anonymisé (même logique partagée avec l'onglet Snapshot admin) ──
  const { ready: snapshotReady, build: buildSnap, currentBilanMetrics } = useUserSnapshot(uid);
  const saveBilanMetrics = useSaveBilanMetrics(uid);

  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  // Confirmation « utiliser 1 requête » : modal custom (une Alert native ne peut pas porter la case
  // « ne plus me demander »). Préférence persistée côté compte (ui_prefs.ai_confirm_skip).
  const { prefs: uiPrefs, patch: patchUiPrefs } = useUiPrefs(uid);
  const [confirmPayload, setConfirmPayload] = useState<RunPayload | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  type RunPayload = { kind: 'analysis' | 'chat'; analysis_key?: string; question?: string };

  // Titre d'une nouvelle conversation à partir de la première demande.
  const titleFor = (payload: RunPayload) =>
    payload.kind === 'analysis'
      ? ((prompts ?? []).find((p) => p.key === payload.analysis_key)?.title ?? 'Analyse')
      : (payload.question ?? 'Nouvelle conversation');

  // Envoi effectif (après validation) — consomme 1 requête en cas de succès.
  const execute = async (payload: RunPayload) => {
    // Nouvelle conversation → une ligne sera créée en base : vérifier la limite AVANT (message +
    // renvoi Premium / suppression). Le serveur reste le vrai garde-fou.
    if (!conversationId && !(await usageGuard('ai_conversation'))) return;
    if (payload.kind === 'chat') setInput('');
    setPending(true);
    try {
      // Crée la conversation à la volée si on est sur un fil « neuf » (évite les conversations vides).
      let convId = conversationId ?? null;
      if (!convId) {
        convId = await createConv.mutateAsync(titleFor(payload));
        setConversationId(convId);
      }
      const res = await ask.mutateAsync({ ...payload, snapshot: buildSnap(), conversation_id: convId });
      // Bilan global réussi → persiste les métriques top-line pour l'ÉVOLUTION du prochain bilan.
      if (res.ok && !res.queued && payload.kind === 'analysis' && payload.analysis_key === 'analysis_global' && currentBilanMetrics) {
        saveBilanMetrics.mutate(currentBilanMetrics);
      }
      if (res.queued) {
        Alert.alert('Réessai en cours', "Le service n'a pas pu répondre tout de suite. Ta demande a été transmise — tu seras notifié dès qu'une réponse est disponible. Cette requête n'a pas été décomptée.");
      } else if (!res.ok) {
        if (res.error === 'quota_exceeded') setShowPaywall(true);
        else if (res.error === 'premium_required') Alert.alert('Réservé Premium', 'Cette fonctionnalité est réservée aux abonnés Premium.');
        else Alert.alert('Indisponible', `Le service de conseils est momentanément indisponible.${res.error ? `\n\n(détail : ${res.error})` : ''}`);
      }
    } catch (e: any) {
      // Limite d'usage : déjà signalée par le backstop global (message convivial) → pas de doublon.
      if (!parseUsageLimitError(e)) Alert.alert('Erreur', e?.message ?? 'Échec de la requête.');
    } finally {
      setPending(false);
      // La réponse est là → on garde la QUESTION en haut (lecture depuis le début), pas de saut en bas.
      setTimeout(scrollToQuestion, 200);
    }
  };

  // Validation préalable : une seule confirmation, sans distinction gratuit/payant (transparent pour le
  // user). Case « ne plus me demander » (ui_prefs.ai_confirm_skip) → envoi direct les fois suivantes.
  const run = (payload: RunPayload) => {
    if (readOnly || pending) return;
    if (!snapshotReady) { Alert.alert('Patiente', 'Tes données sont en cours de chargement.'); return; }
    // Plus aucune requête → on propose le click-to-pay (recharge).
    if (!canSend) { setShowPaywall(true); return; }
    if (uiPrefs.ai_confirm_skip === true) { execute(payload); return; }
    setConfirmSkip(false);
    setConfirmPayload(payload);
  };

  const confirmSend = () => {
    const payload = confirmPayload;
    setConfirmPayload(null);
    if (confirmSkip) patchUiPrefs({ ai_confirm_skip: true }); // mémorisé côté compte
    if (payload) execute(payload);
  };

  const sendChat = () => {
    const q = input.trim();
    if (!q) return;
    run({ kind: 'chat', question: q });
  };

  // Démarre un fil neuf (créé en base au premier message). Vérifie la limite AVANT (message
  // immédiat au clic « + » si l'utilisateur est déjà au plafond de conversations).
  const newConversation = async () => {
    if (!(await usageGuard('ai_conversation'))) return;
    setConversationId(null);
    setInput('');
    setShowConvs(false);
  };

  const selectConversation = (id: string) => {
    setConversationId(id);
    setShowConvs(false);
  };

  const deleteConversation = (conv: AiConversation) => {
    Alert.alert('Supprimer la conversation', `« ${conv.title} » sera définitivement supprimée.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => delConv.mutate(conv.id) },
    ]);
  };

  const renamePrompt = (conv: AiConversation) => {
    if (Platform.OS === 'web') {
      const t = (globalThis as any).prompt?.('Renommer la conversation', conv.title);
      if (t && t.trim()) renameConv.mutate({ id: conv.id, title: t.trim().slice(0, 80) });
      return;
    }
    (Alert as any).prompt?.(
      'Renommer la conversation',
      undefined,
      (t: string) => { if (t && t.trim()) renameConv.mutate({ id: conv.id, title: t.trim().slice(0, 80) }); },
      'plain-text',
      conv.title,
    );
  };

  // Supprime la conversation courante (bouton corbeille de l'en-tête).
  const confirmDelete = () => {
    if (!currentConv) return;
    deleteConversation(currentConv);
  };

  const analyses = (prompts ?? []).filter((p) => p.key.startsWith('analysis_') && p.is_active);

  // On ne sait pas encore si l'accès est ouvert : on attend plutôt que d'annoncer un refus à tort.
  if (!accessReady) {
    return (
      <View style={s.root}>
        <StatusBar style={c.mode === 'light' ? 'dark' : 'light'} />
        <ScreenGradient />
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} edges={['left', 'right']}>
          <ActivityIndicator size="large" color={c.emerald} />
        </SafeAreaView>
      </View>
    );
  }

  // ── Paywall (ni Premium, ni admin, ni ouvert à tous) ──
  if (!allowed) {
    return (
      <View style={s.root}>
        <StatusBar style={c.mode === 'light' ? 'dark' : 'light'} />
        <ScreenGradient />
        <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={goBack} accessibilityRole="button">
              <Ionicons name="arrow-back" size={22} color={c.text} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>Retour</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
            <Ionicons name="sparkles-outline" size={48} color={c.amber} />
            <Text style={s.payTitle}>Conseils Intelligents réservés aux abonnés Premium</Text>
            <Text style={s.paySub}>Analyses personnalisées de tes finances et conseiller en discussion : passe Premium pour en profiter.</Text>
            <TouchableOpacity style={s.payBtn} onPress={() => router.push('/(tabs)/(secondary)/premium' as any)} activeOpacity={0.85}>
              <Ionicons name="star" size={16} color="#0f172a" />
              <Text style={s.payBtnTxt}>Passer Premium</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style={c.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[{ flex: 1 }, pageColumn(isDesktop, 'settings', 0)]} edges={['left', 'right']}>
        {/* La colonne se rétrécit de la hauteur visible du clavier → la barre reste posée dessus. */}
        <Reanimated.View style={[{ flex: 1 }, kbAvoid]}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={goBack}>
              <Ionicons name="arrow-back" size={22} color={c.text} />
              <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>Retour</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setShowConvs(true)} style={s.headBtn} accessibilityRole="button" accessibilityLabel="Mes conversations">
              <Ionicons name="chatbubbles-outline" size={18} color={c.text} />
              {conversations.length > 0 && <Text style={s.headBtnCount}>{conversations.length}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={newConversation} style={s.headBtn} accessibilityRole="button" accessibilityLabel="Nouvelle conversation" disabled={readOnly}>
              <Ionicons name="add" size={22} color={readOnly ? c.textSecondary : c.emerald} />
            </TouchableOpacity>
            {!!currentConv && (
              <TouchableOpacity onPress={confirmDelete} style={s.trashBtn} disabled={delConv.isPending} accessibilityLabel="Supprimer cette conversation">
                <Ionicons name="trash-outline" size={18} color={c.danger} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            {/* Titre + compteur */}
            <View style={s.titleRow}>
              <View style={s.iconBadge}><Ionicons name="sparkles" size={20} color={c.emerald} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Conseils Intelligents</Text>
                <TouchableOpacity onPress={() => setShowConvs(true)} activeOpacity={0.7}>
                  <Text style={s.sub} numberOfLines={1}>
                    {currentConv ? currentConv.title : 'Nouvelle conversation'}
                    {'  '}<Ionicons name="chevron-down" size={11} color={c.textSecondary} />
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.counter} activeOpacity={0.8} onPress={() => setShowPaywall(true)} accessibilityRole="button" accessibilityLabel="Recharger mes requêtes IA">
                <Text style={s.counterNum}>{available}</Text>
                <Text style={s.counterLbl}>/ {totalRequests} requêtes</Text>
              </TouchableOpacity>
            </View>

            {/* Plus aucune requête disponible → bandeau click-to-pay. */}
            {available <= 0 && !readOnly && (
              <TouchableOpacity style={s.rechargeBanner} activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
                <Ionicons name="flash" size={18} color={c.emerald} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rechargeTitle}>Tu n'as plus de requêtes disponibles</Text>
                  <Text style={s.rechargeSub}>Recharge des requêtes à l'unité pour continuer, sans attendre le mois prochain.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.emerald} />
              </TouchableOpacity>
            )}

            {/* Consentement */}
            <Text style={s.consent}>{cfg?.consent_text ?? 'Un résumé anonymisé de tes finances est envoyé à un service d\'IA tiers pour générer ces conseils.'}</Text>

            {readOnly && (
              <View style={s.banner}>
                <Ionicons name="eye-outline" size={15} color={c.textSecondary} />
                <Text style={s.bannerTxt}>{isImpersonating ? 'Mode consultation : lecture seule.' : 'Historique en lecture seule (offre gratuite).'}</Text>
              </View>
            )}

            {/* Analyses structurées */}
            <Text style={s.sectionLbl}>Analyses</Text>
            <View style={{ gap: 8 }}>
              {analyses.map((a) => (
                <TouchableOpacity key={a.key} style={[s.analysisBtn, (readOnly || pending) && { opacity: 0.5 }]} disabled={readOnly || pending} onPress={() => run({ kind: 'analysis', analysis_key: a.key })}>
                  <Ionicons name="document-text-outline" size={18} color={c.emerald} />
                  <Text style={s.analysisTxt}>{a.title}</Text>
                  <Ionicons name="chevron-forward" size={16} color={c.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>

            {/* Historique / fil de discussion */}
            {!!history?.length && (
              <>
                <Text style={[s.sectionLbl, { marginTop: 18 }]}>Conversation</Text>
                <View style={{ gap: 10 }}>
                  {history.map((m) => (
                    <View key={m.id} ref={m.id === lastUserId ? questionAnchorRef : undefined}>
                      <Bubble m={m} s={s} c={c} />
                    </View>
                  ))}
                </View>
              </>
            )}

            {pending && (
              <View style={[s.bubbleAssistant, { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }]}>
                <ActivityIndicator size="small" color={c.emerald} />
                <Text style={{ color: c.textSecondary, fontSize: 13 }}>Le conseiller réfléchit…</Text>
              </View>
            )}

            {/* Questions prédéfinies */}
            {!readOnly && (
              <>
                <Text style={[s.sectionLbl, { marginTop: 18 }]}>Questions rapides</Text>
                <View style={s.chips}>
                  {(cfg?.predefined_questions ?? []).map((q, i) => (
                    <TouchableOpacity key={i} style={[s.chip, pending && { opacity: 0.5 }]} disabled={pending} onPress={() => run({ kind: 'chat', question: q })}>
                      <Text style={s.chipTxt}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Marge de scroll sous le contenu : on peut faire défiler « un peu plus bas » que le
                dernier message, même clavier ouvert. */}
            <View style={{ height: 48 }} />
          </ScrollView>

          {/* Barre de saisie : collée au bas de la colonne, que le KAV rétrécit. */}
          {!readOnly && (
            <View style={s.inputBar}>
              <TextInput
                style={s.input}
                value={input}
                onChangeText={setInput}
                placeholder="Pose ta question…"
                placeholderTextColor={c.textSecondary}
                multiline
                editable={!pending}
                onSubmitEditing={sendChat}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 350)}
              />
              <TouchableOpacity style={[s.sendBtn, (pending || !input.trim()) && { opacity: 0.5 }]} disabled={pending || !input.trim()} onPress={sendChat}>
                <Ionicons name="send" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </Reanimated.View>
      </SafeAreaView>

      {/* Paywall « click-to-pay » : offres de recharge de requêtes. */}
      <Modal visible={showPaywall} transparent animationType="fade" onRequestClose={() => setShowPaywall(false)}>
        {/* Fond tapable → ferme ; la feuille stoppe la propagation du tap. */}
        <Pressable style={s.payOverlay} onPress={() => setShowPaywall(false)}>
          <Pressable style={[s.paySheet, { paddingBottom: sheetPad }]} onPress={() => {}}>
            <View style={{ alignItems: 'center', marginBottom: 6 }}>
              <View style={s.iconBadge}><Ionicons name="flash" size={22} color={c.emerald} /></View>
            </View>
            <Text style={s.paySheetTitle}>Recharge tes conseils intelligents</Text>
            <Text style={s.paySheetSub}>
              {available > 0
                ? `Il te reste ${available} requête${available > 1 ? 's' : ''}. Ajoutes-en autant que tu veux : les requêtes achetées ne périment pas.`
                : 'Tu n\'as plus de requêtes. Achètes-en à l\'unité et continue tout de suite — sans passer Premium ni attendre le mois prochain.'}
            </Text>

            {packs.length === 0 ? (
              <Text style={[s.paySheetSub, { marginTop: 12 }]}>Offres bientôt disponibles.</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 14 }}>
                {packs.map((p) => {
                  const perUnit = p.credits > 0 ? p.price_cents / p.credits : p.price_cents;
                  return (
                    <TouchableOpacity key={p.id} style={s.packRow} activeOpacity={0.85} disabled={purchase.isPending} onPress={() => buyPack(p)}>
                      <View style={s.packLeft}>
                        <Text style={s.packCredits}>{p.credits} requêtes</Text>
                        <Text style={s.packUnit}>{eur(perUnit)} / requête</Text>
                      </View>
                      <View style={s.packPrice}>
                        {purchase.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.packPriceTxt}>{eur(p.price_cents)}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <Text style={s.payLegal}>
              Paiement sécurisé via l'App Store / Google Play. Les crédits sont ajoutés à ton compte après l'achat.
            </Text>
            <TouchableOpacity style={s.payClose} onPress={() => setShowPaywall(false)}>
              <Text style={s.payCloseTxt}>Plus tard</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Liste des conversations (historiques séparés). */}
      <Modal visible={showConvs} transparent animationType="fade" onRequestClose={() => setShowConvs(false)}>
        <Pressable style={s.payOverlay} onPress={() => setShowConvs(false)}>
          <Pressable style={s.convSheet} onPress={() => {}}>
            <View style={s.convHeader}>
              <Text style={s.convTitle}>Mes conversations</Text>
              <TouchableOpacity onPress={() => setShowConvs(false)} style={s.convClose}>
                <Ionicons name="close" size={20} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.convNewBtn} activeOpacity={0.85} onPress={newConversation} disabled={readOnly}>
              <Ionicons name="add-circle-outline" size={18} color={readOnly ? c.textSecondary : c.emerald} />
              <Text style={[s.convNewTxt, readOnly && { color: c.textSecondary }]}>Nouvelle conversation</Text>
            </TouchableOpacity>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {conversations.length === 0 ? (
                <Text style={s.convEmpty}>Aucune conversation pour l'instant. Pose une question pour en démarrer une.</Text>
              ) : (
                conversations.map((cv) => {
                  const active = cv.id === conversationId;
                  return (
                    <View key={cv.id} style={[s.convRow, active && s.convRowActive]}>
                      <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => selectConversation(cv.id)}>
                        <Text style={[s.convRowTitle, active && { color: c.emerald }]} numberOfLines={1}>{cv.title}</Text>
                        <Text style={s.convRowDate}>{new Date(cv.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => renamePrompt(cv)} style={s.convAction} accessibilityLabel="Renommer">
                        <Ionicons name="create-outline" size={17} color={c.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteConversation(cv)} style={s.convAction} accessibilityLabel="Supprimer">
                        <Ionicons name="trash-outline" size={17} color={c.danger} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Confirmation « utiliser 1 requête » — dialogue CENTRÉ, avec case « ne plus me demander ». */}
      <Modal visible={confirmPayload != null} transparent animationType="fade" onRequestClose={() => setConfirmPayload(null)}>
        <Pressable style={s.confirmOverlay} onPress={() => setConfirmPayload(null)}>
          <Pressable style={s.confirmCard} onPress={() => {}}>
            <Text style={[s.paySheetTitle, { textAlign: 'left' }]}>Utiliser une requête ?</Text>
            <Text style={[s.paySheetSub, { textAlign: 'left', marginTop: 8 }]}>
              Cette demande utilise 1 requête. Il t'en restera {Math.max(0, available - 1)} sur {totalRequests}.
            </Text>
            <TouchableOpacity style={s.skipRow} activeOpacity={0.7} onPress={() => setConfirmSkip((v) => !v)}>
              <View style={[s.skipBox, confirmSkip && { backgroundColor: c.emerald, borderColor: c.emerald }]}>
                {confirmSkip && <Ionicons name="checkmark" size={14} color={c.bg} />}
              </View>
              <Text style={s.skipTxt}>Ne plus me demander : envoyer directement les prochaines fois</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setConfirmPayload(null)}>
                <Text style={{ color: c.text, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmGo} onPress={confirmSend}>
                <Text style={{ color: c.bg, fontWeight: '800' }}>Continuer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <CalculatorButton page="conseils-ia" />
    </View>
  );
}

function Bubble({ m, s, c }: { m: AiMessage; s: any; c: any }) {
  if (m.role === 'user') {
    return (
      <View style={s.bubbleUserWrap}>
        <View style={s.bubbleUser}><Text style={s.bubbleUserTxt}>{m.content}</Text></View>
      </View>
    );
  }
  const isAdminMsg = m.role === 'admin';
  const stamp = formatStamp(m.created_at);
  // Réponses de l'IA : rendu en CARTES si structuré (synthèse + sections), sinon texte simple.
  // Les réponses HUMAINES (équipe Relyka) restent en texte brut.
  const report = useMemo(() => (isAdminMsg ? null : parseAiReport(m.content)), [isAdminMsg, m.content]);
  const asCards = !!report && (!!report.summary || report.sections.length >= 2);

  if (asCards && report) {
    return (
      <View style={s.reportWrap}>
        {!!stamp && <View style={s.bubbleHeader}><Text style={s.stamp}>{stamp}</Text></View>}
        <AiReport report={report} c={c} baseTextStyle={s.bubbleAssistantTxt} />
      </View>
    );
  }
  return (
    <View style={s.bubbleAssistant}>
      {!!stamp && (
        <View style={s.bubbleHeader}>
          <Text style={s.stamp}>{stamp}</Text>
        </View>
      )}
      <AiRichText text={m.content} style={s.bubbleAssistantTxt} />
      {/* Le modèle utilisé n'est pas affiché (détail d'implémentation). On garde en revanche la
          mention « équipe Relyka », qui distingue une réponse humaine d'une réponse de l'IA. */}
      {isAdminMsg && <Text style={s.modelTag}>Réponse de l'équipe Relyka</Text>}
    </View>
  );
}

/** Date + heure d'une réponse (« 2 juil. · 14:32 »). Vide si date invalide. */
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    headBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, minWidth: 36, paddingHorizontal: 8, borderRadius: 18, alignSelf: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    headBtnCount: { fontSize: 12, fontWeight: '800', color: c.text },
    trashBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.danger + '44' },
    convSheet: { backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, padding: 18, paddingBottom: 28 },
    convHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    convTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: c.text },
    convClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    convNewBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.emerald + '12', borderWidth: 1, borderColor: c.emerald + '55', borderRadius: 12, padding: 12, marginBottom: 10 },
    convNewTxt: { fontSize: 14, fontWeight: '800', color: c.emerald },
    convEmpty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 18, lineHeight: 18 },
    convRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
    convRowActive: { borderColor: c.emerald + '88', backgroundColor: c.emerald + '10' },
    convRowTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    convRowDate: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    convAction: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    scroll: { paddingHorizontal: 16, paddingBottom: 16 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
    iconBadge: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.emerald + '1A', alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 20, fontWeight: '800', color: c.text },
    sub: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
    counter: { alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
    counterNum: { fontSize: 18, fontWeight: '800', color: c.emerald },
    counterLbl: { fontSize: 9.5, color: c.textSecondary },
    counterExtra: { fontSize: 9.5, fontWeight: '800', color: c.amber, marginTop: 1 },
    rechargeBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.emerald + '12', borderWidth: 1, borderColor: c.emerald + '55', borderRadius: 12, padding: 12, marginBottom: 4 },
    rechargeTitle: { fontSize: 13.5, fontWeight: '800', color: c.text },
    rechargeSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    payOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    paySheet: { ...sheetWidth, backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, padding: 22, paddingBottom: 32 },
    paySheetTitle: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' },
    paySheetSub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
    // Confirmation « utiliser 1 requête » — dialogue centré (pas une feuille du bas)
    confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    confirmCard: { width: '100%', maxWidth: 400, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 22 },
    skipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingHorizontal: 4 },
    skipBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },
    skipTxt: { flex: 1, fontSize: 12.5, color: c.text, lineHeight: 17 },
    confirmCancel: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder },
    confirmGo: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: c.emerald },
    packRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14 },
    packLeft: { flex: 1 },
    packCredits: { fontSize: 15.5, fontWeight: '800', color: c.text },
    packUnit: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    packPrice: { minWidth: 74, alignItems: 'center', backgroundColor: c.emerald, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
    packPriceTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },
    payLegal: { fontSize: 10.5, color: c.textSecondary, textAlign: 'center', marginTop: 14, lineHeight: 15 },
    payClose: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
    payCloseTxt: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    consent: { fontSize: 11, fontStyle: 'italic', color: c.textSecondary, lineHeight: 15, marginTop: 12 },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderRadius: 10, padding: 10, marginTop: 10 },
    bannerTxt: { fontSize: 12, color: c.textSecondary, flex: 1 },
    sectionLbl: { fontSize: 12.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 16, marginBottom: 8 },
    analysisBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14 },
    analysisTxt: { flex: 1, fontSize: 14.5, fontWeight: '700', color: c.text },
    bubbleUserWrap: { alignItems: 'flex-end' },
    bubbleUser: { maxWidth: '85%', backgroundColor: c.emerald, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
    bubbleUserTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },
    bubbleAssistant: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, borderBottomLeftRadius: 4, padding: 14 },
    // Rapport en cartes : pas de bulle-conteneur (chaque section EST une carte), juste l'espace.
    reportWrap: { marginRight: 8 },
    bubbleHeader: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 },
    stamp: { fontSize: 10.5, color: c.textSecondary, fontWeight: '600' },
    bubbleAssistantTxt: { color: c.text, fontSize: 14, lineHeight: 21 },
    modelTag: { fontSize: 10.5, color: c.textSecondary, marginTop: 8, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: c.emerald + '14', borderWidth: 1, borderColor: c.emerald + '44', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
    chipTxt: { fontSize: 13, color: c.emerald, fontWeight: '600' },
    inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.cardBorder, backgroundColor: c.bg },
    input: { flex: 1, maxHeight: 110, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: c.text, fontSize: 14 },
    sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
    payTitle: { color: c.text, marginTop: 14, fontSize: 17, fontWeight: '800', textAlign: 'center' },
    paySub: { color: c.textSecondary, marginTop: 8, fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
    payBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.amber, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13, marginTop: 20 },
    payBtnTxt: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  });
}
