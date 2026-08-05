/**
 * Admin — « Qui est joignable en push » : l'état réel de la distribution, avant d'accuser l'envoi.
 *
 * Quand une notification n'arrive pas, trois causes se ressemblent beaucoup vues de l'écran admin :
 * personne n'était joignable, l'envoi n'est jamais parti, ou Expo l'a refusé. Ce panneau les sépare :
 *   • les compteurs disent QUI peut être atteint (et pourquoi les autres ne le sont pas) ;
 *   • l'envoi de test vise UN destinataire au choix et affiche la réponse d'Expo telle quelle.
 *
 * Le pendant e-mail est dans `EmailDiagnostics` (écran Admin → E-mails) : ce sont deux canaux, deux
 * pannes différentes, et les mélanger obligeait à trier deux diagnostics dans un même bloc.
 *
 * Tout vient de l'Edge Function `admin-push` (rôle service) : le client n'a pas le droit de lire les
 * jetons des autres utilisateurs, et n'a aucun moyen de purger ceux qui sont morts.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAppColors } from '../../hooks/useAppColors';
import { fetchReachability, sendTestPush, type PushSendResult } from '../../lib/pushSend';

type ListKey = 'push_reachable' | 'unreachable';

interface Tile {
  key: string;
  value: number | string;
  label: string;
  /** Liste dépliable associée (si le chiffre se détaille). */
  list?: ListKey;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

/** Destinataire du test : `null` = moi. */
interface TestTarget { id: string; label: string }

