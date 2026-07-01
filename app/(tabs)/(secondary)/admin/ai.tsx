/**
 * Admin — Conseils IA. Réglages (ouverture, quotas, consentement, paiement anticipé), modèles
 * (activation + ordre de bascule), prompts éditables + questions rapides, et tickets d'assistance
 * (relance sans quota / réponse manuelle dans le fil du user / résolution).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import {
  useAiConfig, useUpdateAiConfig, useAiPrompts, useUpdateAiPrompt, useAiTickets,
  useResolveAiTicket, useAdminReplyAi, useAdminRelaunchAi, useCheckAiModels,
  type AiModel, type AiModelStatus,
} from '../../../../hooks/useAi';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { useUserSnapshot } from '../../../../hooks/useUserSnapshot';

type Tab = 'settings' | 'models' | 'prompts' | 'tickets' | 'snapshot';

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
          {([['settings', 'Réglages'], ['models', 'Modèles'], ['prompts', 'Prompts'], ['tickets', `Tickets${tickets?.length ? ` (${tickets.length})` : ''}`], ['snapshot', 'Snapshot']] as [Tab, string][]).map(([t, lbl]) => (
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
            {tab === 'tickets' && <TicketsTab c={c} s={s} tickets={tickets ?? []} prompts={prompts ?? []} resolveTicket={resolveTicket} adminReply={adminReply} relaunch={relaunch} />}
            {tab === 'snapshot' && <SnapshotTab c={c} s={s} />}
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

      <Toggle label="Notif push des tickets" desc="Envoyer une notification mobile aux admins quand un conseil échoue. Désactivé = pas de push, mais le badge et l'historique restent." value={cfg.notify_admins_push !== false} onToggle={() => updateCfg.mutate({ notify_admins_push: !(cfg.notify_admins_push !== false) })} />

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

/* ── Modèles (ordre = ordre de bascule), éditables ── */
function ModelsTab({ c, s, models, updateCfg }: { c: any; s: any; models: AiModel[]; updateCfg: any }) {
  const [list, setList] = useState<AiModel[]>(models);
  useEffect(() => { setList(models); }, [models]);
  const dirty = JSON.stringify(list) !== JSON.stringify(models);

  const check = useCheckAiModels();
  const [statuses, setStatuses] = useState<Record<string, AiModelStatus>>({});
  const runCheck = () => check.mutate(undefined, { onSuccess: (res) => setStatuses(Object.fromEntries(res.map((r) => [r.id, r]))) });
  const badge = (m: AiModel) => {
    const st = statuses[m.id]; if (!st) return null;
    const col = st.ok ? c.green : (st.status === 429 ? c.amber : c.danger);
    return <View style={[s.statusBadge, { backgroundColor: col + '22', borderColor: col }]}><Text style={[s.statusTxt, { color: col }]}>{st.ok ? 'OK' : st.reason}</Text></View>;
  };

  const setField = (i: number, k: keyof AiModel, v: any) => setList((l) => l.map((m, j) => j === i ? { ...m, [k]: v } : m));
  const move = (i: number, dir: -1 | 1) => setList((l) => { const j = i + dir; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = (i: number) => setList((l) => l.filter((_, j) => j !== i));
  const add = () => setList((l) => [...l, { id: '', label: '', enabled: true }]);
  const saveAll = () => updateCfg.mutate({ models: list.filter((m) => m.id.trim()).map((m) => ({ id: m.id.trim(), label: (m.label || m.id).trim(), enabled: m.enabled })) });

  return (
    <>
      <Text style={s.hint}>Les modèles sont essayés de haut en bas : si le 1ᵉ échoue (épuisé, retiré…), on bascule sur le suivant. L'ID doit correspondre EXACTEMENT au nom Gemini (ex. « gemini-2.5-flash »). Désactive ou supprime ceux que tu ne veux pas.</Text>
      <TouchableOpacity style={[s.checkBtn, check.isPending && { opacity: 0.6 }]} onPress={runCheck} disabled={check.isPending}>
        {check.isPending ? <ActivityIndicator size="small" color={c.emerald} /> : <Ionicons name="pulse-outline" size={16} color={c.emerald} />}
        <Text style={s.checkTxt}>{check.isPending ? 'Test en cours…' : 'Tester la disponibilité en direct'}</Text>
      </TouchableOpacity>
      <Text style={[s.hint, { marginBottom: 10 }]}>Google n'expose pas le quota restant chiffré : ce test ping chaque modèle et renvoie son état réel (OK / épuisé / introuvable). Consomme une mini‑requête par modèle.</Text>
      {list.map((m, i) => (
        <View key={i} style={s.promptCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View>
              <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0}><Ionicons name="chevron-up" size={18} color={i === 0 ? c.cardBorder : c.textSecondary} /></TouchableOpacity>
              <TouchableOpacity onPress={() => move(i, 1)} disabled={i === list.length - 1}><Ionicons name="chevron-down" size={18} color={i === list.length - 1 ? c.cardBorder : c.textSecondary} /></TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={m.id} onChangeText={(v) => setField(i, 'id', v)} placeholder="ID (ex. gemini-2.5-flash)" autoCapitalize="none" autoCorrect={false} />
                {badge(m)}
              </View>
              <TextInput style={[s.input, { marginBottom: 0 }]} value={m.label} onChangeText={(v) => setField(i, 'label', v)} placeholder="Nom affiché" />
            </View>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <TouchableOpacity style={[s.switch, m.enabled && s.switchOn]} onPress={() => setField(i, 'enabled', !m.enabled)}><View style={[s.knob, m.enabled && s.knobOn]} /></TouchableOpacity>
              <TouchableOpacity onPress={() => remove(i)}><Ionicons name="trash-outline" size={18} color={c.danger} /></TouchableOpacity>
            </View>
          </View>
        </View>
      ))}
      <TouchableOpacity style={s.addRow} onPress={add}><Ionicons name="add" size={18} color={c.emerald} /><Text style={{ color: c.emerald, fontWeight: '700' }}>Ajouter un modèle</Text></TouchableOpacity>
      <TouchableOpacity style={[s.saveBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty || updateCfg.isPending} onPress={saveAll}><Text style={s.saveTxt}>Enregistrer les modèles</Text></TouchableOpacity>
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
function TicketsTab({ c, s, tickets, prompts, resolveTicket, adminReply, relaunch }: any) {
  if (!tickets.length) return <Text style={s.hint}>Aucun ticket en attente. 🎉</Text>;
  return tickets.map((t: any) => <TicketCard key={t.id} c={c} s={s} t={t} prompts={prompts} resolveTicket={resolveTicket} adminReply={adminReply} relaunch={relaunch} />);
}

function TicketCard({ c, s, t, prompts, resolveTicket, adminReply, relaunch }: any) {
  const [reply, setReply] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const req = t.request ?? {};
  // Reconstitue le PROMPT RÉEL envoyé au modèle (template admin + valeurs réelles), pour copier-coller.
  const tplKey = req.kind === 'analysis' ? req.analysis_key : 'chat_system';
  const tpl = (prompts ?? []).find((p: any) => p.key === tplKey)?.prompt_template ?? '';
  const fullPrompt = tpl.replaceAll('{{SNAPSHOT}}', req.snapshot ?? '(instantané non enregistré)').replaceAll('{{QUESTION}}', req.question ?? '');
  const copyPrompt = async () => { await Clipboard.setStringAsync(fullPrompt); Alert.alert('Copié', 'Le prompt complet a été copié.'); };
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
  const date = t.created_at ? new Date(t.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <View style={s.ticketCard}>
      {/* En-tête : type + date */}
      <View style={s.ticketHead}>
        <View style={s.ticketPill}>
          <Ionicons name={req.kind === 'analysis' ? 'document-text-outline' : 'chatbubble-ellipses-outline'} size={12} color={c.emerald} />
          <Text style={s.ticketPillTxt}>{req.kind === 'analysis' ? 'Analyse' : 'Question'}</Text>
        </View>
        {!!date && <Text style={s.ticketDate}>{date}</Text>}
      </View>

      {/* Contenu de la demande */}
      {req.kind === 'analysis' && req.analysis_key ? <Text style={s.ticketField}>{req.analysis_key}</Text> : null}
      {req.question ? <Text style={s.ticketQuote}>« {req.question} »</Text> : null}
      <Text style={s.ticketMeta}>User : {t.profile_id}</Text>
      {t.error ? (
        <View style={s.ticketError}>
          <Ionicons name="warning-outline" size={13} color={c.danger} />
          <Text style={s.ticketErrorTxt} numberOfLines={2}>{String(t.error).replace(/\s+/g, ' ').slice(0, 160)}</Text>
        </View>
      ) : null}

      {/* Prompt réel : voir / copier (largeur égale, pas de chevauchement) */}
      <View style={s.ticketRow}>
        <TouchableOpacity style={s.ghostBtn} onPress={() => setShowPrompt((v) => !v)}>
          <Ionicons name={showPrompt ? 'eye-off-outline' : 'eye-outline'} size={15} color={c.textSecondary} />
          <Text style={s.ghostTxt} numberOfLines={1}>{showPrompt ? 'Masquer' : 'Voir le prompt'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.ghostBtn, { borderColor: c.emerald }]} onPress={copyPrompt}>
          <Ionicons name="copy-outline" size={15} color={c.emerald} />
          <Text style={[s.ghostTxt, { color: c.emerald }]} numberOfLines={1}>Copier</Text>
        </TouchableOpacity>
      </View>
      {showPrompt && (
        <ScrollView style={s.promptBox} nestedScrollEnabled>
          <Text style={s.promptText} selectable>{fullPrompt}</Text>
        </ScrollView>
      )}

      <View style={s.ticketDivider} />

      {/* Actions */}
      <TouchableOpacity style={[s.primaryBtn, relaunch.isPending && { opacity: 0.5 }]} onPress={doRelaunch} disabled={relaunch.isPending}>
        <Ionicons name="refresh" size={15} color="#fff" />
        <Text style={s.primaryTxt}>Relancer (sans quota)</Text>
      </TouchableOpacity>

      <TextInput style={[s.area, { minHeight: 70, marginTop: 10 }]} value={reply} onChangeText={setReply} multiline placeholder="Réponse manuelle (postée dans le fil du user)…" placeholderTextColor={c.textSecondary} />
      <View style={s.ticketRow}>
        <TouchableOpacity style={[s.ghostBtn, !reply.trim() && { opacity: 0.4 }]} disabled={!reply.trim() || adminReply.isPending} onPress={doReply}>
          <Text style={[s.ghostTxt, { color: c.emerald }]} numberOfLines={1}>Répondre &amp; résoudre</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.ghostBtn} onPress={() => resolveTicket.mutate(t.id)} disabled={resolveTicket.isPending}>
          <Ionicons name="checkmark-done-outline" size={15} color={c.textSecondary} />
          <Text style={s.ghostTxt} numberOfLines={1}>Résoudre</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ── Snapshot admin : instantané réel d'un user choisi ── */
function SnapshotTab({ c, s }: { c: any; s: any }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const search = useQuery({
    queryKey: ['ai_snapshot_user_search', query],
    queryFn: async (): Promise<{ id: string; full_name: string | null; email: string | null }[]> => {
      if (!supabase || query.trim().length < 2) return [];
      const q = `%${query.trim()}%`;
      const { data } = await supabase.from('profiles').select('id, full_name, email').or(`email.ilike.${q},full_name.ilike.${q}`).limit(20);
      return (data ?? []) as any;
    },
    enabled: query.trim().length >= 2 && !selected,
  });
  const { text, ready } = useUserSnapshot(selected?.id);
  const copy = async () => { if (text) { await Clipboard.setStringAsync(text); Alert.alert('Copié', 'Snapshot copié.'); } };

  return (
    <>
      <Text style={s.hint}>Génère l'instantané financier ANONYMISÉ d'un utilisateur (le texte réel envoyé à l'IA), à date. Admin, lecture seule.</Text>
      {!selected ? (
        <>
          <TextInput style={s.input} value={query} onChangeText={setQuery} placeholder="Rechercher un utilisateur (nom ou email)…" placeholderTextColor={c.textSecondary} autoCapitalize="none" autoCorrect={false} />
          {search.isFetching && <ActivityIndicator color={c.emerald} style={{ marginTop: 8 }} />}
          {(search.data ?? []).map((u) => (
            <TouchableOpacity key={u.id} style={s.card} onPress={() => setSelected({ id: u.id, label: u.full_name || u.email || u.id })}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{u.full_name || '(sans nom)'}</Text>
                <Text style={s.cardDesc}>{u.email}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
            </TouchableOpacity>
          ))}
          {query.trim().length >= 2 && !search.isFetching && (search.data ?? []).length === 0 && <Text style={s.hint}>Aucun utilisateur trouvé.</Text>}
        </>
      ) : (
        <>
          <View style={[s.card, { marginBottom: 10 }]}>
            <View style={{ flex: 1 }}><Text style={s.cardTitle}>{selected.label}</Text><Text style={s.cardDesc}>{selected.id}</Text></View>
            <TouchableOpacity onPress={() => setSelected(null)}><Ionicons name="close-circle" size={22} color={c.danger} /></TouchableOpacity>
          </View>
          {!ready ? <ActivityIndicator color={c.emerald} style={{ marginTop: 20 }} /> : (
            <>
              <TouchableOpacity style={[s.ghostBtn, { borderColor: c.emerald, marginBottom: 8 }]} onPress={copy}>
                <Ionicons name="copy-outline" size={15} color={c.emerald} /><Text style={[s.ghostTxt, { color: c.emerald }]}>Copier le snapshot</Text>
              </TouchableOpacity>
              <ScrollView style={[s.promptBox, { maxHeight: 460 }]} nestedScrollEnabled>
                <Text style={s.promptText} selectable>{text}</Text>
              </ScrollView>
            </>
          )}
        </>
      )}
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
    title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 12 },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
    tab: { flexGrow: 1, minWidth: 88, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
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
    checkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: c.emerald, borderRadius: 10, paddingVertical: 11, marginBottom: 8 },
    checkTxt: { color: c.emerald, fontWeight: '700', fontSize: 13.5 },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
    statusTxt: { fontSize: 10.5, fontWeight: '800' },
    promptBox: { maxHeight: 220, marginTop: 8, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10 },
    promptText: { color: c.text, fontSize: 11.5, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    // Carte ticket
    ticketCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 12 },
    ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    ticketPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.emerald + '18', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
    ticketPillTxt: { fontSize: 11.5, fontWeight: '800', color: c.emerald },
    ticketDate: { fontSize: 11, color: c.textSecondary },
    ticketField: { fontSize: 12, fontWeight: '700', color: c.text, marginBottom: 2 },
    ticketQuote: { fontSize: 13, color: c.text, fontStyle: 'italic', marginBottom: 4, lineHeight: 18 },
    ticketMeta: { fontSize: 11, color: c.textSecondary },
    ticketError: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: c.danger + '12', borderRadius: 8, padding: 8, marginTop: 8 },
    ticketErrorTxt: { flex: 1, fontSize: 11, color: c.danger, lineHeight: 15 },
    ticketRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    ticketDivider: { height: 1, backgroundColor: c.cardBorder, marginTop: 12 },
    ghostBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8 },
    ghostTxt: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 12, marginTop: 12 },
    primaryTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
    text: { color: c.text, padding: 20 },
  });
}
