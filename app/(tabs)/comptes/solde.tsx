/**
 * METTRE À JOUR MON SOLDE — le geste central du suivi « allégé », enfin traité comme tel.
 *
 * Jusqu'ici il fallait passer par Comptes → un compte → « Nouveau Solde », un compte à la fois.
 * C'est pourtant l'action la plus rentable de l'app : elle crée une régularisation, place l'écart
 * en dépenses variables, RECALIBRE la dérive de l'utilisateur (lib/confidenceEngine) et fait
 * repasser tous les montants de « estimation » à « à jour ». Elle mérite son propre écran, atteint
 * en un tap depuis le bouton +.
 *
 * Multi-comptes assumé : un utilisateur a souvent plusieurs comptes courants. On les liste TOUS,
 * il remplit ceux qu'il veut, et on n'écrit une régularisation que pour ceux réellement modifiés.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import ScreenGradient from '../../../components/ScreenGradient';
import ScreenHeader from '../../../components/ScreenHeader';
import InfoDot from '../../../components/InfoDot';
import { useAppColors } from '../../../hooks/useAppColors';
import { useResponsive } from '../../../hooks/useResponsive';
import { pageColumn } from '../../../lib/webLayout';
import { useAuth } from '../../../contexts/AuthContext';
import { useNavBack } from '../../../hooks/useNavBack';
import { useAccounts } from '../../../hooks/useAccounts';
import { useAddTransaction, useTransactions } from '../../../hooks/useTransactions';
import { useRecalibrateReliability } from '../../../hooks/useReliability';
import { currencySymbolFor } from '../../../lib/currency';
import { todayISO, formatDateFrench, parseDateFromFrench } from '../../../lib/dateUtils';
import CalendarWithPicker from '../../../components/CalendarWithPicker';
import { sheetWidth } from '../../../lib/appLayout';

export default function BalanceUpdateScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne de formulaire étroite
  const router = useRouter();
  const params = useLocalSearchParams<{ origin?: string }>();
  const { user } = useAuth();
  /* Retour EXPLICITE. `router.back()` (le défaut de ScreenHeader) ne faisait RIEN ici : l'écran est
     poussé depuis un AUTRE onglet (bouton « + » du Pilotage, des Transactions…), donc la pile
     « comptes » ne contient que lui — il n'y a rien à dépiler. On revient sur la route réellement
     précédente (navHistory), avec l'origine transmise par l'appelant en repli. */
  const goBack = useNavBack(params.origin || '/(tabs)/pilotage');

  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);
  const addTransaction = useAddTransaction(user?.id);
  const recalibrate = useRecalibrateReliability(user?.id);

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /* ── DATE DE RELEVÉ, obligatoire ───────────────────────────────────────────────────────────────
     Cet écran datait TOUJOURS la régularisation d'aujourd'hui. Or le geste est le même que le
     « Nouveau solde » d'une fiche de compte, qui lui demande la date : recopier un solde relevé
     hier ou lundi dernier produisait ici une régularisation datée d'aujourd'hui, donc un écart
     attribué aux mauvais jours (et une ancre de vérification fausse). On demande donc la date, et
     on compare au solde REMONTÉ à cette date — exactement comme la fiche de compte. */
  const [date, setDate] = useState(todayISO());
  const [dateDisplay, setDateDisplay] = useState(formatDateFrench(todayISO()));
  const [showCalendar, setShowCalendar] = useState(false);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayISO();

  /** Solde d'un compte À LA DATE choisie = solde actuel − ce qui est passé depuis (hors brouillons/modèles). */
  const balanceAtDate = React.useCallback((accountId: string, balance: number) => {
    if (!dateValid) return balance;
    const t0 = todayISO();
    const after = (transactions as any[])
      .filter((t) => t.account_id === accountId && !t.is_draft && !t.is_recurring && t.date > date && t.date <= t0)
      .reduce((s, t) => s + Number(t.amount), 0);
    return balance - after;
  }, [transactions, date, dateValid]);

  /** Comptes courants actifs, dans l'ordre unique de l'app (principal → type → nom). */
  const checking = useMemo(
    () => accounts.filter((a: any) => a.type === 'checking' && a.is_active !== false),
    [accounts],
  );

  const num = (s: string) => {
    const n = parseFloat(String(s ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  /** Écarts saisis, par compte. Un champ vide = « je ne touche pas à ce compte ». */
  const gaps = useMemo(() => {
    return checking
      .map((a: any) => {
        const typed = num(inputs[a.id] ?? '');
        if (typed === null) return null;
        // Écart mesuré contre le solde À LA DATE du relevé, pas contre le solde d'aujourd'hui.
        const known = balanceAtDate(a.id, Number(a.balance));
        return { account: a, target: typed, gap: typed - known, known };
      })
      .filter(Boolean) as { account: any; target: number; gap: number; known: number }[];
  }, [checking, inputs, balanceAtDate]);

  const totalGap = gaps.reduce((s, g) => s + g.gap, 0);
  const touched = gaps.length > 0;

  async function submit() {
    if (!user?.id || gaps.length === 0) return;
    if (!dateValid) { Alert.alert('Date manquante', 'Indique la date à laquelle tu as relevé ce solde.'); return; }
    setSaving(true);
    try {
      for (const g of gaps) {
        // Écart nul = l'utilisateur CONFIRME son solde. C'est une vraie vérification (ancre à
        // écart 0) : elle calibre sa dérive vers zéro et fait remonter la confiance. On l'écrit.
        await addTransaction.mutateAsync({
          account_id: g.account.id,
          category_id: null,                 // une régul reste sans catégorie (le moteur de solde l'exige)
          amount: g.gap,
          date,
          note: 'Régularisation solde',
          is_recurring: false,
          regul_target: g.target,
        });
      }
      recalibrate.mutate();
      // Le profil, lui, suit tout seul : l'observateur global voit les soldes bouger
      // (components/LiveProfileSync).
      router.replace((params.origin || '/(tabs)/pilotage') as any);
    } catch (e: unknown) {
      Alert.alert('Un souci', e instanceof Error ? e.message : "Impossible d'enregistrer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScreenGradient />
      {/* edges={[]} comme tous les écrans de saisie de l'app (comptes/add, transactions/add,
          transfer) : l'inset du bas est DÉJÀ pris en charge par la barre d'onglets, qui se dessine
          juste en dessous. Le rajouter ici laissait une bande vide entre le pied de page et le menu. */}
      <SafeAreaView style={[{ flex: 1 }, pageColumn(isDesktop, 'form', 0)]} edges={[]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <ScreenHeader title="Mettre à jour mon solde" onBack={goBack} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.lede}>
            Ouvre ton appli bancaire et recopie le solde affiché. On s’occupe du reste.
            <InfoDot term="maj_solde" size={14} />
          </Text>

          {/* Date du relevé — obligatoire, comme sur la fiche d'un compte. */}
          {checking.length > 0 && (
            <View style={styles.dateCard}>
              <Text style={styles.dateLabel}>Date du solde relevé</Text>
              <View style={styles.dateRow}>
                <TextInput
                  style={[styles.dateInput, !dateValid && styles.dateInputError]}
                  value={dateDisplay}
                  onChangeText={(v) => {
                    setDateDisplay(v);
                    const iso = parseDateFromFrench(v);
                    if (iso) setDate(iso);
                  }}
                  placeholder="jj-mm-aaaa"
                  placeholderTextColor={COLORS.textSecondary}
                  keyboardType="numbers-and-punctuation"
                />
                <TouchableOpacity style={styles.dateBtn} onPress={() => setShowCalendar(true)} accessibilityRole="button">
                  <Ionicons name="calendar-outline" size={18} color={COLORS.blue} />
                </TouchableOpacity>
              </View>
              <Text style={styles.dateHint}>
                {dateValid
                  ? (date === todayISO()
                      ? 'Aujourd’hui. Les soldes ci-dessous sont ceux que Relyka connaît à cette date.'
                      : 'Les soldes ci-dessous sont remontés à cette date : recopie le solde que ta banque affichait ce jour-là.')
                  : 'Indique une date (jj-mm-aaaa), au plus tard aujourd’hui.'}
              </Text>
            </View>
          )}

          {checking.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Tu n’as pas encore de compte courant. Ajoute-en un depuis l’onglet Comptes.
              </Text>
            </View>
          )}

          {checking.map((a: any) => {
            const sym = currencySymbolFor(a.currency);
            const g = gaps.find((x) => x.account.id === a.id);
            return (
              <View key={a.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="wallet-outline" size={16} color={COLORS.blue} />
                  <Text style={styles.cardName} numberOfLines={1}>{a.name}</Text>
                  {!!a.is_default && <Text style={styles.badge}>principal</Text>}
                </View>

                <Text style={styles.known}>
                  Connu par Relyka {date !== todayISO() && dateValid ? `au ${dateDisplay}` : ''} : {balanceAtDate(a.id, Number(a.balance)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {sym}
                </Text>

                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    value={inputs[a.id] ?? ''}
                    onChangeText={(v) => setInputs((p) => ({ ...p, [a.id]: v.replace(/[^0-9.,-]/g, '') }))}
                    keyboardType="decimal-pad"
                    placeholder="Solde réel à cette date"
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <Text style={styles.unit}>{sym}</Text>
                </View>

                {g && (
                  <View style={[styles.gapBox, { borderColor: (g.gap === 0 ? COLORS.emerald : g.gap < 0 ? COLORS.orange : COLORS.emerald) + '4D' }]}>
                    {g.gap === 0 ? (
                      <Text style={[styles.gapText, { color: COLORS.emerald }]}>
                        Aucun écart — tu confirmes ton solde. C’est une vérification à part entière.
                      </Text>
                    ) : (
                      <Text style={[styles.gapText, { color: g.gap < 0 ? COLORS.orange : COLORS.emerald }]}>
                        Écart de {g.gap > 0 ? '+' : '−'} {Math.abs(Math.round(g.gap)).toLocaleString('fr-FR')} {sym}
                        {g.gap < 0
                          ? ' — on le place en dépenses variables du mois.'
                          : ' — on l’enregistre comme une rentrée non saisie.'}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {touched && (
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>Ce qui va se passer</Text>
              <Text style={styles.summaryText}>
                • Ton Relyka est recalculé{totalGap !== 0 ? ` (${totalGap > 0 ? '+' : '−'} ${Math.abs(Math.round(totalGap)).toLocaleString('fr-FR')} environ)` : ''}.{'\n'}
                • Tes recommandations du mois sont mises à jour.{'\n'}
                • Tes montants repassent en <Text style={{ fontWeight: '700', color: COLORS.emerald }}>« à jour »</Text> au lieu d’être affichés en fourchette.
                {'  '}<InfoDot term="confiance" size={13} />
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.cta, (!touched || !dateValid || saving) && { opacity: 0.45 }]}
            disabled={!touched || !dateValid || saving}
            onPress={submit}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={COLORS.bg} />
              : <>
                  <Text style={styles.ctaLabel}>
                    Valider {gaps.length > 1 ? `${gaps.length} comptes` : ''}
                  </Text>
                  <Ionicons name="checkmark" size={18} color={COLORS.bg} />
                </>}
          </TouchableOpacity>
          <Text style={styles.foot}>
            Tu peux ne remplir qu’un seul compte : les autres restent inchangés.
          </Text>
        </View>
      </SafeAreaView>

      {/* Calendrier — même composant et mêmes bornes que le « Nouveau solde » d'une fiche de compte. */}
      <Modal visible={showCalendar} transparent animationType="fade" onRequestClose={() => setShowCalendar(false)}>
        <Pressable style={styles.calOverlay} onPress={() => setShowCalendar(false)}>
          <Pressable style={styles.calSheet} onPress={() => {}}>
            <CalendarWithPicker
              current={date}
              maxDate={todayISO()}
              onDayPress={(day: any) => {
                setDate(day.dateString);
                setDateDisplay(formatDateFrench(day.dateString));
                setShowCalendar(false);
              }}
              markedDates={date ? { [date]: { selected: true, selectedColor: COLORS.blue, selectedTextColor: '#000' } } : {}}
              accentColor={COLORS.blue}
              bgColor={COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor={COLORS.textSecondary}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
    lede: { fontSize: 14.5, color: c.textSecondary, lineHeight: 21 },

    // Date du relevé (obligatoire)
    dateCard: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 16, padding: 14, gap: 8,
    },
    dateLabel: { fontSize: 12.5, fontWeight: '700', color: c.text },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dateInput: {
      flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: c.text,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    dateInputError: { borderColor: c.orange },
    dateBtn: {
      width: 46, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
    },
    dateHint: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16 },
    calOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    calSheet: { ...sheetWidth, backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 10 },


    empty: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 18 },
    emptyText: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },

    card: {
      backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.cardBorder,
      padding: 15, gap: 9,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardName: { flex: 1, fontSize: 15.5, fontWeight: '700', color: c.text },
    badge: {
      fontSize: 10, fontWeight: '800', color: c.blue, textTransform: 'uppercase', letterSpacing: 0.5,
      backgroundColor: c.blue + '1A', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden',
    },
    known: { fontSize: 12.5, color: c.textSecondary },
    inputRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.bg, borderWidth: 1.5, borderColor: c.blue, borderRadius: 14,
      paddingHorizontal: 14, paddingVertical: 11,
    },
    input: { flex: 1, fontSize: 24, fontWeight: '800', color: c.text, padding: 0 },
    unit: { fontSize: 16, fontWeight: '700', color: c.textSecondary },
    gapBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
    gapText: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },

    summary: {
      backgroundColor: c.emerald + '12', borderRadius: 16, borderWidth: 1, borderColor: c.emerald + '33',
      padding: 15, gap: 6,
    },
    summaryTitle: { fontSize: 13.5, fontWeight: '800', color: c.emerald },
    summaryText: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },

    footer: {
      paddingHorizontal: 16, paddingTop: 10, paddingBottom: Platform.OS === 'web' ? 18 : 10,
      gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder, backgroundColor: c.bg,
    },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
      backgroundColor: c.emerald, borderRadius: 16, paddingVertical: 16,
    },
    ctaLabel: { fontSize: 16, fontWeight: '800', color: c.bg },
    foot: { fontSize: 12, color: c.textSecondary, textAlign: 'center' },
  });
}
