/**
 * Conseils IA — page Premium (ou ouverte à tous via ai_config.open_to_all / admin).
 * Affiche le compteur de requêtes, 3 analyses structurées, un chat avec questions prédéfinies, et
 * l'historique. L'appel au modèle passe par l'Edge Function `ai-advice` (clé API jamais côté client).
 * L'instantané financier envoyé est ANONYMISÉ (montants + catégories uniquement).
 */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { useNavBack } from '../../hooks/useNavBack';
import { useRouter } from 'expo-router';
import { usePlan } from '../../hooks/usePlan';
import { useProfile } from '../../hooks/useProfile';
import { usePilotageData } from '../../hooks/usePilotageData';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useCredits } from '../../hooks/useCredits';
import { computeAmortization } from '../../lib/amortization';
import { todayISO } from '../../lib/dateUtils';
import { buildSnapshot } from '../../lib/aiSnapshot';
import { CURRENCY_SYMBOL } from '../../lib/currency';
import { useAiConfig, useAiQuota, useAiPrompts, useAiMessages, useAskAi, useDeleteAiHistory, type AiMessage } from '../../hooks/useAi';

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
  const { data: quota } = useAiQuota(uid);
  const { data: prompts } = useAiPrompts();
  const { data: history } = useAiMessages(uid);
  const ask = useAskAi(uid);
  const delHistory = useDeleteAiHistory(uid);

  const allowed = isPremium || isAdmin || !!cfg?.open_to_all;
  const readOnly = isImpersonating || (!isPremium && !isAdmin && !cfg?.open_to_all); // consultation : pas d'envoi
  const remaining = quota?.remaining ?? 0;

  // ── Données pour l'instantané (anonymisé) ──
  const { data: pilotage } = usePilotageData(uid);
  const { data: transactions } = useTransactions(uid);
  const { data: categories } = useCategories(uid);
  const { data: credits } = useCredits(uid);

  const catById = useMemo(() => {
    const m = new Map<string, { name: string; parent_id?: string | null }>();
    for (const cat of categories ?? []) m.set(cat.id, { name: cat.name, parent_id: cat.parent_id });
    return m;
  }, [categories]);
  const grandCat = (id: string | null | undefined): string => {
    if (!id) return 'Sans catégorie';
    const cat = catById.get(id);
    if (!cat) return 'Sans catégorie';
    return cat.parent_id ? (catById.get(cat.parent_id)?.name ?? cat.name) : cat.name;
  };

  const expensesByCategory = useMemo(() => {
    if (!transactions) return [];
    const curYm = todayISO().slice(0, 7);
    const acc: Record<string, number> = {};
    for (const t of transactions) {
      if (t.linked_account_id || t.is_draft) continue;
      if (Number(t.amount) >= 0) continue;
      if (t.date.slice(0, 7) !== curYm) continue;
      const name = grandCat(t.category_id);
      acc[name] = (acc[name] ?? 0) + Math.abs(Number(t.amount));
    }
    return Object.entries(acc).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [transactions, catById]);

  const creditsSummary = useMemo(() => {
    const today = todayISO();
    return (credits ?? []).filter((cr) => cr.is_active && !cr.is_simulation).map((cr) => {
      const a = computeAmortization({ ...cr });
      const last = a.schedule[a.schedule.length - 1];
      return { principal: cr.principal, monthly: a.monthlyWithInsurance, ratePct: cr.rate_annual, crd: a.crdAtDate(today), endYM: last ? last.date.slice(0, 7) : null };
    });
  }, [credits]);

  const snapshotReady = !!pilotage;
  const buildSnap = () => buildSnapshot({
    currencySymbol: CURRENCY_SYMBOL,
    pilotage: pilotage!,
    expensesByCategory,
    credits: creditsSummary,
  });

  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  type RunPayload = { kind: 'analysis' | 'chat'; analysis_key?: string; question?: string };

  // Envoi effectif (après validation) — consomme 1 requête en cas de succès.
  const execute = async (payload: RunPayload) => {
    if (payload.kind === 'chat') setInput('');
    setPending(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const res = await ask.mutateAsync({ ...payload, snapshot: buildSnap() });
      if (res.queued) {
        Alert.alert('Réessai en cours', "Le service n'a pas pu répondre tout de suite. Ta demande a été transmise — tu seras notifié dès qu'une réponse est disponible. Cette requête n'a pas été décomptée.");
      } else if (!res.ok) {
        if (res.error === 'quota_exceeded') Alert.alert('Quota atteint', `Tu as utilisé tes ${res.limit} requête(s) ce mois-ci.`);
        else if (res.error === 'premium_required') Alert.alert('Réservé Premium', 'Cette fonctionnalité est réservée aux abonnés Premium.');
        else Alert.alert('Indisponible', "Le service de conseils est momentanément indisponible.");
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Échec de la requête.');
    } finally {
      setPending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  // Validation préalable : prévient que la demande consomme 1 requête du compteur.
  const run = (payload: RunPayload) => {
    if (readOnly || pending) return;
    if (!snapshotReady) { Alert.alert('Patiente', 'Tes données sont en cours de chargement.'); return; }
    if (remaining <= 0) {
      Alert.alert('Quota atteint', `Tu as utilisé tes ${quota?.limit ?? 0} requête(s) ce mois-ci.${!isPremium ? '\nPasse Premium pour 10 requêtes/mois.' : ''}`);
      return;
    }
    Alert.alert(
      'Utiliser une requête ?',
      `Cette demande consomme 1 requête de ton quota mensuel.\nIl t'en restera ${remaining - 1} sur ${quota?.limit ?? 0} ce mois-ci.`,
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

  const confirmDelete = () => {
    if (!history?.length) return;
    Alert.alert('Effacer l\'historique', 'Supprimer toutes tes conversations IA ? Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Effacer', style: 'destructive', onPress: () => delHistory.mutate() },
    ]);
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
            {!!history?.length && (
              <TouchableOpacity onPress={confirmDelete} style={s.trashBtn} disabled={delHistory.isPending}>
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
                <Text style={s.sub}>Analyses et conseils basés sur tes finances</Text>
              </View>
              <View style={s.counter}>
                <Text style={s.counterNum}>{remaining}</Text>
                <Text style={s.counterLbl}>/ {quota?.limit ?? 0} ce mois</Text>
              </View>
            </View>

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
  return (
    <View style={s.bubbleAssistant}>
      <Text style={s.bubbleAssistantTxt}>{m.content}</Text>
      <Text style={s.modelTag}>{isAdminMsg ? 'Réponse de l\'équipe Relyka' : (m.model ?? 'IA')}</Text>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    trashBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.danger + '44' },
    scroll: { paddingHorizontal: 16, paddingBottom: 16 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
    iconBadge: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.emerald + '1A', alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 20, fontWeight: '800', color: c.text },
    sub: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
    counter: { alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
    counterNum: { fontSize: 18, fontWeight: '800', color: c.emerald },
    counterLbl: { fontSize: 9.5, color: c.textSecondary },
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
