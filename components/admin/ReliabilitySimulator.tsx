/**
 * Simulateur de FIABILITÉ — administration.
 *
 * Rejoue une situation complète (Relyka, base, enveloppe, ancienneté de vérification, dérive
 * constatée, façon de saisir) et montre ce que l'utilisateur verrait : niveau de confiance, doute
 * retenu, fourchette, et le rendu RÉEL de la carte « Ton Relyka » avec ses recommandations.
 *
 * ⚠️ Il appelle les MOTEURS DE PRODUCTION (`deriveRelykaConfidence`, `computeRecommendations`) avec
 * les réglages de fiabilité en vigueur — jamais une copie de leur logique. Toute évolution du calcul
 * se voit donc ici sans rien à retoucher, ce qui est précisément le but : un simulateur qui
 * réimplémenterait le calcul finirait par décrire une app qui n'existe plus.
 *
 * La saisie de transactions est simulée par des PROFILS (cf. lib/finance/observationProfiles) :
 * trois réglages remplacent les dizaines d'écritures qu'il faudrait sinon créer pour reproduire
 * « a tout noté sauf la dernière semaine ».
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useReliabilityConfig, deriveRelykaConfidence } from '../../hooks/pilotage/useReliability';
import {
  buildObservationSignals, SIMULATION_SCENARIOS,
  type ObservationProfile, type SpendPattern,
} from '../../lib/finance/observationProfiles';
import { computeRecommendations, type SmartRecommendation } from '../../lib/finance/recommendationEngine';
import { floorToTen } from '../../lib/finance/currency';
import { sanitizeAmountInput } from '../../lib/ui/amountInput';
import RelykaPreview from './RelykaPreview';
import ConfidenceSummary from './ConfidenceSummary';
import type { PilotageData } from '../../hooks/pilotage/usePilotageData';

const PATTERNS: { key: SpendPattern; label: string }[] = [
  { key: 'even', label: 'Un peu chaque jour' },
  { key: 'batched', label: 'Par lots (tous les 3 j)' },
  { key: 'early_then_silence', label: 'Au début, puis silence' },
  { key: 'recent_only', label: 'Rattrapage récent' },
  { key: 'single_day', label: 'Un seul jour' },
];

const num = (s: string, fallback = 0) => {
  const v = parseFloat((s || '').replace(',', '.'));
  return Number.isFinite(v) ? v : fallback;
};

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function ReliabilitySimulator() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: cfg } = useReliabilityConfig();

  // ── Situation simulée ──────────────────────────────────────────────────────
  const [relyka, setRelyka] = useState('1010');
  const [income, setIncome] = useState('2500');     // revenu moyen → base du ratio
  const [envelope, setEnvelope] = useState('600');  // enveloppe variable mensuelle
  const [checking, setChecking] = useState('3000'); // solde courant (contexte des recos)
  const [daysSince, setDaysSince] = useState('21');
  const [neverVerified, setNeverVerified] = useState(false);
  const [calibrated, setCalibrated] = useState(true);
  const [gap, setGap] = useState('400');            // écart médian constaté aux vérifs
  const [between, setBetween] = useState('20');     // jours entre deux vérifs

  /* Les deux pourcentages sont tenus en TEXTE, pas en nombre. Dérivés d'un nombre, ils se
     repeuplaient de « 0 » dès qu'on effaçait le champ pour retaper — impossible de saisir « 45 »
     sans lutter contre son propre écran. */
  const [scenarioKey, setScenarioKey] = useState('daily');
  const [honoredTxt, setHonoredTxt] = useState('110');
  const [entryTxt, setEntryTxt] = useState('100');
  const [pattern, setPattern] = useState<SpendPattern>('even');
  const profile: ObservationProfile = {
    honoredPct: num(honoredTxt, 0),
    entryDaysPct: num(entryTxt, 0),
    pattern,
  };
  /* Un scénario charge la SITUATION ENTIÈRE, pas seulement la façon de saisir : « jamais vérifié »
     et « suit tout depuis trois semaines » ne se distinguent pas par leurs seules dépenses. Régler
     les deux moitiés à la main à chaque essai revenait à tester des cas qui n'existent pas. */
  const applyScenario = (key: string) => {
    const s = SIMULATION_SCENARIOS.find((x) => x.key === key);
    if (!s) return;
    setScenarioKey(key);
    setHonoredTxt(String(s.profile.honoredPct));
    setEntryTxt(String(s.profile.entryDaysPct));
    setPattern(s.profile.pattern);
    setNeverVerified(!!s.neverVerified);
    setDaysSince(String(s.daysSinceVerification));
    setCalibrated(s.calibrated !== false);
  };
  // Toute retouche manuelle sort du scénario : afficher encore « Suit tout » serait faux.
  const touched = () => setScenarioKey('custom');

  // ── Calcul : moteurs de production, réglages en vigueur ────────────────────
  const sim = useMemo(() => {
    if (!cfg) return null;
    const today = new Date();
    const days = Math.max(1, Math.round(num(daysSince, 21)));
    const relykaValue = Math.max(0, num(relyka, 0));
    const envelopeValue = Math.max(0, num(envelope, 0));

    /* Profondeur simulée : au moins le plafond d'ancienneté, sinon les tranches les plus anciennes
       de la période douteuse seraient muettes faute de données fabriquées — le doute resterait
       entier pour une raison qui n'a rien à voir avec le profil testé. */
    const depth = Math.max(days, Math.round(cfg.coldStartDays) + 2, 30);
    const signals = buildObservationSignals(today, depth, envelopeValue, profile);

    const lastVerifiedAt = neverVerified
      ? null
      : isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));

    const conf = deriveRelykaConfidence(
      {
        confidence_inputs: {
          lastVerifiedAt,
          ...signals,
          calibration: calibrated
            ? { medianAbsGap: Math.max(0, num(gap, 0)), medianDaysBetween: Math.max(1, num(between, 1)), sampleCount: 4 }
            : null,
          floorBase: Math.max(0, num(income, 0)),
          variableBase: envelopeValue,
        },
      } as any,
      relykaValue,
      cfg,
    );

    const checkingValue = Math.max(0, num(checking, 0));
    const data = {
      safe_to_spend: relykaValue,
      safety_margin_amount: 0,
      total_checking: checkingValue,
      projection_in_danger: false,
      current_savings: 3200,
      avg_monthly_income: Math.max(0, num(income, 0)),
      variable_trend_percentage: 100,
      committed_allocations: 0,
      remaining_fixed_expenses: 0,
      current_checking_balance: checkingValue,
      total_savings: 3200,
      total_invested: 1500,
      safety_threshold_min: 1000,
      safety_threshold_optimal: 3000,
      safety_threshold_comfort: 10000,
    } as unknown as PilotageData;

    const recos: SmartRecommendation[] = computeRecommendations(data, {
      budget: relykaValue,
      projectionGuard: { balances: [checkingValue, checkingValue, checkingValue, checkingValue, checkingValue, checkingValue], margin: 0 },
      maxAmount: Math.max(0, floorToTen(relykaValue)),
      // Même règle que le Pilotage : « Conserver » au montant plein, épargner/investir à la borne basse.
      actionAmountFor: (amount, type) => {
        if (type === 'keep') return { value: amount, isRange: false };
        const r = conf.actionable(amount);
        return r.isRange ? { value: Math.max(0, floorToTen(r.low)), isRange: true } : { value: amount, isRange: false };
      },
    });

    /* Chiffres du bloc « Ce mois-ci » cohérents avec le profil simulé : afficher un « dépensé » nul
       sous une carte qui vient d'effacer le doute grâce aux saisies serait la contradiction que
       cette page est censée débusquer. */
    const observedTotal = Object.values(signals.variableSpentByDay).reduce((s, v) => s + v, 0);
    const variableRemaining = Math.max(0, envelopeValue - observedTotal);

    return { conf, recos, relykaValue, checkingValue, signals, depth, observedTotal, variableRemaining };
    // `profile` est recalculé à chaque rendu (dérivé des champs texte) : on dépend de ses VALEURS,
    // sinon le mémo se réexécuterait à chaque frappe dans n'importe quel champ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, relyka, income, envelope, checking, daysSince, neverVerified, calibrated, gap, between,
      profile.honoredPct, profile.entryDaysPct, profile.pattern]);

  const field = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <View style={styles.field}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(v) => onChange(sanitizeAmountInput(v))}
        keyboardType="decimal-pad"
        placeholderTextColor={COLORS.textSecondary}
      />
    </View>
  );

  const toggle = (label: string, on: boolean, onPress: () => void, hint?: string) => (
    <TouchableOpacity style={styles.field} onPress={onPress} activeOpacity={0.8} accessibilityRole="switch">
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      <View style={[styles.switch, on && { backgroundColor: COLORS.emerald + '22', borderColor: COLORS.emerald }]}>
        <Ionicons
          name={on ? 'checkmark-circle' : 'ellipse-outline'}
          size={17}
          color={on ? COLORS.emerald : COLORS.textSecondary}
        />
        <Text style={[styles.switchTxt, on && { color: COLORS.emerald }]}>{on ? 'Oui' : 'Non'}</Text>
      </View>
    </TouchableOpacity>
  );

  const activeScenario = SIMULATION_SCENARIOS.find((s) => s.key === scenarioKey);

  return (
    <View>
      <Text style={styles.p}>
        Rejoue une situation complète dans les moteurs de production, avec les réglages en vigueur :
        rien n'est écrit, aucun compte n'est touché. Les transactions sont simulées par un profil de
        saisie — inutile d'en créer des dizaines pour reproduire un cas.
      </Text>

      <Text style={styles.section}>Scénarios</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
        {SIMULATION_SCENARIOS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.chip, scenarioKey === s.key && styles.chipOn]}
            onPress={() => applyScenario(s.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipTxt, scenarioKey === s.key && styles.chipTxtOn]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.fieldHint}>
        {activeScenario ? activeScenario.hint : 'réglage manuel — les champs ci-dessous font foi'}
      </Text>

      <Text style={styles.section}>1 · Situation</Text>
      {field('Relyka (€)', relyka, setRelyka, 'le montant affiché en grand sur le tableau de bord')}
      {field('Revenu mensuel moyen (€)', income, setIncome, 'sert de base au ratio de doute (avec le Relyka)')}
      {field('Enveloppe variable (€/mois)', envelope, setEnvelope, 'référence du taux d’honoration · 0 = jamais estimée')}
      {field('Solde courant (€)', checking, setChecking, 'contexte des recommandations')}

      <Text style={styles.section}>2 · Vérification du solde</Text>
      {toggle('Jamais vérifié', neverVerified, () => setNeverVerified((v) => !v),
        'ni régularisation, ni solde recopié à la création — les saisies ne peuvent alors rien effacer')}
      {!neverVerified && field('Dernière vérif il y a… (jours)', daysSince, setDaysSince,
        `au-delà de ${cfg?.coldStartDays ?? 21} j, le doute sature (plafond d’ancienneté)`)}

      <Text style={styles.section}>3 · Dérive constatée</Text>
      {toggle('Déjà calibré', calibrated, () => setCalibrated((v) => !v),
        'sinon : méfiance de départ (cold start), calculée sur l’enveloppe variable')}
      {calibrated && field('Écart médian aux vérifs (€)', gap, setGap, 'ce qu’il manquait, en moyenne, à chaque régularisation')}
      {calibrated && field('Jours entre deux vérifs', between, setBetween, 'dérive/jour = écart ÷ intervalle')}

      <Text style={styles.section}>4 · Façon de saisir</Text>
      {field('Enveloppe saisie (%)', honoredTxt, (v) => { touched(); setHonoredTxt(v); },
        '100 = pile ce que l’enveloppe prévoyait sur la période · au-delà, elle est dépassée')}
      {field('Jours avec une saisie (%)', entryTxt, (v) => { touched(); setEntryTxt(v); },
        'l’assiduité : amortit le doute et peut ouvrir droit au « À jour »')}
      <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Répartition dans le temps</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
        {PATTERNS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.chip, pattern === p.key && styles.chipOn]}
            onPress={() => { touched(); setPattern(p.key); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipTxt, pattern === p.key && styles.chipTxtOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.section}>Résultat</Text>
      {sim ? (
        <>
          <ConfidenceSummary conf={sim.conf} />
          <Text style={styles.fieldHint}>
            Simulé sur {sim.depth} jours · {Object.keys(sim.signals.variableSpentByDay).length} jour(s)
            avec dépense · {sim.signals.activityDays.length} jour(s) avec saisie.
          </Text>

          {/* Le VRAI tableau de bord (PilotageSimple), pas un aperçu qui lui ressemble. */}
          <RelykaPreview
            conf={sim.conf}
            recommendations={sim.recos}
            relyka={sim.relykaValue}
            checkingBalance={sim.checkingValue}
            spentThisMonth={sim.observedTotal}
            variableRemaining={sim.variableRemaining}
            safetyMargin={0}
          />
        </>
      ) : (
        <Text style={styles.p}>Chargement des réglages…</Text>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    p: { fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
    section: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 6 },
    field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
    fieldLabel: { fontSize: 14, fontWeight: '600', color: c.text },
    fieldHint: { fontSize: 11.5, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    input: { width: 96, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'right', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    switch: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: c.card },
    switchTxt: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    chipsRow: { marginTop: 8, marginBottom: 4 },
    chip: { borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipOn: { borderColor: c.emerald, backgroundColor: c.emerald + '1A' },
    chipTxt: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary },
    chipTxtOn: { color: c.emerald },
  });
}
