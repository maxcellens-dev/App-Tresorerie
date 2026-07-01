/**
 * Détail d'un crédit (module Crédit, Lot C2) : synthèse (CRD, mensualité, coût) + tableau d'amortissement.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import ScreenGradient from '../../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/ScreenHeader';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useAuth } from '../../../../contexts/AuthContext';
import { useCredits, useDeleteCredit, useUpdateCredit } from '../../../../hooks/useCredits';
import { useAllAccounts } from '../../../../hooks/useAccounts';
import { useCreditEvents, useAddCreditEvent, useDeleteCreditEvent } from '../../../../hooks/useCreditEvents';
import CreditShareSection from '../../../../components/CreditShareSection';
import { computeAmortization } from '../../../../lib/amortization';
import { todayISO, formatDateFrench } from '../../../../lib/dateUtils';

export default function CreditDetailScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const { data: credits = [] } = useCredits(user?.id);
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const del = useDeleteCredit(user?.id);
  const update = useUpdateCredit(user?.id);
  const { data: events = [] } = useCreditEvents(id);
  const addEvent = useAddCreditEvent(user?.id);
  const delEvent = useDeleteCreditEvent(user?.id);
  const credit = credits.find((c) => c.id === id);

  const [editTable, setEditTable] = useState(false);
  // Édition ligne-par-ligne via un MODAL (sinon des centaines de TextInput figent l'app sur mobile) :
  // on tape une ligne → un modal s'ouvre pour éditer/enregistrer cette échéance.
  const [editRowPeriod, setEditRowPeriod] = useState<number | null>(null);
  const [showEvt, setShowEvt] = useState(false);
  const [evtKind, setEvtKind] = useState<'early_repayment' | 'rate_change'>('early_repayment');
  const [evtAmount, setEvtAmount] = useState('');
  const [evtDate, setEvtDate] = useState(todayISO());

  // #3 — retour matériel (Android) : revenir à la page précédente plutôt que de quitter.
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.back(); return true; });
    return () => sub.remove();
  }, [router]));

  const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const today = todayISO();
  const amort = useMemo(() => (credit ? computeAmortization({ ...credit, events }) : null), [credit, events]);

  // Enregistre DIRECTEMENT les overrides manuels d'UNE échéance (via le modal). Une valeur vide efface
  // l'override de cette colonne. Persiste immédiatement dans schedule_overrides.
  const saveRow = async (period: number, fields: { p?: string; i?: string; int?: string; cap?: string; rd?: string }) => {
    if (!credit) return;
    const next: Record<string, any> = { ...(credit.schedule_overrides ?? {}) };
    const cur: any = { ...(next[String(period)] ?? {}) };
    for (const key of ['p', 'i', 'int', 'cap', 'rd'] as const) {
      const raw = fields[key];
      if (raw == null) continue;
      if (raw.trim() === '') { delete cur[key]; continue; }
      const v = parseFloat(raw.replace(',', '.'));
      if (!Number.isNaN(v)) cur[key] = v;
    }
    if (Object.keys(cur).length === 0) delete next[String(period)]; else next[String(period)] = cur;
    await update.mutateAsync({ id: credit.id, schedule_overrides: Object.keys(next).length ? next : null } as any);
  };

  const saveEvent = async () => {
    const v = parseFloat(evtAmount.replace(',', '.'));
    if (Number.isNaN(v) || v <= 0 || !id) return;
    await addEvent.mutateAsync(evtKind === 'early_repayment'
      ? { credit_id: id, date: evtDate, kind: 'early_repayment', amount: v }
      : { credit_id: id, date: evtDate, kind: 'rate_change', new_rate: v });
    setShowEvt(false); setEvtAmount('');
  };

  if (!credit || !amort) {
    return (
      <View style={styles.root}><ScreenGradient /><SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Crédit" onBack={() => router.back()} />
        <Text style={styles.empty}>Crédit introuvable.</Text>
      </SafeAreaView></View>
    );
  }

  const canWrite = credit._role !== 'read'; // membre en consultation → lecture seule
  const crd = amort.crdAtDate(today);
  const paid = amort.paidCountAtDate(today);
  // Capital déjà remboursé (hors intérêts) = emprunté − capital restant dû (= somme de la colonne Capital
  // du tableau déjà payée). Pourcentage sur le capital emprunté.
  const repaidPrincipal = Math.max(0, credit.principal - crd);
  const repaidPct = credit.principal > 0 ? (repaidPrincipal / credit.principal) * 100 : 0;
  const acctName = accounts.find((a) => a.id === credit.account_id)?.name;

  // Décomposition des coûts (utilisée par la synthèse EN HAUT et la section « Coûts » → mêmes montants).
  const cInterest = credit.interest_total_manual != null ? credit.interest_total_manual : amort.totalInterest;
  const cLoanFees = (credit.fees_guarantee ?? 0) + (credit.fees_notary ?? 0) + (credit.interim_interest ?? 0) + (credit.management_fees ?? 0);
  const cExtraFees = (credit.fees_file ?? 0) + (credit.fees_bank ?? 0) + (credit.other_fees ?? 0);
  const cCoutPret = cInterest + cLoanFees;
  const cCoutTotal = cCoutPret + amort.totalInsurance + cExtraFees;

  const confirmDelete = () => {
    Alert.alert('Supprimer le crédit', `Supprimer « ${credit.label} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => { await del.mutateAsync(credit.id); router.back(); } },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScreenGradient />
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader
          title={credit.label}
          onBack={() => router.back()}
          right={canWrite ? (
            <TouchableOpacity onPress={() => router.push(`/(tabs)/comptes/credit-add?id=${credit.id}` as any)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="pencil" size={16} color={COLORS.blue} />
              <Text style={{ color: COLORS.blue, fontWeight: '700', fontSize: 14 }}>Modifier</Text>
            </TouchableOpacity>
          ) : undefined}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Synthèse */}
          <View style={styles.card}>
            <Text style={styles.crdLabel}>Capital restant dû</Text>
            <Text style={styles.crdValue}>{fmt(crd)}</Text>
            <Text style={styles.crdSub}>{paid}/{credit.duration_months} échéances payées · emprunté {fmt(credit.principal)}</Text>
            <View style={styles.statRow}>
              <View style={styles.stat}><Text style={styles.statK}>Mensualité</Text><Text style={styles.statV}>{fmt(amort.monthlyWithInsurance)}</Text></View>
              <View style={styles.stat}><Text style={styles.statK}>Taux</Text><Text style={styles.statV}>{credit.rate_annual}%</Text></View>
              <View style={styles.stat}><Text style={styles.statK}>Coût total</Text><Text style={[styles.statV, { color: COLORS.danger }]}>{fmt(cCoutTotal)}</Text></View>
            </View>
            <View style={styles.repaidRow}>
              <Text style={styles.repaidLabel}>Remboursé</Text>
              <Text style={styles.repaidValue}>{Math.round(repaidPct)}% · {fmt(repaidPrincipal)}</Text>
            </View>
          </View>

          {/* Paramètres */}
          <View style={styles.card}>
            {credit.lender ? <Row k="Prêteur" v={credit.lender} /> : null}
            {acctName ? <Row k="Prélèvement" v={acctName} /> : null}
            <Row k="Catégorie" v={(credit as any).category?.name ?? 'Crédits'} />
            <Row k="1ʳᵉ échéance" v={formatDateFrench((credit.first_payment_date as string) || credit.start_date)} />
            {credit.insurance_monthly ? <Row k="Assurance" v={`${fmt(credit.insurance_monthly)}/mois`} /> : null}
            {credit.is_simulation ? <Row k="Statut" v="Simulation" /> : null}
          </View>

          {/* #5 — Décomposition des coûts (mêmes montants que la synthèse en haut) */}
          <Text style={styles.sectionTitle}>Coûts</Text>
          <View style={styles.card}>
            <Row k={`Intérêts${credit.interest_total_manual != null ? ' (manuel)' : ''}`} v={fmt(cInterest)} />
            {cLoanFees > 0 ? <Row k="Frais du prêt" v={fmt(cLoanFees)} /> : null}
            <Row k="Coût du prêt" v={fmt(cCoutPret)} />
            {amort.totalInsurance > 0 ? <Row k="Assurance (totale)" v={fmt(amort.totalInsurance)} /> : null}
            {cExtraFees > 0 ? <Row k="Frais à part" v={fmt(cExtraFees)} /> : null}
            {(credit.personal_contribution ?? 0) > 0 ? <Row k="Apport personnel" v={fmt(credit.personal_contribution!)} /> : null}
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.cardBorder, marginTop: 4, paddingTop: 4 }}>
              <View style={styles.infoRow}><Text style={[styles.infoK, { fontWeight: '800', color: COLORS.text }]}>Coût total</Text><Text style={[styles.infoV, { color: COLORS.danger, fontWeight: '800' }]}>{fmt(cCoutTotal)}</Text></View>
            </View>
          </View>

          {/* C5 — Événements (remboursement anticipé, changement de taux) */}
          <View style={styles.evtHead}>
            <Text style={styles.sectionTitle}>Événements</Text>
            {canWrite && (
              <TouchableOpacity style={styles.evtAdd} onPress={() => setShowEvt(true)}>
                <Ionicons name="add" size={16} color={COLORS.blue} />
                <Text style={styles.evtAddText}>Ajouter</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.card}>
            {events.length === 0 ? (
              <Text style={styles.evtEmpty}>Aucun (remboursement anticipé, renégociation de taux…).</Text>
            ) : events.map((e) => (
              <View key={e.id} style={styles.evtRow}>
                <Ionicons name={e.kind === 'early_repayment' ? 'arrow-down-circle-outline' : 'trending-down-outline'} size={16} color={COLORS.blue} />
                <Text style={styles.evtLabel}>
                  {formatDateFrench(e.date)} · {e.kind === 'early_repayment' ? `Remb. anticipé ${fmt(Number(e.amount))}` : `Taux → ${e.new_rate}%`}
                </Text>
                <TouchableOpacity onPress={() => delEvent.mutate({ id: e.id, credit_id: id! })}><Ionicons name="close" size={16} color={COLORS.danger} /></TouchableOpacity>
              </View>
            ))}
          </View>

          {/* Tableau d'amortissement — éditable manuellement par échéance (mensualité + assurance). */}
          <View style={styles.evtHead}>
            <Text style={styles.sectionTitle}>Tableau d'amortissement</Text>
            {editTable ? (
              <TouchableOpacity onPress={() => { setEditRowPeriod(null); setEditTable(false); }}><Text style={{ color: COLORS.emerald, fontWeight: '800', fontSize: 13 }}>Terminé</Text></TouchableOpacity>
            ) : (canWrite && (
              <TouchableOpacity style={styles.evtAdd} onPress={() => { setEditRowPeriod(null); setEditTable(true); }}>
                <Ionicons name="create-outline" size={16} color={COLORS.blue} /><Text style={styles.evtAddText}>Modifier</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.tDisclaimer}>
            Ce tableau est fourni à titre indicatif : il ne saurait se substituer à l'échéancier officiel
            établi par l'organisme prêteur, qui applique ses propres méthodes de calcul (notamment pour la
            répartition des intérêts) et fait seul foi.
          </Text>
          {(() => {
            // Vue = échéancier RÉEL (remboursement + assurance décalée). Édition = par période (schedule).
            const rows = editTable ? amort.schedule : amort.displaySchedule;
            const hasInsurance = editTable || rows.some((r) => r.insurance > 0);
            const nextIdx = rows.findIndex((r) => r.date >= today);
            const overridden = (r: any) => !!(credit.schedule_overrides ?? {})[String(r.period)];
            // Largeur mini pour que toutes les colonnes soient lisibles : le tableau glisse horizontalement
            // sur les petits écrans (scroll latéral).
            const tableMinW = 150 + (hasInsurance ? 5 : 4) * 96; // Échéance + N colonnes chiffrées
            return (
              <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
              <View style={[styles.card, { minWidth: tableMinW }]}>
                <View style={[styles.tRow, styles.tHead]}>
                  <Text style={[styles.tcDate, styles.tHeadText]}>Échéance</Text>
                  <Text style={[styles.tc, styles.tHeadText]}>Mensualité</Text>
                  {(hasInsurance) && <Text style={[styles.tc, styles.tHeadText]}>Assur.</Text>}
                  <Text style={[styles.tc, styles.tHeadText]}>Intérêts</Text>
                  <Text style={[styles.tc, styles.tHeadText]}>Capital</Text>
                  <Text style={[styles.tc, styles.tHeadText]}>Restant dû</Text>
                </View>
                {rows.map((r, i) => {
                  const past = r.date < today;
                  const isNext = i === nextIdx;
                  const rowInner = (
                    <View style={[styles.tRow, past && !editTable && { opacity: 0.5 }, isNext && styles.tRowNext, editTable && overridden(r) && styles.tRowEditing]}>
                      <Text style={[styles.tcDate, isNext && styles.tNextText]}>{formatDateFrench(r.date).slice(3)}</Text>
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.payment.toFixed(2)}</Text>
                      {hasInsurance && <Text style={[styles.tc, isNext && styles.tNextText]}>{r.insurance.toFixed(2)}</Text>}
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.interest.toFixed(2)}</Text>
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.principalPart.toFixed(2)}</Text>
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.crdAfter.toFixed(2)}</Text>
                      {editTable && <Ionicons name="chevron-forward" size={13} color={COLORS.blue} style={{ marginLeft: 2 }} />}
                    </View>
                  );
                  return editTable
                    ? <TouchableOpacity key={`${r.date}-${i}`} activeOpacity={0.6} onPress={() => setEditRowPeriod(r.period)}>{rowInner}</TouchableOpacity>
                    : <View key={`${r.date}-${i}`}>{rowInner}</View>;
                })}
                <Text style={styles.tNote}>{editTable ? 'Touche une ligne pour l\'éditer dans une fenêtre : chaque enregistrement est immédiat. « Terminé » ferme le mode édition.' : (hasInsurance ? '« Mensualité » = hors assurance (intérêts + capital). Total prélevé = mensualité + assurance.' : '')}</Text>
              </View>
              </ScrollView>
            );
          })()}

          {/* Activer / désactiver (utile pour une simulation : compté ou non en projection/tréso) */}
          {canWrite && (
          <TouchableOpacity style={styles.toggleBtn} onPress={() => update.mutate({ id: credit.id, is_active: !credit.is_active })} activeOpacity={0.8}>
            <Ionicons name={credit.is_active ? 'pause-circle-outline' : 'play-circle-outline'} size={18} color={COLORS.blue} />
            <Text style={styles.toggleLabel}>{credit.is_active ? 'Désactiver (retirer de la projection/tréso)' : 'Activer (compter en projection/tréso)'}</Text>
          </TouchableOpacity>
          )}

          {/* Partage (propriétaire uniquement) */}
          <CreditShareSection credit={credit} />

          {credit._role === 'owner' && (
            <TouchableOpacity style={styles.delBtn} onPress={confirmDelete}>
              <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
              <Text style={styles.delLabel}>Supprimer ce crédit</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Modal ajout d'événement */}
      <Modal visible={showEvt} transparent animationType="fade" onRequestClose={() => setShowEvt(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ajouter un événement</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {([['early_repayment', 'Remb. anticipé'], ['rate_change', 'Changement de taux']] as const).map(([k, lbl]) => (
                <TouchableOpacity key={k} style={[styles.kindChip, evtKind === k && styles.kindChipActive]} onPress={() => setEvtKind(k)}>
                  <Text style={[styles.kindText, evtKind === k && { color: COLORS.blue }]}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.mLabel}>{evtKind === 'early_repayment' ? 'Montant remboursé (€)' : 'Nouveau taux annuel (%)'}</Text>
            <TextInput style={styles.mInput} value={evtAmount} onChangeText={setEvtAmount} keyboardType="decimal-pad" placeholder={evtKind === 'early_repayment' ? '10000' : '2.9'} placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.mLabel}>Date (jj-mm-aaaa)</Text>
            <TextInput style={styles.mInput} value={formatDateFrench(evtDate)} onChangeText={(v) => { const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/); if (m) setEvtDate(`${m[3]}-${m[2]}-${m[1]}`); }} placeholder="jj-mm-aaaa" placeholderTextColor={COLORS.textSecondary} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity style={[styles.mBtn, { borderWidth: 1, borderColor: COLORS.cardBorder }]} onPress={() => setShowEvt(false)}><Text style={{ color: COLORS.text, fontWeight: '600' }}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.mBtn, { backgroundColor: COLORS.emerald }]} onPress={saveEvent}><Text style={{ color: COLORS.bg, fontWeight: '700' }}>Ajouter</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal édition d'UNE échéance du tableau d'amortissement (saisie directe + ligne suivante). */}
      <RowEditModal
        visible={editRowPeriod != null}
        period={editRowPeriod ?? 0}
        schedule={amort.schedule}
        overrides={credit.schedule_overrides ?? {}}
        hasNext={editRowPeriod != null && amort.schedule.some((r) => r.period === (editRowPeriod + 1))}
        onSave={saveRow}
        onNext={() => setEditRowPeriod((p) => (p != null ? p + 1 : null))}
        onClose={() => setEditRowPeriod(null)}
        c={COLORS}
        styles={styles}
      />
    </View>
  );

  function Row({ k, v }: { k: string; v: string }) {
    return <View style={styles.infoRow}><Text style={styles.infoK}>{k}</Text><Text style={styles.infoV}>{v}</Text></View>;
  }
}

