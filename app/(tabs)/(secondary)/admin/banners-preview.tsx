/**
 * Admin — Aperçu bandeaux & confiance.
 * Rend avec les VRAIS composants de production (états forcés, aucune écriture) :
 *  - le bandeau « prochain geste » (toutes les variantes du moteur d'état) ;
 *  - la bannière de clôture mensuelle (1 mois / plusieurs mois) ;
 *  - la carte « Ton Relyka » + recommandations aux 3 niveaux de confiance (fourchettes,
 *    bandeau ambre, badges, textes « minimum sûr ») + le garde-fou projection ;
 *  - les formulations vagues d'ancienneté de vérification.
 * Le flux COMPLET de clôture (modale, régul, bilan) écrit de vraies transactions → à tester
 * sur un compte de test, pas ici.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { useReliabilityConfig, deriveRelykaConfidence, type RelykaConfidence } from '../../../../hooks/useReliability';
import { getCurrentAction, type AppStateInputs } from '../../../../lib/appStateEngine';
import { unverifiedSincePhrase, verifiedAgoPhrase, RELIABILITY_DEFAULTS, type DriftCalibration } from '../../../../lib/confidenceEngine';
import { computeRecommendations, type SmartRecommendation } from '../../../../lib/recommendationEngine';
import { ActionBannerCard } from '../../../../components/NextActionBanner';
import { ClosureBannerCard } from '../../../../components/MonthlyClosure';
import RecommendationCard from '../../../../components/RecommendationCard';
import { floorToTen } from '../../../../lib/currency';
import type { PilotageData } from '../../../../hooks/usePilotageData';

/* ── Données d'exemple (réalistes, sans lien avec le compte connecté) ── */

const SAMPLE_RELYKA = 420;

// PilotageData minimal pour le moteur de recommandations (profil « healthy », 4 recos).
const SAMPLE_DATA = {
  safe_to_spend: SAMPLE_RELYKA,
  safety_margin_amount: 0,
  total_checking: 4000,
  projection_in_danger: false,
  current_savings: 3200,
  avg_monthly_income: 2500,
  variable_trend_percentage: 100,
  committed_allocations: 0,
  remaining_fixed_expenses: 0,
  current_checking_balance: 4000,
  total_savings: 3200,
  total_invested: 1500,
  safety_threshold_min: 1000,
  safety_threshold_optimal: 3000,
  safety_threshold_comfort: 10000,
} as unknown as PilotageData;