export default function PushDiagnostics() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [openList, setOpenList] = useState<ListKey | null>(null);
  const [target, setTarget] = useState<TestTarget | null>(null);
  const [test, setTest] = useState<PushSendResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['push_reachability'],
    queryFn: fetchReachability,
    // Un diagnostic doit être FRAIS : on ne veut pas lire l'état d'il y a dix minutes en pleine panne.
    staleTime: 0,
  });

  const runTest = async () => {
    setTesting(true); setTest(null); setTestError(null);
    try { setTest(await sendTestPush({ profileId: target?.id })); }
    catch (e: any) { setTestError(e?.message ?? 'Échec inconnu'); }
    finally { setTesting(false); }
  };

  if (isLoading) {
    return <View style={styles.card}><ActivityIndicator color={COLORS.emerald} /></View>;
  }

  if (error) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Qui est joignable en push</Text>
        <View style={styles.errBox}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.danger} />
          <Text style={styles.errText}>
            Diagnostic indisponible : {(error as any)?.message ?? 'erreur inconnue'}.{'\n'}
            Vérifie que l'Edge Function <Text style={styles.mono}>admin-push</Text> est déployée.
          </Text>
        </View>
      </View>
    );
  }

  const d = data ?? {};
  const tiles: Tile[] = [
    { key: 'users', value: d.users ?? 0, label: 'Utilisateurs' },
    { key: 'push', value: d.push_reachable ?? 0, label: 'Joignables en push', list: 'push_reachable', tone: (d.push_reachable ?? 0) > 0 ? 'good' : 'bad' },
    { key: 'unreachable', value: d.unreachable ?? 0, label: 'Non joignables', list: 'unreachable', tone: (d.unreachable ?? 0) > 0 ? 'warn' : 'neutral' },
    { key: 'nodev', value: d.no_device ?? 0, label: 'Sans appareil' },
    { key: 'off', value: d.push_disabled ?? 0, label: 'Notifs coupées' },
    { key: 'bad', value: d.malformed_tokens ?? 0, label: 'Jetons invalides', tone: (d.malformed_tokens ?? 0) > 0 ? 'warn' : 'neutral' },
  ];

  const toneColor = (t?: Tile['tone']) =>
    t === 'good' ? COLORS.emerald : t === 'bad' ? COLORS.danger : t === 'warn' ? COLORS.orange : COLORS.text;

  const list: Array<{ id: string; label: string; devices?: number; reason?: string }> =
    openList ? (d.lists?.[openList] ?? []) : [];
  // On ne propose comme destinataire de test que quelqu'un qui a au moins un appareil : viser
  // quelqu'un sans jeton ne teste rien et se lit comme un échec d'envoi.
  const selectable = openList === 'push_reachable';

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Qui est joignable en push</Text>
          <Text style={styles.subtitle}>Si un envoi ne touche personne, la réponse est ici avant d'être dans les réglages.</Text>
        </View>
        <TouchableOpacity onPress={() => refetch()} style={styles.refresh} disabled={isFetching}>
          {isFetching ? <ActivityIndicator size="small" color={COLORS.textSecondary} /> : <Ionicons name="refresh" size={18} color={COLORS.textSecondary} />}
        </TouchableOpacity>
      </View>

      <View style={styles.tiles}>
        {tiles.map((t) => {
          const active = !!t.list && openList === t.list;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tile, active && styles.tileActive]}
              activeOpacity={t.list ? 0.7 : 1}
              onPress={() => t.list && setOpenList(active ? null : t.list)}
            >
              <Text style={[styles.tileValue, { color: toneColor(t.tone) }]} numberOfLines={1}>{t.value}</Text>
              <Text style={styles.tileLabel} numberOfLines={2}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Détail dépliable du compteur cliqué. Dans « Joignables en push », chaque ligne est aussi le
          moyen de CHOISIR à qui part le test — c'est là qu'on a la question en tête. */}
      {openList && (
        <View style={styles.listBox}>
          <View style={styles.listHead}>
            <Text style={styles.listTitle}>
              {openList === 'push_reachable' ? 'Joignables en push' : 'Non joignables'}
              <Text style={styles.listCount}>  {list.length} utilisateur(s)</Text>
            </Text>
            <TouchableOpacity onPress={() => setOpenList(null)}><Ionicons name="close" size={18} color={COLORS.textSecondary} /></TouchableOpacity>
          </View>
          {selectable && <Text style={styles.listHint}>Touche quelqu'un pour lui envoyer le push de test.</Text>}
          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
            {list.length === 0 ? (
              <Text style={styles.listEmpty}>Personne dans cette catégorie.</Text>
            ) : list.map((u) => {
              const picked = target?.id === u.id;
              return (
                <TouchableOpacity
                  key={u.id}
                  style={[styles.listRow, picked && styles.listRowPicked]}
                  activeOpacity={selectable ? 0.7 : 1}
                  disabled={!selectable}
                  onPress={() => { setTarget(picked ? null : { id: u.id, label: u.label }); setTest(null); setTestError(null); }}
                >
                  {selectable && (
                    <Ionicons
                      name={picked ? 'radio-button-on' : 'radio-button-off'}
                      size={15}
                      color={picked ? COLORS.blue : COLORS.textSecondary}
                    />
                  )}
                  <Text style={styles.listName} numberOfLines={1}>{u.label}</Text>
                  <Text style={styles.listMeta} numberOfLines={1}>
                    {u.devices != null ? `${u.devices} appareil(s)` : u.reason ?? ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* ── Test réel : le seul moyen de savoir si la chaîne fonctionne de bout en bout. ── */}
      <View style={styles.targetRow}>
        <Ionicons name="person-outline" size={14} color={COLORS.textSecondary} />
        <Text style={styles.targetLabel} numberOfLines={1}>
          Destinataire : <Text style={styles.targetName}>{target ? target.label : 'moi'}</Text>
        </Text>
        {target ? (
          <TouchableOpacity onPress={() => { setTarget(null); setTest(null); }} style={styles.targetReset}>
            <Text style={styles.targetResetTxt}>Revenir à moi</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setOpenList('push_reachable')} style={styles.targetReset}>
            <Text style={styles.targetResetTxt}>Choisir</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.testBtn} onPress={runTest} disabled={testing} activeOpacity={0.85}>
        {testing ? <ActivityIndicator size="small" color={COLORS.bg} /> : <Ionicons name="flash-outline" size={16} color={COLORS.bg} />}
        <Text style={styles.testBtnText} numberOfLines={1}>
          {target ? `Envoyer un push de test à ${target.label}` : "M'envoyer un push de test"}
        </Text>
      </TouchableOpacity>

      {testError && (
        <View style={styles.errBox}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.danger} />
          <Text style={styles.errText}>{testError}</Text>
        </View>
      )}

      {test && (
        <View style={[styles.resultBox, { borderColor: (test.accepted > 0 ? COLORS.emerald : COLORS.danger) + '66' }]}>
          <Text style={[styles.resultTitle, { color: test.accepted > 0 ? COLORS.emerald : COLORS.danger }]}>
            {test.accepted > 0 ? "✓ Expo a accepté l'envoi" : '✗ Aucun envoi accepté'}
            {test.recipient ? ` → ${test.recipient}` : ''}
          </Text>
          <Text style={styles.resultLine}>
            {test.targeted} appareil(s) ciblé(s) · {test.accepted} accepté(s) · {test.failed} en échec
            {test.pruned > 0 ? ` · ${test.pruned} jeton(s) mort(s) purgé(s)` : ''}
          </Text>
          {test.notificationsOff && (
            <Text style={styles.resultBad}>
              Cette personne a COUPÉ ses notifications dans l'app : même accepté par Expo, rien ne
              s'affichera sur son téléphone. Ce n'est pas une panne d'envoi.
            </Text>
          )}
          {/* ── LE verdict : ce qu'Apple/Google ont fait du message. `accepted` ne disait que
                « Expo l'a mis en file » — un push qui n'arrive jamais s'affichait en succès. ── */}
          {test.accepted > 0 && test.receipts && (
            <View style={styles.receiptBox}>
              <Text style={styles.receiptTitle}>Livraison (accusés de réception)</Text>
              {test.receipts.delivered > 0 && (
                <Text style={[styles.resultLine, { color: COLORS.emerald, fontWeight: '700' }]}>
                  ✓ {test.receipts.delivered} remise(s) confirmée(s) par Apple/Google.
                  {'\n'}Si rien ne s'affiche malgré ça, le message EST arrivé : regarde le centre de
                  notifications, le mode Concentration, et l'autorisation de Relyka dans les réglages du téléphone.
                </Text>
              )}
              {test.receipts.errors.map((e, i) => (
                <View key={i} style={styles.errRow}>
                  <Text style={styles.errCode}>{e.code}</Text>
                  <Text style={styles.errMsg} numberOfLines={4}>
                    {e.code === 'DeviceNotRegistered'
                      ? "L'appareil n'accepte plus ce jeton (app désinstallée, ou jeton d'un ancien build). Rouvre l'app mobile pour en réenregistrer un."
                      : e.code === 'MismatchSenderId'
                      ? "Le jeton vient d'un build lié à un AUTRE projet FCM que celui configuré. C'est la panne typique après un changement de google-services.json : les appareils doivent réinstaller ou rouvrir l'app."
                      : e.code === 'InvalidCredentials'
                      ? 'Les identifiants FCM/APNs du projet Expo sont absents ou périmés. Rien ne partira tant que ce ne sera pas réglé (eas credentials).'
                      : e.message || 'Refus au moment de la livraison.'}
                  </Text>
                </View>
              ))}
              {test.receipts.delivered === 0 && test.receipts.errors.length === 0 && (
                <Text style={styles.resultHint}>
                  {test.receipts.pending > 0
                    ? "Expo n'a pas encore produit l'accusé de réception. Relance le test dans une minute : c'est lui qui tranchera."
                    : test.receipts.summary}
                </Text>
              )}
            </View>
          )}
          {test.accepted > 0 && !test.receipts && !test.notificationsOff && (
            <Text style={styles.resultHint}>
              Expo a pris le message en charge. S'il n'arrive pas sur le téléphone, la suite se joue chez
              Apple/Google (APNs/FCM) — pas dans l'app.
            </Text>
          )}
          {test.configFailure && (
            <Text style={styles.resultBad}>
              Panne de CONFIGURATION : Expo refuse tous les envois. Les identifiants push du projet
              (FCM côté Android, APNs côté iOS) sont invalides ou ne correspondent plus au build installé.
            </Text>
          )}
          {/* Les codes d'erreur bruts d'Expo — c'est ce qui permet de trancher sans dashboard. */}
          {test.errors.slice(0, 6).map((e, i) => (
            <View key={i} style={styles.errRow}>
              <Text style={styles.errCode}>{e.code}</Text>
              <Text style={styles.errMsg} numberOfLines={3}>{e.message || e.token}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Aide-mémoire des codes Expo — REPLIÉ par défaut : on ne le lit que le jour où un code
          apparaît, et déplié en permanence il faisait plus de hauteur que le diagnostic lui-même. */}
      <View style={styles.legend}>
        <TouchableOpacity style={styles.legendHead} onPress={() => setShowLegend((v) => !v)} activeOpacity={0.7}>
          <Text style={styles.legendTitle}>Décoder un échec</Text>
          <Ionicons name={showLegend ? 'chevron-up' : 'chevron-down'} size={15} color={COLORS.textSecondary} />
        </TouchableOpacity>
        {showLegend && (
          <>
            <Text style={styles.legendLine}><Text style={styles.mono}>DeviceNotRegistered</Text> — l'app a été désinstallée ou le jeton révoqué. Purgé automatiquement.</Text>
            <Text style={styles.legendLine}><Text style={styles.mono}>MismatchSenderId</Text> — le jeton vient d'un build lié à un autre projet FCM. Les appareils doivent rouvrir l'app pour réenregistrer un jeton.</Text>
            <Text style={styles.legendLine}><Text style={styles.mono}>InvalidCredentials</Text> — les identifiants FCM/APNs du projet Expo sont absents ou périmés.</Text>
            <Text style={styles.legendLine}><Text style={styles.mono}>MessageTooBig</Text> — titre + message dépassent la taille admise.</Text>
          </>
        )}
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 14, gap: 12, marginBottom: 14 },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    title: { fontSize: 15, fontWeight: '800', color: c.text },
    subtitle: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    refresh: { padding: 6 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    // `minWidth` + `flexGrow` : 4 tuiles par ligne sur large, 2 sur téléphone, sans point de rupture.
    tile: { flexGrow: 1, flexBasis: 96, minWidth: 96, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center' },
    tileActive: { borderColor: c.blue, backgroundColor: c.blue + '14' },
    tileValue: { fontSize: 20, fontWeight: '800' },
    tileLabel: { fontSize: 10.5, color: c.textSecondary, textAlign: 'center', marginTop: 2, fontWeight: '600' },
    listBox: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, backgroundColor: c.bg, overflow: 'hidden' },
    listHead: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    listTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: c.text },
    listCount: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
    listHint: { fontSize: 11, color: c.textSecondary, fontStyle: 'italic', paddingHorizontal: 10, paddingTop: 8 },
    listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    listRowPicked: { backgroundColor: c.blue + '14' },
    listName: { flex: 1, fontSize: 12.5, fontWeight: '700', color: c.text },
    listMeta: { fontSize: 11, color: c.textSecondary },
    listEmpty: { fontSize: 12, color: c.textSecondary, padding: 12, fontStyle: 'italic' },
    targetRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    targetLabel: { flex: 1, fontSize: 12, color: c.textSecondary },
    targetName: { fontWeight: '800', color: c.text },
    targetReset: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder },
    targetResetTxt: { fontSize: 11, fontWeight: '700', color: c.textSecondary },
    testBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.blue, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10 },
    testBtnText: { color: c.bg, fontWeight: '800', fontSize: 13.5, flexShrink: 1 },
    resultBox: { borderWidth: 1, borderRadius: 12, padding: 11, gap: 6, backgroundColor: c.bg },
    resultTitle: { fontSize: 13, fontWeight: '800' },
    resultLine: { fontSize: 12, color: c.text },
    resultHint: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16 },
    resultBad: { fontSize: 11.5, color: c.danger, lineHeight: 16, fontWeight: '600' },
    receiptBox: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder, paddingTop: 8, gap: 5 },
    receiptTitle: { fontSize: 11, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    errRow: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder, paddingTop: 6, gap: 2 },
    errCode: { fontSize: 11.5, fontWeight: '800', color: c.orange },
    errMsg: { fontSize: 11, color: c.textSecondary, lineHeight: 15 },
    errBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12', borderRadius: 12, padding: 11 },
    errText: { flex: 1, fontSize: 12, color: c.danger, lineHeight: 17 },
    legend: { gap: 4, paddingTop: 4 },
    legendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
    legendTitle: { fontSize: 11.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    legendLine: { fontSize: 11, color: c.textSecondary, lineHeight: 16 },
    mono: { fontWeight: '800', color: c.text },
  });
}
