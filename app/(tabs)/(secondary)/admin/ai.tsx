/**
 * Admin — Conseils IA. Réglages (ouverture, quotas, consentement, paiement anticipé), modèles
 * (activation + ordre de bascule), prompts éditables + questions rapides, et tickets d'assistance
 * (relance sans quota / réponse manuelle dans le fil du user / résolution).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import {
  useAiConfig, useUpdateAiConfig, useAiPrompts, useUpdateAiPrompt, useAiTickets,
  useResolveAiTicket, useAdminReplyAi, useAdminRelaunchAi, type AiModel,
} from '../../../../hooks/useAi';

type Tab = 'settings' | 'models' | 'prompts' | 'tickets';

export default function AdminAi() {
  const c = useAppColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const { data: cfg, isLoading } = useAiConfig();
  const updateCfg = useUpdateAiConfig();
  const { data: prompts } = useAiPrompts();
  const updatePrompt = useUpdateAiPrompt();
  const { data: tickets } = useAiTickets();
  const resolveTicket = useResolveAiTicket();
  const adminReply = useAdminReplyAi();
  const relaunch = useAdminRelaunchAi();

  const [tab, setTab] = useState<Tab>('settings');

  if (!isAdmin) {
    return <View style={s.root}><SafeAreaView style={s.safe}><Text style={s.text}>Accès réservé aux administrateurs.</Text></SafeAreaView></View>;
  }

  return (
    <View style={s.root}>
      <StatusBar style={c.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={s.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={c.text} /><Text style={s.backLabel}>Retour</Text>
        </TouchableOpacity>
        <Text style={s.title}>Conseils IA</Text>

        {/* Onglets */}
        <View style={s.tabs}>
          {([['settings', 'Réglages'], ['models', 'Modèles'], ['prompts', 'Prompts'], ['tickets', `Tickets${tickets?.length ? ` (${tickets.length})` : ''}`]] as [Tab, string][]).map(([t, lbl]) => (
            <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabOn]} onPress={() => setTab(t)}>
              <Text style={[s.tabTxt, tab === t && s.tabTxtOn]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading || !cfg ? (
          <ActivityIndicator color={c.emerald} style={{ marginTop: 32 }} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            {tab === 'settings' && <SettingsTab c={c} s={s} cfg={cfg} updateCfg={updateCfg} />}
            {tab === 'models' && <ModelsTab c={c} s={s} models={cfg.models} updateCfg={updateCfg} />}
            {tab === 'prompts' && <PromptsTab c={c} s={s} cfg={cfg} prompts={prompts ?? []} updatePrompt={updatePrompt} updateCfg={updateCfg} />}
            {tab === 'tickets' && <TicketsTab c={c} s={s} tickets={tickets ?? []} resolveTicket={resolveTicket} adminReply={adminReply} relaunch={relaunch} />}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

/* ── Réglages ── */
function SettingsTab({ c, s, cfg, updateCfg }: any) {
  const [free, setFree] = useState(String(cfg.free_monthly_limit));
  const [prem, setPrem] = useState(String(cfg.premium_monthly_limit));
  const [cap, setCap] = useState(String(cfg.daily_global_cap));
  const [price, setPrice] = useState(String(cfg.pay_to_use_price_cents));
  const [consent, setConsent] = useState(cfg.consent_text);
  useEffect(() => {
    setFree(String(cfg.free_monthly_limit)); setPrem(String(cfg.premium_monthly_limit));
    setCap(String(cfg.daily_global_cap)); setPrice(String(cfg.pay_to_use_price_cents)); setConsent(cfg.consent_text);
  }, [cfg]);

  const Toggle = ({ label, desc, value, onToggle }: any) => (
    <View style={s.card}>
      <View style={{ flex: 1 }}><Text style={s.cardTitle}>{label}</Text><Text style={s.cardDesc}>{desc}</Text></View>
      <TouchableOpacity style={[s.switch, value && s.switchOn]} onPress={onToggle} disabled={updateCfg.isPending}><View style={[s.knob, value && s.knobOn]} /></TouchableOpacity>
    </View>
  );

  return (
    <>
      <Toggle label="Ouvrir à tous" desc="Rend les Conseils IA accessibles à TOUS (même non-Premium), pour une phase de découverte. Le quota gratuit s'applique." value={cfg.open_to_all} onToggle={() => updateCfg.mutate({ open_to_all: !cfg.open_to_all })} />

      <View style={s.card}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>Quota gratuit / mois</Text>
          <Text style={s.cardDesc}>Requêtes/mois pour un user gratuit (1 analyse OU 1 question = 1 requête).</Text>
        </View>
        <TextInput style={s.num} value={free} onChangeText={setFree} keyboardType="number-pad" onBlur={() => updateCfg.mutate({ free_monthly_limit: Math.max(0, parseInt(free) || 0) })} />
      </View>
      <View style={s.card}>
        <View style={{ flex: 1 }}><Text style={s.cardTitle}>Quota Premium / mois</Text><Text style={s.cardDesc}>Requêtes/mois pour un abonné Premium.</Text></View>
        <TextInput style={s.num} value={prem} onChangeText={setPrem} keyboardType="number-pad" onBlur={() => updateCfg.mutate({ premium_monthly_limit: Math.max(0, parseInt(prem) || 0) })} />
      </View>
      <View style={s.card}>
        <View style={{ flex: 1 }}><Text style={s.cardTitle}>Plafond global / jour</Text><Text style={s.cardDesc}>Garde-fou anti-dépassement du quota Gemini gratuit (tous users confondus). Au-delà → tickets.</Text></View>
        <TextInput style={s.num} value={cap} onChangeText={setCap} keyboardType="number-pad" onBlur={() => updateCfg.mutate({ daily_global_cap: Math.max(0, parseInt(cap) || 0) })} />
      </View>

      <Toggle label="Paiement à l'usage (anticipé)" desc="Permettre d'acheter des requêtes supplémentaires. PRÉVU mais NON ACTIVÉ pour l'instant." value={cfg.pay_to_use_enabled} onToggle={() => updateCfg.mutate({ pay_to_use_enabled: !cfg.pay_to_use_enabled })} />
      <View style={s.card}>
        <View style={{ flex: 1 }}><Text style={s.cardTitle}>Prix / requête (centimes)</Text><Text style={s.cardDesc}>Tarif unitaire si le paiement à l'usage est activé.</Text></View>
        <TextInput style={s.num} value={price} onChangeText={setPrice} keyboardType="number-pad" onBlur={() => updateCfg.mutate({ pay_to_use_price_cents: Math.max(0, parseInt(price) || 0) })} />
      </View>

      <Text style={s.lbl}>Texte de consentement</Text>
      <TextInput style={s.area} value={consent} onChangeText={setConsent} multiline />
      <TouchableOpacity style={s.saveBtn} onPress={() => updateCfg.mutate({ consent_text: consent })} disabled={updateCfg.isPending}>
        <Text style={s.saveTxt}>Enregistrer le consentement</Text>
      </TouchableOpacity>
    </>
  );
}

/* ── Modèles (ordre = ordre de bascule) ── */
function ModelsTab({ c, s, models, updateCfg }: { c: any; s: any; models: AiModel[]; updateCfg: any }) {
  const save = (next: AiModel[]) => updateCfg.mutate({ models: next });
  const toggle = (i: number) => { const n = models.map((m, j) => j === i ? { ...m, enabled: !m.enabled } : m); save(n); };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= models.length) return;
    const n = [...models]; [n[i], n[j]] = [n[j], n[i]]; save(n);
  };
  return (
    <>
      <Text style={s.hint}>Les modèles sont essayés de haut en bas : si le 1ᵉ échoue, on bascule sur le suivant. Désactive ceux que tu ne veux pas utiliser.</Text>
      {models.map((m, i) => (
        <View key={m.id} style={s.card}>
          <View style={{ marginRight: 8 }}>
            <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0}><Ionicons name="chevron-up" size={18} color={i === 0 ? c.cardBorder : c.textSecondary} /></TouchableOpacity>
            <TouchableOpacity onPress={() => move(i, 1)} disabled={i === models.length - 1}><Ionicons name="chevron-down" size={18} color={i === models.length - 1 ? c.cardBorder : c.textSecondary} /></TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}><Text style={s.cardTitle}>{m.label}</Text><Text style={s.cardDesc}>{m.id}</Text></View>
          <TouchableOpacity style={[s.switch, m.enabled && s.switchOn]} onPress={() => toggle(i)}><View style={[s.knob, m.enabled && s.knobOn]} /></TouchableOpacity>
        </View>
      ))}
    </>
  );
}