function ymAdd(n: number): string {
  const d = new Date();
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdminBannersPreview() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  // Réglages de fiabilité RÉELS (admin) → l'aperçu reflète la config en production.
  const { data: relCfg } = useReliabilityConfig();
  const cfg = relCfg ?? RELIABILITY_DEFAULTS;

  /* ── 1. Variantes du bandeau « prochain geste » ── */
  const base: AppStateInputs = {
    hasBalance: true, hasIncome: true, hasFixed: true,
    pendingClosureMonth: null, sharedModePrompt: null,
    confidenceLow: false, daysSinceVerification: 0, jointLow: null,
    relykaText: '220 €', closureEnabled: true, mainCheckingId: null,
  };
  const actionVariants: { label: string; inputs: AppStateInputs }[] = [
    { label: 'Réglage manquant — solde', inputs: { ...base, hasBalance: false } },
    { label: 'Réglage manquant — revenu', inputs: { ...base, hasIncome: false } },
    { label: 'Réglage manquant — charges fixes', inputs: { ...base, hasFixed: false } },
    { label: 'Compte partagé à qualifier', inputs: { ...base, sharedModePrompt: { accountId: 'demo', name: 'Compte commun' } } },
    { label: 'Clôture en attente', inputs: { ...base, pendingClosureMonth: ymAdd(-1) } },
    { label: 'Confiance basse (16 j sans vérif)', inputs: { ...base, confidenceLow: true, daysSinceVerification: 16 } },
    { label: 'Compte commun bientôt à découvert', inputs: { ...base, jointLow: { accountId: 'demo', name: 'Compte commun' } } },
    { label: 'Tout est à jour (état positif, ~5 s)', inputs: base },
  ];

  /* ── 3. Carte Relyka aux 3 niveaux de confiance (mêmes moteurs qu'en production) ── */
  const todayIso = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const calibCalm: DriftCalibration = { medianAbsGap: 2, medianDaysBetween: 30, sampleCount: 6 };
  const calibDrifty: DriftCalibration = { medianAbsGap: 300, medianDaysBetween: 20, sampleCount: 4 };
  const confStates: { key: string; label: string; desc: string; inputs: any }[] = [
    {
      key: 'high', label: 'Confiance HAUTE', desc: 'Vérif récente, dérive faible → chiffres nets, badge « À jour ».',
      inputs: { lastVerifiedAt: todayIso, lastActivityAt: null, calibration: calibCalm, floorBase: 2500 },
    },
    {
      key: 'medium', label: 'Confiance MOYENNE', desc: 'Vérif il y a ~10 j, dérive 15 €/j → fourchettes, badge « Vérifié il y a… », textes « au moins » (minimum sûr).',
      inputs: { lastVerifiedAt: daysAgo(10), lastActivityAt: null, calibration: calibDrifty, floorBase: 2500 },
    },
    {
      key: 'low', label: 'Confiance BASSE', desc: 'Jamais vérifié (cold start) → bandeau ambre + « Vérifier mon solde d\'abord », actions dégrisées.',
      inputs: { lastVerifiedAt: null, lastActivityAt: null, calibration: null, floorBase: 2500 },
    },
  ];

  const buildRecoProps = (conf: RelykaConfidence, projectionGuard?: { balances: number[]; margin: number }) => {
    const recos: SmartRecommendation[] = computeRecommendations(SAMPLE_DATA, {
      budget: SAMPLE_RELYKA,
      projectionGuard: projectionGuard ?? { balances: [3800, 3400, 3100, 2900, 2700, 2600], margin: 1000 },
      maxAmount: Math.max(0, floorToTen(SAMPLE_RELYKA)),
      actionAmountFor: (amount) => {
        const r = conf.proportional(amount);
        return r.isRange ? { value: Math.max(0, floorToTen(r.low)), isRange: true } : { value: amount, isRange: false };
      },
    });
    return recos;
  };

  const noop = () => {};

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.back} onPress={goBack}><Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backTxt}>Retour</Text></TouchableOpacity>
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.h1}>Aperçu bandeaux & confiance</Text>
          <Text style={styles.p}>
            Rendu de PRODUCTION avec des états forcés et des données d'exemple — rien n'est écrit
            (Ignorer/Réserver sans effet). Le flux complet de clôture (modale, régularisations,
            bilan) crée de vraies transactions : à tester sur un compte de test.
          </Text>

          <Text style={styles.section}>Bandeau « prochain geste » (Pilotage)</Text>
          {actionVariants.map((v) => (
            <View key={v.label} style={styles.item}>
              <Text style={styles.itemLabel}>{v.label}</Text>
              <ActionBannerCard action={getCurrentAction(v.inputs)} onDismiss={noop} />
            </View>
          ))}

          <Text style={styles.section}>Bannière de clôture mensuelle (Pilotage)</Text>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>1 mois en attente</Text>
            <ClosureBannerCard pendingMonths={[ymAdd(-1)]} />
          </View>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>Plusieurs mois en attente</Text>
            <ClosureBannerCard pendingMonths={[ymAdd(-3), ymAdd(-2), ymAdd(-1)]} />
          </View>

          <Text style={styles.section}>Carte « Ton Relyka » + recommandations</Text>
          <Text style={styles.p}>
            Relyka d'exemple : {SAMPLE_RELYKA} € · base 2 500 € · réglages de fiabilité actuels.
            Navigue dans le carrousel pour voir les textes de chaque reco (descriptions « au
            moins », tips, conseil virement récurrent).
          </Text>
          {confStates.map((s) => {
            const conf = deriveRelykaConfidence({ confidence_inputs: s.inputs }, SAMPLE_RELYKA, cfg);
            const recos = buildRecoProps(conf);
            return (
              <View key={s.key} style={styles.item}>
                <Text style={styles.itemLabel}>{s.label}</Text>
                <Text style={styles.itemDesc}>{s.desc}</Text>
                <RecommendationCard
                  previewMode
                  hideTitle
                  showRelykaSlide
                  recommendations={recos}
                  relykaAmount={floorToTen(SAMPLE_RELYKA)}
                  relykaColor={COLORS.emerald}
                  relykaMessage={conf.relykaRange.isRange
                    ? 'Voici ce qu\'il devrait te rester à la fin du mois. Tu peux suivre les recommandations — vérifie ton solde pour affiner l\'estimation.'
                    : 'Voici ce qu\'il devrait te rester à la fin du mois. Utilise ton Relyka librement, idéalement en suivant les recommandations.'}
                  relykaRange={conf.relykaRange}
                  recoRange={conf.proportional}
                  confidenceLevel={conf.result.level}
                  daysSinceVerification={conf.result.daysSinceVerification}
                  onVerify={noop}
                  financials={{ totalInvested: 1500, currentChecking: 4000, projectedEndChecking: 4180 }}
                  tierLabel="" tierColor={COLORS.emerald}
                  hasSavingsAccount hasInvestmentAccount
                  onEpargner={noop} onInvestir={noop} onCumuler={noop} onReserver={noop}
                />
              </View>
            );
          })}
          {/* Garde-fou projection : trajectoire sous la marge → tout « Conserver » + note orange. */}
          {(() => {
            const conf = deriveRelykaConfidence(
              { confidence_inputs: { lastVerifiedAt: todayIso, lastActivityAt: null, calibration: calibCalm, floorBase: 2500 } },
              SAMPLE_RELYKA, cfg,
            );
            const recos = buildRecoProps(conf, { balances: [1500, 1300, 1100, 950, 900, 850], margin: 1200 });
            return (
              <View style={styles.item}>
                <Text style={styles.itemLabel}>Garde-fou projection (solde projeté sous la marge)</Text>
                <Text style={styles.itemDesc}>Une seule reco « Conserver » + encadré orange d'explication.</Text>
                <RecommendationCard
                  previewMode hideTitle showRelykaSlide
                  recommendations={recos}
                  relykaAmount={floorToTen(SAMPLE_RELYKA)}
                  relykaColor={COLORS.emerald}
                  relykaRange={conf.relykaRange}
                  recoRange={conf.proportional}
                  confidenceLevel={conf.result.level}
                  daysSinceVerification={conf.result.daysSinceVerification}
                  financials={{ totalInvested: 1500, currentChecking: 4000, projectedEndChecking: 4180 }}
                  tierLabel="" tierColor={COLORS.emerald}
                  hasSavingsAccount hasInvestmentAccount
                  onEpargner={noop} onInvestir={noop} onCumuler={noop} onReserver={noop}
                />
              </View>
            );
          })()}

          <Text style={styles.section}>Formulations d'ancienneté (jamais de compteur précis)</Text>
          <View style={styles.phraseCard}>
            {[2, 8, 20, 60].map((d) => (
              <View key={d} style={styles.phraseRow}>
                <Text style={styles.phraseDays}>{d} j</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.phraseTxt}>Solde non vérifié <Text style={styles.phraseStrong}>{unverifiedSincePhrase(d)}</Text></Text>
                  <Text style={styles.phraseTxt}>Vérifié <Text style={styles.phraseStrong}>{verifiedAgoPhrase(d)}</Text></Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backTxt: { fontSize: 14, fontWeight: '600', color: c.text },
    h1: { fontSize: 22, fontWeight: '800', color: c.text, marginTop: 4 },
    p: { fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
    section: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 26, marginBottom: 10 },
    item: { marginBottom: 16 },
    itemLabel: { fontSize: 12.5, fontWeight: '800', color: c.emerald, marginBottom: 6 },
    itemDesc: { fontSize: 11.5, color: c.textSecondary, marginBottom: 6, lineHeight: 16 },
    phraseCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, gap: 10 },
    phraseRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    phraseDays: { width: 40, fontSize: 13, fontWeight: '800', color: c.text },
    phraseTxt: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
    phraseStrong: { color: c.text, fontWeight: '700' },
  });
}
