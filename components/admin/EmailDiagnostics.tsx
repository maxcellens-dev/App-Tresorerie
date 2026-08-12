/**
 * Admin — « Qui est joignable par e-mail » : le pendant de `PushDiagnostics`, côté courrier.
 *
 * Panneau SÉPARÉ, et pas une section du diagnostic push, parce que ce sont deux canaux qui tombent
 * en panne pour des raisons sans rapport : le push meurt sur des jetons et des identifiants FCM/APNs,
 * l'e-mail meurt sur un quota Brevo, un opt-out ou un expéditeur non vérifié. Les afficher ensemble
 * obligeait à trier deux diagnostics dans un même bloc pour savoir lequel regarder.
 *
 * Les chiffres viennent de l'Edge Function `admin-push` (action `diagnose`, rôle service) : elle sait
 * lire les profils de tout le monde, et interroge `/v3/account` de Brevo clé par clé.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { fetchReachability } from '../../lib/platform/pushSend';

interface Tile {
  key: string;
  value: number | string;
  label: string;
  openList?: boolean;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

export default function EmailDiagnostics() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [showUnsub, setShowUnsub] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['push_reachability'],   // même source que le diagnostic push : une seule requête pour les deux
    queryFn: fetchReachability,
    staleTime: 0,
  });

  if (isLoading) {
    return <View style={styles.card}><ActivityIndicator color={COLORS.emerald} /></View>;
  }

  if (error) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Qui est joignable par e-mail</Text>
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
  const brevo = d.brevo ?? {};
  const perKey: Array<{ index: number; remaining: number | null; error?: string }> = brevo.per_key ?? [];
  const quota: number | null = brevo.remaining_today ?? null;
  const reachable: number = d.email_reachable ?? 0;
  const optedOut: Array<{ id: string; label: string }> = d.lists?.email_opted_out ?? [];

  /* Le chiffre qui décide vraiment si une campagne peut partir MAINTENANT : ce n'est ni le nombre de
     destinataires, ni le quota, c'est le plus petit des deux. L'afficher évite de lancer un envoi qui
     s'arrêtera au milieu. */
  const canSendNow = quota == null ? null : Math.min(quota, reachable);

  const tiles: Tile[] = [
    { key: 'users', value: d.users ?? 0, label: 'Utilisateurs' },
    { key: 'reach', value: reachable, label: 'Joignables par e-mail', tone: reachable > 0 ? 'good' : 'bad' },
    { key: 'unsub', value: d.email_opted_out ?? 0, label: 'Désinscrits', openList: true, tone: (d.email_opted_out ?? 0) > 0 ? 'warn' : 'neutral' },
    { key: 'noaddr', value: d.email_missing ?? 0, label: 'Sans adresse', tone: (d.email_missing ?? 0) > 0 ? 'warn' : 'neutral' },
    { key: 'keys', value: brevo.keys ?? 0, label: 'Clés Brevo', tone: (brevo.keys ?? 0) > 0 ? 'neutral' : 'bad' },
    { key: 'quota', value: quota ?? '—', label: "E-mails dispo aujourd'hui", tone: quota != null && quota < reachable ? 'warn' : 'neutral' },
  ];

  const toneColor = (t?: Tile['tone']) =>
    t === 'good' ? COLORS.emerald : t === 'bad' ? COLORS.danger : t === 'warn' ? COLORS.orange : COLORS.text;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Qui est joignable par e-mail</Text>
          <Text style={styles.subtitle}>Avant de lancer une campagne : combien de personnes, et combien d'envois il reste.</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Actualiser le diagnostic" onPress={() => refetch()} style={styles.refresh} disabled={isFetching}>
          {isFetching ? <ActivityIndicator size="small" color={COLORS.textSecondary} /> : <Ionicons name="refresh" size={18} color={COLORS.textSecondary} />}
        </TouchableOpacity>
      </View>

      <View style={styles.tiles}>
        {tiles.map((t) => {
          const active = t.openList && showUnsub;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tile, active && styles.tileActive]}
              activeOpacity={t.openList ? 0.7 : 1}
              onPress={() => t.openList && setShowUnsub((v) => !v)}
            >
              <Text style={[styles.tileValue, { color: toneColor(t.tone) }]} numberOfLines={1}>{t.value}</Text>
              <Text style={styles.tileLabel} numberOfLines={2}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showUnsub && (
        <View style={styles.listBox}>
          <View style={styles.listHead}>
            <Text style={styles.listTitle}>Désinscrits<Text style={styles.listCount}>  {optedOut.length} utilisateur(s)</Text></Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setShowUnsub(false)}><Ionicons name="close" size={18} color={COLORS.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
            {optedOut.length === 0 ? (
              <Text style={styles.listEmpty}>Personne ne s'est désinscrit.</Text>
            ) : optedOut.map((u) => (
              <View key={u.id} style={styles.listRow}><Text style={styles.listName} numberOfLines={1}>{u.label}</Text></View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Ce que ça donne concrètement pour la prochaine campagne. ── */}
      <View style={[styles.verdict, { borderColor: (canSendNow == null ? COLORS.textSecondary : canSendNow >= reachable ? COLORS.emerald : COLORS.orange) + '55' }]}>
        {canSendNow == null ? (
          <Text style={styles.verdictText}>
            Quota Brevo illisible : aucune clé configurée, ou l'API n'a pas répondu. Une campagne
            partirait à l'aveugle.
          </Text>
        ) : canSendNow >= reachable ? (
          <Text style={[styles.verdictText, { color: COLORS.emerald }]}>
            ✓ Une campagne à tout le monde ({reachable} personnes) passe : il reste {quota} envois aujourd'hui.
          </Text>
        ) : (
          <Text style={[styles.verdictText, { color: COLORS.orange }]}>
            ⚠ {reachable} personnes joignables pour {quota} envois restants aujourd'hui. La campagne
            partira quand même : elle servira ~{quota} destinataires, se mettra EN PAUSE, et reprendra
            toute seule là où elle s'est arrêtée — sans réécrire aux premiers. Ajoute une clé Brevo
            pour tout envoyer d'un coup.
          </Text>
        )}
      </View>

      {/* Détail clé par clé : c'est le seul moyen de voir qu'une 2ᵉ clé est bien prise en compte,
          ou qu'elle est refusée (mauvaise clé, compte suspendu) plutôt qu'épuisée. */}
      {perKey.length > 0 && (
        <View style={styles.keys}>
          <Text style={styles.legendTitle}>Clés Brevo</Text>
          {perKey.map((k) => (
            <View key={k.index} style={styles.keyRow}>
              <Text style={styles.keyName}>Clé #{k.index + 1}</Text>
              {k.error ? (
                <Text style={styles.keyErr}>refusée — {k.error}</Text>
              ) : (
                <Text style={[styles.keyVal, { color: (k.remaining ?? 0) > 0 ? COLORS.emerald : COLORS.orange }]}>
                  {k.remaining ?? 0} envoi(s) restant(s)
                </Text>
              )}
            </View>
          ))}
          <Text style={styles.legendLine}>
            Les clés sont essayées dans cet ordre. Quand l'une atteint son quota, la suivante prend le
            relais sur le même lot — voir le README de <Text style={styles.mono}>send-campaign-emails</Text>.
          </Text>
        </View>
      )}

      {/* REPLIÉ par défaut : cet aide-mémoire ne sert que le jour où un code apparaît. */}
      <View style={styles.legend}>
        <TouchableOpacity style={styles.legendHead} onPress={() => setShowLegend((v) => !v)} activeOpacity={0.7}>
          <Text style={styles.legendTitle}>Décoder un échec d'envoi</Text>
          <Ionicons name={showLegend ? 'chevron-up' : 'chevron-down'} size={15} color={COLORS.textSecondary} />
        </TouchableOpacity>
        {showLegend && (
          <>
            <Text style={styles.legendLine}><Text style={styles.mono}>402 not_enough_credits</Text> — quota journalier épuisé sur cette clé. La suivante prend le relais s'il y en a une.</Text>
            <Text style={styles.legendLine}><Text style={styles.mono}>401 / 403</Text> — clé invalide ou révoquée.</Text>
            <Text style={styles.legendLine}><Text style={styles.mono}>400 sender not valid</Text> — l'expéditeur n'est pas vérifié dans CE compte Brevo. Chaque compte doit valider le sien.</Text>
            <Text style={styles.legendLine}>Une campagne interrompue indique où elle s'est arrêtée : la relancer telle quelle réécrirait aux premiers destinataires.</Text>
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
    tile: { flexGrow: 1, flexBasis: 96, minWidth: 96, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center' },
    tileActive: { borderColor: c.blue, backgroundColor: c.blue + '14' },
    tileValue: { fontSize: 20, fontWeight: '800' },
    tileLabel: { fontSize: 10.5, color: c.textSecondary, textAlign: 'center', marginTop: 2, fontWeight: '600' },
    listBox: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, backgroundColor: c.bg, overflow: 'hidden' },
    listHead: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    listTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: c.text },
    listCount: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
    listRow: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    listName: { fontSize: 12.5, fontWeight: '700', color: c.text },
    listEmpty: { fontSize: 12, color: c.textSecondary, padding: 12, fontStyle: 'italic' },
    verdict: { borderWidth: 1, borderRadius: 12, padding: 11, backgroundColor: c.bg },
    verdictText: { fontSize: 12, color: c.textSecondary, lineHeight: 17, fontWeight: '600' },
    keys: { gap: 5, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder, paddingTop: 10 },
    keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    keyName: { flex: 1, fontSize: 12, fontWeight: '700', color: c.text },
    keyVal: { fontSize: 12, fontWeight: '800' },
    keyErr: { fontSize: 11.5, fontWeight: '700', color: c.danger },
    errBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12', borderRadius: 12, padding: 11 },
    errText: { flex: 1, fontSize: 12, color: c.danger, lineHeight: 17 },
    legend: { gap: 4, paddingTop: 4 },
    legendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
    legendTitle: { fontSize: 11.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    legendLine: { fontSize: 11, color: c.textSecondary, lineHeight: 16 },
    mono: { fontWeight: '800', color: c.text },
  });
}