/** Modal d'édition d'une échéance : champs pré-remplis par les overrides existants (vide = calcul auto,
 *  la date sert de placeholder), enregistrement immédiat, et « Ligne suivante » pour enchaîner. */
function RowEditModal({ visible, period, schedule, overrides, hasNext, onSave, onNext, onClose, c, styles }: {
  visible: boolean; period: number; schedule: any[]; overrides: Record<string, any>; hasNext: boolean;
  onSave: (period: number, fields: { p?: string; i?: string; int?: string; cap?: string; rd?: string }) => Promise<void>;
  onNext: () => void; onClose: () => void; c: any; styles: any;
}) {
  const [p, setP] = useState(''); const [i, setI] = useState(''); const [int, setInt] = useState('');
  const [cap, setCap] = useState(''); const [rd, setRd] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const o = overrides[String(period)] ?? {};
    setP(o.p != null ? String(o.p) : ''); setI(o.i != null ? String(o.i) : ''); setInt(o.int != null ? String(o.int) : '');
    setCap(o.cap != null ? String(o.cap) : ''); setRd(o.rd != null ? String(o.rd) : '');
  }, [period, visible]);

  const row = schedule.find((r) => r.period === period);
  if (!row) return null;
  const submit = async (goNext: boolean) => {
    setBusy(true);
    try { await onSave(period, { p, i, int, cap, rd }); if (goNext && hasNext) onNext(); else onClose(); }
    finally { setBusy(false); }
  };
  const field = (label: string, value: string, setter: (v: string) => void, computed: number) => (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.mLabel}>{label}</Text>
      <TextInput style={styles.mInput} value={value} onChangeText={setter} keyboardType="decimal-pad"
        placeholder={computed.toFixed(2)} placeholderTextColor={c.textSecondary} />
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Échéance {formatDateFrench(row.date)}</Text>
          <Text style={[styles.tNote, { marginTop: 0, marginBottom: 10 }]}>Laisse vide pour garder le calcul automatique (la valeur grisée). Une valeur saisie prime.</Text>
          {field('Mensualité (hors assurance)', p, setP, row.payment)}
          {field('Assurance', i, setI, row.insurance)}
          {field('Intérêts', int, setInt, row.interest)}
          {field('Capital', cap, setCap, row.principalPart)}
          {field('Restant dû', rd, setRd, row.crdAfter)}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <TouchableOpacity style={[styles.mBtn, { borderWidth: 1, borderColor: c.cardBorder }]} onPress={onClose} disabled={busy}><Text style={{ color: c.text, fontWeight: '600' }}>Fermer</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.mBtn, { backgroundColor: c.emerald }]} onPress={() => submit(false)} disabled={busy}><Text style={{ color: c.bg, fontWeight: '700' }}>Enregistrer</Text></TouchableOpacity>
          </View>
          {hasNext && (
            <TouchableOpacity style={[styles.mBtn, { backgroundColor: c.blue, marginTop: 10 }]} onPress={() => submit(true)} disabled={busy}>
              <Text style={{ color: c.bg, fontWeight: '700' }}>Enregistrer + ligne suivante ›</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    scroll: { flex: 1 },
    empty: { textAlign: 'center', color: c.textSecondary, marginTop: 40 },
    card: { padding: 16, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, marginTop: 12 },
    crdLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    crdValue: { fontSize: 30, fontWeight: '800', color: c.text, marginTop: 2 },
    crdSub: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    statRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
    stat: { flex: 1 },
    statK: { fontSize: 11, color: c.textSecondary },
    statV: { fontSize: 15, fontWeight: '700', color: c.text, marginTop: 2 },
    repaidRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.cardBorder },
    repaidLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    repaidValue: { fontSize: 15, fontWeight: '800', color: c.emerald },
    infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    infoK: { fontSize: 13, color: c.textSecondary },
    infoV: { fontSize: 13, fontWeight: '600', color: c.text },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginTop: 18, marginBottom: 2, paddingHorizontal: 4 },
    evtHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 4 },
    evtAdd: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    evtAddText: { color: c.blue, fontWeight: '700', fontSize: 13 },
    evtEmpty: { fontSize: 12.5, color: c.textSecondary },
    evtRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    evtLabel: { flex: 1, fontSize: 12.5, color: c.text },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 22 },
    modalCard: { backgroundColor: c.cardSolid ?? c.card, borderRadius: 18, padding: 18 },
    modalTitle: { fontSize: 17, fontWeight: '800', color: c.text, marginBottom: 12 },
    kindChip: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    kindChipActive: { borderColor: c.blue, backgroundColor: c.blue + '12' },
    kindText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },
    mLabel: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary, marginBottom: 5, marginTop: 8 },
    mInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text },
    mBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
    tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.cardBorder },
    tRowNext: { backgroundColor: c.blue + '1A', borderRadius: 6 },
    tRowEditing: { backgroundColor: c.emerald + '18', borderRadius: 6, borderWidth: 1, borderColor: c.emerald + '66' },
    tNextText: { color: c.blue, fontWeight: '800' },
    tHead: { borderBottomWidth: 1 },
    tHeadText: { fontWeight: '700', color: c.textSecondary, fontSize: 12.5 },
    tcDate: { width: 64, fontSize: 12.5, color: c.text },
    tc: { flex: 1, textAlign: 'right', fontSize: 12.5, color: c.text, paddingLeft: 6 },
    tNote: { fontSize: 10.5, color: c.textSecondary, marginTop: 8, lineHeight: 14 },
    tDisclaimer: { fontSize: 11, fontStyle: 'italic', color: c.textSecondary, lineHeight: 15, marginTop: 6, marginBottom: 8, paddingHorizontal: 4 },
    tInput: { flex: 1, marginLeft: 2, borderWidth: 1, borderColor: c.blue + '66', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 4, fontSize: 10, color: c.text, textAlign: 'right' },
    toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, marginTop: 18, borderRadius: 12, borderWidth: 1, borderColor: c.blue + '55' },
    toggleLabel: { color: c.blue, fontWeight: '700', fontSize: 13 },
    delBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: c.danger + '55' },
    delLabel: { color: c.danger, fontWeight: '700', fontSize: 14 },
  });
}