/* ── Prompts + questions rapides ── */
function PromptsTab({ c, s, cfg, prompts, updatePrompt, updateCfg }: any) {
  return (
    <>
      {prompts.map((p: any) => <PromptEditor key={p.key} s={s} p={p} updatePrompt={updatePrompt} />)}
      <QuestionsEditor c={c} s={s} cfg={cfg} updateCfg={updateCfg} />
    </>
  );
}

function PromptEditor({ s, p, updatePrompt }: any) {
  const [title, setTitle] = useState(p.title);
  const [tpl, setTpl] = useState(p.prompt_template);
  useEffect(() => { setTitle(p.title); setTpl(p.prompt_template); }, [p]);
  const dirty = title !== p.title || tpl !== p.prompt_template;
  return (
    <View style={s.promptCard}>
      <Text style={s.keyTag}>{p.key}</Text>
      <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="Titre" />
      <TextInput style={[s.area, { minHeight: 120 }]} value={tpl} onChangeText={setTpl} multiline placeholder="Modèle — {{SNAPSHOT}} et {{QUESTION}}" />
      <TouchableOpacity style={[s.saveBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty || updatePrompt.isPending} onPress={() => updatePrompt.mutate({ key: p.key, title, prompt_template: tpl })}>
        <Text style={s.saveTxt}>Enregistrer</Text>
      </TouchableOpacity>
    </View>
  );
}

function QuestionsEditor({ c, s, cfg, updateCfg }: any) {
  const [list, setList] = useState<string[]>(cfg.predefined_questions ?? []);
  useEffect(() => { setList(cfg.predefined_questions ?? []); }, [cfg]);
  const set = (i: number, v: string) => setList((l) => l.map((x, j) => j === i ? v : x));
  const dirty = JSON.stringify(list) !== JSON.stringify(cfg.predefined_questions ?? []);
  return (
    <View style={s.promptCard}>
      <Text style={s.keyTag}>Questions rapides</Text>
      {list.map((q, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={q} onChangeText={(v) => set(i, v)} />
          <TouchableOpacity onPress={() => setList((l) => l.filter((_, j) => j !== i))}><Ionicons name="close-circle" size={22} color={c.danger} /></TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={s.addRow} onPress={() => setList((l) => [...l, ''])}><Ionicons name="add" size={18} color={c.emerald} /><Text style={{ color: c.emerald, fontWeight: '700' }}>Ajouter une question</Text></TouchableOpacity>
      <TouchableOpacity style={[s.saveBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty || updateCfg.isPending} onPress={() => updateCfg.mutate({ predefined_questions: list.map((x) => x.trim()).filter(Boolean) })}>
        <Text style={s.saveTxt}>Enregistrer les questions</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ── Tickets ── */
function TicketsTab({ c, s, tickets, resolveTicket, adminReply, relaunch }: any) {
  if (!tickets.length) return <Text style={s.hint}>Aucun ticket en attente. 🎉</Text>;
  return tickets.map((t: any) => <TicketCard key={t.id} c={c} s={s} t={t} resolveTicket={resolveTicket} adminReply={adminReply} relaunch={relaunch} />);
}

function TicketCard({ c, s, t, resolveTicket, adminReply, relaunch }: any) {
  const [reply, setReply] = useState('');
  const req = t.request ?? {};
  const doRelaunch = () => {
    if (!req.snapshot) { Alert.alert('Relance impossible', "L'instantané n'a pas été enregistré pour ce ticket. Réponds manuellement."); return; }
    relaunch.mutate(
      { ticketId: t.id, profileId: t.profile_id, snapshot: req.snapshot, kind: req.kind, analysis_key: req.analysis_key, question: req.question },
      { onSuccess: (r: any) => Alert.alert(r?.ok ? 'Relancé' : 'Toujours indisponible', r?.ok ? 'La réponse a été postée dans le fil du user.' : 'Le modèle reste indisponible.') },
    );
  };
  const doReply = () => {
    const v = reply.trim(); if (!v) return;
    adminReply.mutate({ profileId: t.profile_id, content: v, ticketId: t.id }, { onSuccess: () => setReply('') });
  };
  return (
    <View style={s.promptCard}>
      <Text style={s.keyTag}>{req.kind === 'analysis' ? `Analyse · ${req.analysis_key}` : 'Question'}</Text>
      {req.question ? <Text style={s.cardDesc}>« {req.question} »</Text> : null}
      <Text style={[s.cardDesc, { marginTop: 4 }]}>User : {t.profile_id}</Text>
      {t.error ? <Text style={[s.cardDesc, { color: c.danger, marginTop: 2 }]} numberOfLines={2}>Erreur : {t.error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity style={[s.miniBtn, { backgroundColor: c.emerald }]} onPress={doRelaunch} disabled={relaunch.isPending}><Text style={s.miniTxt}>Relancer (sans quota)</Text></TouchableOpacity>
        <TouchableOpacity style={[s.miniBtn, { borderWidth: 1, borderColor: c.cardBorder }]} onPress={() => resolveTicket.mutate(t.id)} disabled={resolveTicket.isPending}><Text style={[s.miniTxt, { color: c.textSecondary }]}>Résoudre</Text></TouchableOpacity>
      </View>
      <TextInput style={[s.area, { minHeight: 70, marginTop: 10 }]} value={reply} onChangeText={setReply} multiline placeholder="Réponse manuelle (postée dans le fil du user)…" />
      <TouchableOpacity style={[s.saveBtn, !reply.trim() && { opacity: 0.4 }]} disabled={!reply.trim() || adminReply.isPending} onPress={doReply}><Text style={s.saveTxt}>Répondre & résoudre</Text></TouchableOpacity>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
    title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 12 },
    tabs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
    tab: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    tabOn: { backgroundColor: c.emerald + '18', borderColor: c.emerald },
    tabTxt: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },
    tabTxtOn: { color: c.emerald, fontWeight: '700' },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    cardTitle: { fontSize: 14.5, fontWeight: '700', color: c.text },
    cardDesc: { fontSize: 11.5, color: c.textSecondary, marginTop: 3, lineHeight: 15 },
    num: { width: 64, textAlign: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingVertical: 8, color: c.text, fontSize: 15, fontWeight: '700' },
    switch: { width: 50, height: 30, borderRadius: 15, backgroundColor: c.cardBorder, padding: 3, justifyContent: 'center' },
    switchOn: { backgroundColor: c.emerald },
    knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
    knobOn: { alignSelf: 'flex-end' },
    lbl: { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 8, marginBottom: 6 },
    hint: { fontSize: 12.5, color: c.textSecondary, lineHeight: 17, marginBottom: 12 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 14, marginBottom: 10 },
    area: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13.5, lineHeight: 19, minHeight: 80, textAlignVertical: 'top' },
    promptCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 12 },
    keyTag: { fontSize: 11, fontWeight: '800', color: c.emerald, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
    saveTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
    miniBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    miniTxt: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
    text: { color: c.text, padding: 20 },
  });
}
