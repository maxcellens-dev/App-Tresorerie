/**
 * Détail d'un crédit (module Crédit, Lot C2) : synthèse (CRD, mensualité, coût) + tableau d'amortissement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useAuth } from '../../../../contexts/AuthContext';
import { useCredits, useDeleteCredit, useUpdateCredit } from '../../../../hooks/data/useCredits';
import { useAllAccounts } from '../../../../hooks/data/useAccounts';
import { useCreditEvents, useAddCreditEvent, useDeleteCreditEvent } from '../../../../hooks/data/useCreditEvents';
import CreditShareSection from '../../../../components/credit/CreditShareSection';
import CreditCurve from '../../../../components/charts/CreditCurve';
import { computeAmortization, nextPaymentAtDate, rateAtDate } from '../../../../lib/finance/amortization';
import { todayISO, formatDateFrench } from '../../../../lib/dateUtils';
import KeyboardAwareOverlay from '../../../../components/layout/KeyboardAwareOverlay';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../../../lib/finance/currency';
import { sanitizeAmountInput, sanitizeRateInput, parseAmountInput } from '../../../../lib/ui/amountInput';
import { useSubmitLock } from '../../../../hooks/platform/useSubmitLock';

export default function CreditDetailScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  /* `period` : échéance à mettre en avant. Arriver ici depuis une transaction de prélèvement
     (fiche du compte, liste des transactions) revient à demander « montre-moi CETTE échéance » —
     sans ce repère, on atterrissait en haut de la fiche, à charge de retrouver la bonne ligne
     dans un tableau de 240. */
  const params = useLocalSearchParams<{ id: string; period?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const focusPeriod = Number(Array.isArray(params.period) ? params.period[0] : params.period) || null;
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
  const submitLock = useSubmitLock();

  /* Mise en avant de l'échéance d'où l'on vient (`?period=`) : on fait défiler jusqu'à ELLE et on
     la surligne. Le surlignage RESTE (il ne clignote pas puis disparaît) tant qu'on n'a pas touché
     une autre ligne — c'est un repère, pas une notification.

     Le défilement vise la LIGNE, pas le tableau : viser le tableau amenait son en-tête en haut de
     l'écran, donc l'échéance cherchée en bas — voire hors champ sur un crédit de 240 mois.
     Deux mesures suffisent : la position du bloc « tableau » dans la page (`tableWrapY`) et celle
     de la ligne dans ce bloc (`onLayout` de la ligne visée). */
  const scrollRef = useRef<any>(null);
  const tableWrapY = useRef(0);
  const focusRowY = useRef<number | null>(null);
  const focusTries = useRef(0);
  const focusDone = useRef(false);
  const [highlightPeriod, setHighlightPeriod] = useState<number | null>(null);
  useEffect(() => { if (focusPeriod) setHighlightPeriod(focusPeriod); }, [focusPeriod]);

  /** Marge au-dessus de la ligne visée : elle arrive juste sous l'en-tête de l'écran. */
  const FOCUS_TOP_GAP = 16;

  /* Le défilement se REJOUE tant que la page grandit encore.
     Un seul essai après un délai fixe ne pouvait pas marcher à l'arrivée par navigation : la page
     se mesure par morceaux (le graphe du crédit, puis le tableau et ses centaines de lignes). Tant
     que le contenu est court, `scrollTo` est ÉCRÊTÉ à la hauteur connue à cet instant — on ne
     bougeait donc pas, alors qu'un rechargement de la page, où tout est mesuré d'un coup,
     fonctionnait. D'où le symptôme « ça ne scrolle qu'après actualisation ».
     On rejoue donc à chaque nouvelle mesure (ligne, tableau, taille du contenu), quelques fois au
     plus, et on s'arrête dès que l'utilisateur prend la main sur le défilement. */
  const applyFocusScroll = useCallback(() => {
    if (focusDone.current || focusRowY.current == null) return;
    const y = Math.max(0, tableWrapY.current + focusRowY.current - FOCUS_TOP_GAP);
    // `animated: false` : une animation relancée à chaque mesure donnerait un défilement saccadé.
    scrollRef.current?.scrollTo?.({ y, animated: false });
    if (++focusTries.current >= 8) focusDone.current = true;
  }, []);

  const focusRow = useCallback((rowY: number) => {
    focusRowY.current = rowY;
    applyFocusScroll();
  }, [applyFocusScroll]);

  /* Fenêtre de temps bornée : passé ce délai, l'arrivée sur l'écran est finie et on ne reprend
     plus jamais la main. Sans ça, une remise en page tardive — basculer le tableau en mode
     édition, par exemple — aurait pu ramener l'utilisateur à la ligne d'origine bien plus tard. */
  useEffect(() => {
    if (!focusPeriod) return;
    const t = setTimeout(() => { focusDone.current = true; }, 2000);
    return () => clearTimeout(t);
  }, [focusPeriod]);

  // #3 — retour matériel (Android) : revenir à la page précédente plutôt que de quitter.
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.back(); return true; });
    return () => sub.remove();
  }, [router]));

  /* Tout sur cette fiche (échéancier, capital restant, coût) concerne UN crédit prélevé sur UN
     compte : les montants sont donc dans la devise de CE compte, pas dans la devise de référence.
     Un crédit sur un compte suisse affichait « 1 250,00 € » au lieu de « 1 250,00 CHF ». */
  const creditCurrency = accounts.find((a) => a.id === credit?.account_id)?.currency;
  const fmt = (v: number) =>
    v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    + ` ${creditCurrency ? currencySymbolFor(creditCurrency) : CURRENCY_SYMBOL}`;
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
      const v = parseAmountInput(raw);
      if (v != null) cur[key] = v;
    }
    if (Object.keys(cur).length === 0) delete next[String(period)]; else next[String(period)] = cur;
    await update.mutateAsync({ id: credit.id, schedule_overrides: Object.keys(next).length ? next : null } as any);
  };

  const saveEvent = async () => {
    const v = parseAmountInput(evtAmount);
    if (v == null || v <= 0 || !id) return;
    /* VERROU SYNCHRONE. Un événement de crédit n'est PAS idempotent : `credit_events` n'a aucune
       contrainte d'unicité, donc deux taps rapprochés insèrent deux remboursements anticipés. Le
       capital restant dû, l'échéancier et le coût total du prêt seraient alors faux — et comme les
       échéances échues sont matérialisées en vraies transactions, l'erreur descend jusqu'aux
       montants réels. Le drapeau `isPending` ne ferme la porte qu'au rendu suivant. */
    if (!submitLock.acquire()) return;
    try {
      await addEvent.mutateAsync(evtKind === 'early_repayment'
        ? { credit_id: id, date: evtDate, kind: 'early_repayment', amount: v }
        : { credit_id: id, date: evtDate, kind: 'rate_change', new_rate: v });
      setShowEvt(false); setEvtAmount('');
    } finally {
      // En cas d'échec, le modal reste ouvert avec la saisie intacte (l'erreur est signalée par le
      // filet global des mutations) — et le bouton redevient utilisable pour réessayer.
      submitLock.release();
    }
  };

  if (!credit || !amort) {
    return (
      <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={[]}>
        <ScreenHeader title="Crédit" onBack={() => router.back()} />
        <Text style={styles.empty}>Crédit introuvable.</Text>
      </SafeAreaView></View>
    );
  }

  const canWrite = credit._role !== 'read'; // membre en consultation → lecture seule
  /* Partager un crédit donne le droit de le CORRIGER, pas celui de le faire disparaître.
     Activer/désactiver retire le crédit de la projection et de la trésorerie de TOUS les
     participants, et arrête la matérialisation de ses échéances : au même titre que la suppression
     et la gestion des membres, cela reste au propriétaire. Le verrou correspondant est en base
     (migration 198) — ici on évite simplement de proposer une action qui serait refusée. */
  const isOwner = credit._role === 'owner';
  const crd = amort.crdAtDate(today);
  const paid = amort.paidCountAtDate(today);
  // Capital déjà remboursé (hors intérêts) = emprunté − capital restant dû (= somme de la colonne Capital
  // du tableau déjà payée). Pourcentage sur le capital emprunté.
  const repaidPrincipal = Math.max(0, credit.principal - crd);
  const repaidPct = credit.principal > 0 ? (repaidPrincipal / credit.principal) * 100 : 0;
  const acctName = accounts.find((a) => a.id === credit.account_id)?.name;
  // Taux réellement appliqué aujourd'hui (dernier `rate_change` échu), cf. lib/finance/amortization.
  const currentRate = rateAtDate({ rate_annual: credit.rate_annual, events }, today);

  // Décomposition des coûts (utilisée par la synthèse EN HAUT et la section « Coûts » → mêmes montants).
  const cInterest = credit.interest_total_manual != null ? credit.interest_total_manual : amort.totalInterest;
  // #3 — Intérêts intercalaires (différé). Avec un différé, ils sont DÉJÀ compris dans cInterest → on ne
  // les recompte PAS comme un frais (sinon double-comptage). Sans différé, on garde l'ancienne saisie
  // manuelle `interim_interest` comme frais du prêt (compatibilité).
  const hasDeferral = (credit.deferral_months ?? 0) > 0;
  const deferInt = amort.deferralInterest;
  const cLoanFees = (credit.fees_guarantee ?? 0) + (credit.fees_notary ?? 0) + (credit.management_fees ?? 0) + (hasDeferral ? 0 : (credit.interim_interest ?? 0));
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
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={[]}>
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
        <KeyboardAwareScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          // La page se mesure par morceaux : on rejoue le défilement ciblé à chaque fois qu'elle
          // grandit, sinon il reste écrêté à la hauteur connue au premier essai.
          onContentSizeChange={applyFocusScroll}
          // L'utilisateur fait défiler lui-même → on ne lui reprend plus la main.
          onScrollBeginDrag={() => { focusDone.current = true; }}
        >
          {/* Synthèse */}
          <View style={styles.card}>
            <Text style={styles.crdLabel}>Capital restant dû</Text>
            <Text style={styles.crdValue}>{fmt(crd)}</Text>
            <Text style={styles.crdSub}>{paid}/{amort.schedule.length} échéances payées · emprunté {fmt(credit.principal)}</Text>
            <View style={styles.statRow}>
              {/* Prochaine échéance RÉELLE, et taux EN VIGUEUR : la fiche affichait la mensualité
                  nominale (donc un autre chiffre que la liste des crédits, dès qu'il y a un différé
                  ou des paliers) et le taux d'ORIGINE (donc en contradiction avec l'échéancier
                  juste en dessous après une renégociation). */}
              <View style={styles.stat}><Text style={styles.statK}>Mensualité</Text><Text style={styles.statV}>{fmt(nextPaymentAtDate(amort, today))}</Text></View>
              <View style={styles.stat}><Text style={styles.statK}>Taux</Text><Text style={styles.statV}>{currentRate}%</Text></View>
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
            {hasDeferral ? <Row k="Différé" v={`${credit.deferral_months} mois · ${credit.deferral_type === 'total' ? (credit.deferral_interest_mode === 'deferred' ? 'total (intérêts remboursés en premier)' : 'total (intérêts capitalisés)') : 'partiel (intérêts payés)'}`} /> : null}
            {credit.insurance_monthly ? <Row k="Assurance" v={`${fmt(credit.insurance_monthly)}/mois`} /> : null}
            {credit.is_simulation ? <Row k="Statut" v="Simulation" /> : null}
          </View>

          {/* #5 — Décomposition des coûts (mêmes montants que la synthèse en haut) */}
          <Text style={styles.sectionTitle}>Coûts</Text>
          <View style={styles.card}>
            <Row k={`Intérêts${credit.interest_total_manual != null ? ' (manuel)' : ''}`} v={fmt(cInterest)} />
            {hasDeferral && deferInt > 0 && credit.interest_total_manual == null ? (
              <View style={styles.infoRow}>
                <Text style={[styles.infoK, { paddingLeft: 12 }]}>↳ dont intérêts intercalaires (différé)</Text>
                <Text style={styles.infoV}>{fmt(deferInt)}</Text>
              </View>
            ) : null}
            {cLoanFees > 0 ? <Row k="Frais du prêt" v={fmt(cLoanFees)} /> : null}
            <Row k="Coût du prêt" v={fmt(cCoutPret)} />
            {amort.totalInsurance > 0 ? <Row k="Assurance (totale)" v={fmt(amort.totalInsurance)} /> : null}
            {cExtraFees > 0 ? <Row k="Frais à part" v={fmt(cExtraFees)} /> : null}
            {(credit.personal_contribution ?? 0) > 0 ? <Row k="Apport personnel" v={fmt(credit.personal_contribution!)} /> : null}
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.cardBorder, marginTop: 4, paddingTop: 4 }}>
              <View style={styles.infoRow}><Text style={[styles.infoK, { fontWeight: '800', color: COLORS.text }]}>Coût total</Text><Text style={[styles.infoV, { color: COLORS.danger, fontWeight: '800' }]}>{fmt(cCoutTotal)}</Text></View>
            </View>
          </View>

          {/* Courbe de remboursement (capital vs intérêts par année + capital restant dû). */}
          {amort.schedule.length > 1 && (
            <>
              <Text style={styles.sectionTitle}>Courbe de remboursement</Text>
              <View style={styles.card}>
                <CreditCurve schedule={amort.schedule} colors={COLORS} principal={credit.principal} />
              </View>
            </>
          )}

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
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => delEvent.mutate({ id: e.id, credit_id: id! })}><Ionicons name="close" size={16} color={COLORS.danger} /></TouchableOpacity>
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
            // Différé « intérêts remboursés en premier » : colonne du stock d'intérêts différés restant
            // (comme la colonne « Total des intérêts différés » des échéanciers banque).
            const hasDeferred = rows.some((r) => (r.deferredAfter ?? 0) > 0);
            const nextIdx = rows.findIndex((r) => r.date >= today);
            const overridden = (r: any) => !!(credit.schedule_overrides ?? {})[String(r.period)];
            // Largeur mini pour que toutes les colonnes soient lisibles : le tableau glisse horizontalement
            // sur les petits écrans (scroll latéral).
            const tableMinW = 150 + (4 + (hasInsurance ? 1 : 0) + (hasDeferred ? 1 : 0)) * 96; // Échéance + N colonnes chiffrées
            // `onLayout` sur le tableau retient sa position DANS la page : additionnée à celle de
            // la ligne visée (mesurée plus bas), elle donne le point exact où défiler.
            return (
              <ScrollView
                horizontal showsHorizontalScrollIndicator nestedScrollEnabled
                onLayout={(e) => { tableWrapY.current = e.nativeEvent.layout.y; applyFocusScroll(); }}
              >
              <View style={[styles.card, { minWidth: tableMinW }]}>
                <View style={[styles.tRow, styles.tHead]}>
                  <Text style={[styles.tcDate, styles.tHeadText]}>Échéance</Text>
                  <Text style={[styles.tc, styles.tHeadText]}>Mensualité</Text>
                  {(hasInsurance) && <Text style={[styles.tc, styles.tHeadText]}>Assur.</Text>}
                  <Text style={[styles.tc, styles.tHeadText]}>Intérêts</Text>
                  <Text style={[styles.tc, styles.tHeadText]}>Capital</Text>
                  <Text style={[styles.tc, styles.tHeadText]}>Restant dû</Text>
                  {hasDeferred && <Text style={[styles.tc, styles.tHeadText]}>Int. différés</Text>}
                </View>
                {rows.map((r, i) => {
                  const past = r.date < today;
                  const isNext = i === nextIdx;
                  // Échéance d'où l'on vient : surlignée, et jamais estompée même si elle est passée.
                  const isFocused = highlightPeriod != null && r.period === highlightPeriod;
                  const rowInner = (
                    <View style={[styles.tRow, past && !editTable && !isFocused && { opacity: 0.5 }, isNext && styles.tRowNext, editTable && overridden(r) && styles.tRowEditing, isFocused && styles.tRowFocused]}>
                      <Text style={[styles.tcDate, isNext && styles.tNextText]}>{formatDateFrench(r.date).slice(3)}</Text>
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.payment.toFixed(2)}</Text>
                      {hasInsurance && <Text style={[styles.tc, isNext && styles.tNextText]}>{r.insurance.toFixed(2)}</Text>}
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.interest.toFixed(2)}</Text>
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.principalPart.toFixed(2)}</Text>
                      <Text style={[styles.tc, isNext && styles.tNextText]}>{r.crdAfter.toFixed(2)}</Text>
                      {hasDeferred && <Text style={[styles.tc, isNext && styles.tNextText]}>{r.deferredAfter != null ? r.deferredAfter.toFixed(2) : '—'}</Text>}
                      {editTable && <Ionicons name="chevron-forward" size={13} color={COLORS.blue} style={{ marginLeft: 2 }} />}
                    </View>
                  );
                  // La LIGNE visée se mesure elle-même : c'est elle qu'on amène en haut de l'écran,
                  // pas le début du tableau (qui peut être des centaines de lignes plus haut).
                  const onRowLayout = isFocused ? (e: any) => focusRow(e.nativeEvent.layout.y) : undefined;
                  return editTable
                    ? <TouchableOpacity key={`${r.date}-${i}`} activeOpacity={0.6} onLayout={onRowLayout} onPress={() => setEditRowPeriod(r.period)}>{rowInner}</TouchableOpacity>
                    : <View key={`${r.date}-${i}`} onLayout={onRowLayout}>{rowInner}</View>;
                })}
                <Text style={styles.tNote}>{editTable ? 'Touche une ligne pour l\'éditer dans une fenêtre : chaque enregistrement est immédiat. « Terminé » ferme le mode édition.' : (hasInsurance ? '« Mensualité » = hors assurance (intérêts + capital). Total prélevé = mensualité + assurance.' : '')}</Text>
              </View>
              </ScrollView>
            );
          })()}

          {/* Activer / désactiver (utile pour une simulation : compté ou non en projection/tréso).
              PROPRIÉTAIRE uniquement : c'est une mise hors circuit du crédit pour tout le monde. */}
          {isOwner && (
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
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* Modal ajout d'événement */}
      <Modal visible={showEvt} transparent animationType="fade" onRequestClose={() => setShowEvt(false)}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
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
            {/* Un remboursement anticipé est un MONTANT (2 décimales), un changement de taux est un
                TAUX (3 décimales — 1,125 % existe). Sans ce filtre, « 10.000 » était enregistré 10. */}
            <TextInput style={styles.mInput} value={evtAmount}
              onChangeText={(v) => setEvtAmount(evtKind === 'early_repayment' ? sanitizeAmountInput(v) : sanitizeRateInput(v))}
              keyboardType="decimal-pad" placeholder={evtKind === 'early_repayment' ? '10000' : '2.9'} placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.mLabel}>Date (jj-mm-aaaa)</Text>
            <TextInput style={styles.mInput} value={formatDateFrench(evtDate)} onChangeText={(v) => { const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/); if (m) setEvtDate(`${m[3]}-${m[2]}-${m[1]}`); }} placeholder="jj-mm-aaaa" placeholderTextColor={COLORS.textSecondary} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity style={[styles.mBtn, { borderWidth: 1, borderColor: COLORS.cardBorder }]} onPress={() => setShowEvt(false)}><Text style={{ color: COLORS.text, fontWeight: '600' }}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.mBtn, { backgroundColor: COLORS.emerald }]} onPress={saveEvent}><Text style={{ color: COLORS.bg, fontWeight: '700' }}>Ajouter</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareOverlay>
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
      <TextInput style={styles.mInput} value={value} onChangeText={(v) => setter(sanitizeAmountInput(v))} keyboardType="decimal-pad"
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
    // Échéance ciblée depuis une transaction (`?period=`) : repère franc, distinct du bleu de la
    // prochaine échéance et du vert d'une ligne déjà corrigée.
    tRowFocused: { backgroundColor: c.orange + '22', borderRadius: 6, borderWidth: 1, borderColor: c.orange + '88' },
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
