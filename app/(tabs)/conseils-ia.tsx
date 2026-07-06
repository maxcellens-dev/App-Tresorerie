/**
 * Conseils IA — page Premium (ou ouverte à tous via ai_config.open_to_all / admin).
 * Affiche le compteur de requêtes, 3 analyses structurées, un chat avec questions prédéfinies, et
 * l'historique. L'appel au modèle passe par l'Edge Function `ai-advice` (clé API jamais côté client).
 * L'instantané financier envoyé est ANONYMISÉ (montants + catégories uniquement).
 */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, Pressable } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { useNavBack } from '../../hooks/useNavBack';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { usePlan } from '../../hooks/usePlan';
import { useProfile } from '../../hooks/useProfile';
import { useUserSnapshot } from '../../hooks/useUserSnapshot';
import { useAiConfig, useAiQuota, useAiPrompts, useAiMessages, useAiMessagesRealtime, useAiExtraCreditsRealtime, useAskAi, usePurchaseExtraCredits, useAiConversations, useCreateConversation, useRenameConversation, useDeleteConversation, type AiMessage, type AiCreditPack, type AiConversation } from '../../hooks/useAi';

export default function ConseilsIaScreen() {
  const c = useAppColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { user, isImpersonating } = useAuth();
  const uid = user?.id;
  const goBack = useNavBack();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const { isPremium } = usePlan(uid);
  const { data: profile } = useProfile(uid);
  const isAdmin = (profile as any)?.is_admin === true;

  const { data: cfg } = useAiConfig();
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
  const currentConv = conversations.find((cv) => cv.id === conversationId) ?? null;

  const { data: history } = useAiMessages(uid, conversationId ?? null);
  useAiMessagesRealtime(uid);
  const ask = useAskAi(uid);
  const purchase = usePurchaseExtraCredits(uid);

  const allowed = isPremium || isAdmin || !!cfg?.open_to_all;
  const readOnly = isImpersonating || (!isPremium && !isAdmin && !cfg?.open_to_all); // consultation : pas d'envoi
  const remaining = quota?.remaining ?? 0;
  // Crédits payants (rechargés) : utilisables quand le quota mensuel est épuisé.
  const extraCredits = quota?.extra_credits ?? 0;
  const canSend = remaining > 0 || extraCredits > 0;
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
  const { ready: snapshotReady, build: buildSnap } = useUserSnapshot(uid);

  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  type RunPayload = { kind: 'analysis' | 'chat'; analysis_key?: string; question?: string };

  // Titre d'une nouvelle conversation à partir de la première demande.
  const titleFor = (payload: RunPayload) =>
    payload.kind === 'analysis'
      ? ((prompts ?? []).find((p) => p.key === payload.analysis_key)?.title ?? 'Analyse')
      : (payload.question ?? 'Nouvelle conversation');

  // Envoi effectif (après validation) — consomme 1 requête en cas de succès.
  const execute = async (payload: RunPayload) => {
    if (payload.kind === 'chat') setInput('');
    setPending(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      // Crée la conversation à la volée si on est sur un fil « neuf » (évite les conversations vides).
      let convId = conversationId ?? null;
      if (!convId) {
        convId = await createConv.mutateAsync(titleFor(payload));
        setConversationId(convId);
      }
      const res = await ask.mutateAsync({ ...payload, snapshot: buildSnap(), conversation_id: convId });
      if (res.queued) {
        Alert.alert('Réessai en cours', "Le service n'a pas pu répondre tout de suite. Ta demande a été transmise — tu seras notifié dès qu'une réponse est disponible. Cette requête n'a pas été décomptée.");
      } else if (!res.ok) {
        if (res.error === 'quota_exceeded') setShowPaywall(true);
        else if (res.error === 'premium_required') Alert.alert('Réservé Premium', 'Cette fonctionnalité est réservée aux abonnés Premium.');
        else Alert.alert('Indisponible', `Le service de conseils est momentanément indisponible.${res.error ? `\n\n(détail : ${res.error})` : ''}`);
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Échec de la requête.');
    } finally {
      setPending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  // Validation préalable : prévient que la demande consomme 1 requête (quota mensuel OU crédit rechargé).
  const run = (payload: RunPayload) => {
    if (readOnly || pending) return;
    if (!snapshotReady) { Alert.alert('Patiente', 'Tes données sont en cours de chargement.'); return; }
    // Plus rien de disponible → on propose le click-to-pay (recharge).
    if (!canSend) { setShowPaywall(true); return; }
    // Quota mensuel épuisé mais crédits rechargés dispo → on consomme un crédit payant.
    if (remaining <= 0) {
      Alert.alert(
        'Utiliser un crédit rechargé ?',
        `Ton quota mensuel est épuisé. Cette demande utilisera 1 de tes ${extraCredits} crédit(s) rechargé(s).`,
        [{ text: 'Annuler', style: 'cancel' }, { text: 'Continuer', onPress: () => execute(payload) }],
      );
      return;
    }
    Alert.alert(
      'Utiliser une requête ?',
      `Cette demande consomme 1 requête de ton quota mensuel.\nIl t'en restera ${remaining - 1} sur ${quota?.limit ?? 0} ce mois-ci.${extraCredits > 0 ? `\n(+ ${extraCredits} crédit(s) rechargé(s) en réserve)` : ''}`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Continuer', onPress: () => execute(payload) },
      ],
    );
  };

  const sendChat = () => {
    const q = input.trim();
    if (!q) return;
    run({ kind: 'chat', question: q });
  };

  // Démarre un fil neuf (créé en base au premier message).
  const newConversation = () => {
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
            <Text style={s.payTitle}>Conseils IA réservés aux abonnés Premium</Text>
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
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
                <Text style={s.title}>Conseils IA</Text>
                <TouchableOpacity onPress={() => setShowConvs(true)} activeOpacity={0.7}>
                  <Text style={s.sub} numberOfLines={1}>
                    {currentConv ? currentConv.title : 'Nouvelle conversation'}
                    {'  '}<Ionicons name="chevron-down" size={11} color={c.textSecondary} />
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.counter} activeOpacity={0.8} onPress={() => setShowPaywall(true)} accessibilityRole="button" accessibilityLabel="Recharger mes requêtes IA">
                <Text style={s.counterNum}>{remaining}</Text>
                <Text style={s.counterLbl}>/ {quota?.limit ?? 0} ce mois</Text>
                {extraCredits > 0 && <Text style={s.counterExtra}>+{extraCredits} rechargé{extraCredits > 1 ? 's' : ''}</Text>}
              </TouchableOpacity>
            </View>

            {/* Quota mensuel épuisé → bandeau click-to-pay (sauf s'il reste des crédits rechargés). */}
            {remaining <= 0 && extraCredits <= 0 && !readOnly && (
              <TouchableOpacity style={s.rechargeBanner} activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
                <Ionicons name="flash" size={18} color={c.emerald} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rechargeTitle}>Tu as utilisé toutes tes analyses ce mois</Text>
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
                  {history.map((m) => <Bubble key={m.id} m={m} s={s} c={c} />)}
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

            <View style={{ height: 8 }} />
          </ScrollView>

          {/* Barre de saisie */}
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
              />
              <TouchableOpacity style={[s.sendBtn, (pending || !input.trim()) && { opacity: 0.5 }]} disabled={pending || !input.trim()} onPress={sendChat}>
                <Ionicons name="send" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Paywall « click-to-pay » : offres de recharge de requêtes. */}
      <Modal visible={showPaywall} transparent animationType="fade" onRequestClose={() => setShowPaywall(false)}>
        {/* Fond tapable → ferme ; la feuille stoppe la propagation du tap. */}
        <Pressable style={s.payOverlay} onPress={() => setShowPaywall(false)}>
          <Pressable style={s.paySheet} onPress={() => {}}>
            <View style={{ alignItems: 'center', marginBottom: 6 }}>
              <View style={s.iconBadge}><Ionicons name="flash" size={22} color={c.emerald} /></View>
            </View>
            <Text style={s.paySheetTitle}>Recharge tes conseils IA</Text>
            <Text style={s.paySheetSub}>
              {extraCredits > 0
                ? `Il te reste ${extraCredits} crédit(s) rechargé(s). Ajoute-en autant que tu veux : ils ne périment pas.`
                : 'Ton quota mensuel est épuisé. Achète des requêtes à l\'unité et continue tout de suite — sans passer Premium ni attendre le mois prochain.'}
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
  return (
    <View style={s.bubbleAssistant}>
      {!!stamp && (
        <View style={s.bubbleHeader}>
          <Text style={s.stamp}>{stamp}</Text>
        </View>
      )}
      <Text style={s.bubbleAssistantTxt}>{m.content}</Text>
      <Text style={s.modelTag}>{isAdminMsg ? 'Réponse de l\'équipe Relyka' : (m.model ?? 'IA')}</Text>
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
    paySheet: { backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, padding: 22, paddingBottom: 32 },
    paySheetTitle: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' },
    paySheetSub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
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
