/**
 * Admin › Gamification › Jardin — les seuils d'apparition de chaque élément du jardin
 * (lib/garden/gardenRules). Les valeurs saisies sont gardées telles quelles le temps de la frappe ;
 * l'aperçu et l'enregistrement passent par `mergeGardenRules`, qui refuse les valeurs invalides
 * (liste non croissante, hors bornes) au profit des valeurs par défaut — le jardin ne casse jamais.
 */
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import GardenText from '../garden/GardenText';
import GardenButton from '../garden/GardenButton';
import GardenScene from '../garden/GardenScene';
import GardenSegmented from '../garden/GardenSegmented';
import { CLASSED_PROFILES, DEFAULT_GARDEN_RULES, mergeGardenRules, type GardenRules } from '../../lib/garden/gardenRules';
import { computeTreeState, type GardenInputs } from '../../lib/garden/treeState';
import { PROFILE_INFO } from '../../lib/finance/financialProfileEngine';
import { treeSize } from '../../lib/garden/scene3dLayout';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { GARDEN_FONTS as GF } from '../../lib/garden/fontFamilies';

type Draft = Record<string, string>;

/* Clés à plat : « growth.P4 », « rootsMarks.1 »… → une saisie par case. */
const flatten = (r: GardenRules): Draft => {
  const d: Draft = {};
  for (const [k, v] of Object.entries(r)) {
    if (Array.isArray(v)) v.forEach((x, i) => { d[`${k}.${i}`] = String(x); });
    else if (typeof v === 'object') for (const [p, x] of Object.entries(v as Record<string, number>)) d[`${k}.${p}`] = String(x);
    else d[k] = String(v);
  }
  return d;
};
const unflatten = (d: Draft): Record<string, unknown> => {
  const out: Record<string, any> = {};
  for (const [key, raw] of Object.entries(d)) {
    const [k, sub] = key.split('.');
    const v = parseFloat(raw.replace(',', '.'));
    if (sub == null) out[k] = v;
    else if (/^\d+$/.test(sub)) { out[k] = out[k] ?? []; out[k][Number(sub)] = v; }
    else { out[k] = out[k] ?? {}; out[k][sub] = v; }
  }
  return out;
};

function NumBox({ value, onChange, label, suffix, width = 76 }: { value: string; onChange: (v: string) => void; label?: string; suffix?: string; width?: number }) {
  return (
    <View style={{ gap: 3, alignItems: 'flex-start' }}>
      {label ? <GardenText variant="small" color={G.muted}>{label}</GardenText> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TextInput value={value} onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" accessibilityLabel={label}
          style={{ width, minHeight: 40, borderRadius: GARDEN_RADII.sm, borderWidth: 1, borderColor: G.line, backgroundColor: G.card, paddingHorizontal: 10, fontFamily: GF.bodyBold, fontSize: 15, color: G.ink, textAlign: 'right' }} />
        {suffix ? <GardenText variant="small" color={G.muted}>{suffix}</GardenText> : null}
      </View>
    </View>
  );
}

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: GARDEN_SPACE.sm, backgroundColor: G.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.lg }}>
      <GardenText variant="heading">{title}</GardenText>
      <GardenText variant="small" color={G.inkSoft}>{hint}</GardenText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GARDEN_SPACE.md }}>{children}</View>
    </View>
  );
}

/** Situation d'exemple pour l'aperçu (le jardin d'un utilisateur à l'étape choisie). */
const SAMPLE: GardenInputs = {
  currentBalance: 1800, minimumToKeep: 200, relyka: 600, monthlyReference: 2000, securityMonths: 4,
  investedValue: 30000, investedContributed: 22000, investmentCount: 2, enjoyThisMonth: 200,
  recurringInvestMonthly: 0, streakWeeks: 6,
  credits: [{ id: 'immo', kind: 'healthy', remaining: 60000, borrowed: 150000 }, { id: 'conso', kind: 'expensive', remaining: 1500 }],
};

export default function GardenRulesEditor({ value, onChange }: { value: Partial<GardenRules> | undefined; onChange: (rules: GardenRules) => void }) {
  const [draft, setDraft] = useState<Draft>(() => flatten(mergeGardenRules(value)));
  const [preview, setPreview] = useState<'P2' | 'P4' | 'P6' | 'P9'>('P4');
  const rules = useMemo(() => mergeGardenRules(unflatten(draft)), [draft]);
  const set = (key: string) => (v: string) => {
    const next = { ...draft, [key]: v };
    setDraft(next);
    onChange(mergeGardenRules(unflatten(next)));
  };
  const box = (key: string, label?: string, suffix?: string) => <NumBox key={key} value={draft[key] ?? ''} onChange={set(key)} label={label} suffix={suffix} />;
  const reset = () => { const d = flatten(DEFAULT_GARDEN_RULES); setDraft(d); onChange(DEFAULT_GARDEN_RULES); };
  const tree = computeTreeState({ ...SAMPLE, profileId: preview }, rules);

  return (
    <View style={{ gap: GARDEN_SPACE.md }}>
      <GardenText variant="small" color={G.inkSoft}>« Mois » = mois de dépenses essentielles de l'utilisateur, l'unité de tout le jardin (comme le matelas de sécurité et les profils). Une valeur invalide (liste qui ne monte pas, hors bornes) est ignorée au profit de la valeur par défaut.</GardenText>

      <View style={{ gap: GARDEN_SPACE.sm, backgroundColor: G.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, padding: GARDEN_SPACE.md }}>
        <GardenText variant="label">Aperçu · étape du profil</GardenText>
        <GardenSegmented<'P2' | 'P4' | 'P6' | 'P9'> accessibilityLabel="Étape de l'aperçu" value={preview} onChange={setPreview}
          items={[{ key: 'P2', label: 'P2' }, { key: 'P4', label: 'P4' }, { key: 'P6', label: 'P6' }, { key: 'P9', label: 'P9' }]} />
        <View style={{ maxWidth: 360, width: '100%', alignSelf: 'center' }}>
          <GardenScene state={tree} options={{ id: 'admin-rules', marks: true, label: 'Aperçu du jardin' }} />
        </View>
        <GardenText variant="small" color={G.muted} center>Exemple : 4 mois d'épargne, 15 mois de dépenses placés en gain, un crédit immobilier remboursé à 60 %, un petit crédit cher.</GardenText>
      </View>

      <Block title="Taille de l'arbre" hint="Selon l'étape du profil financier (0 = pousse, 1 = grand arbre). L'arbre a 7 tailles : sous 0,22 · 0,27 · 0,40 · 0,55 · 0,70 · 0,85 · au-delà. Sans étape connue (P0), la taille se calcule : épargne et placements ci-dessous.">
        {CLASSED_PROFILES.map((p) => box(`growthByProfile.${p}`, `${p} · ${PROFILE_INFO[p].name} (taille ${treeSize(rules.growthByProfile[p])})`))}
        {box('growthSavingsMonths', 'P0 : épargne pour la moitié de l’arbre', 'mois')}
        {box('branchesFullMonths', 'P0 : placements pour l’arbre entier', 'mois')}
      </Block>

      <Block title="Racines" hint="Les trois traits de l'épargne de secours (croissants). Au-delà du dernier, la nappe apparaît.">
        {box('rootsMarks.0', '1ᵉʳ trait', 'mois')}{box('rootsMarks.1', '2ᵉ trait', 'mois')}{box('rootsMarks.2', '3ᵉ trait', 'mois')}
      </Block>

      <Block title="Fruits" hint="Valeur placée à partir de laquelle on a 1, 2, 3, 4 puis 6 fruits (croissant, le premier vaut 0 : dès 1 € placé). Panier de récolte au pied de l'arbre. Fruits et panier dorés selon la plus-value.">
        {box('fruitSteps.1', '2 fruits dès', 'mois')}{box('fruitSteps.2', '3 fruits dès', 'mois')}{box('fruitSteps.3', '4 fruits dès', 'mois')}{box('fruitSteps.4', '6 fruits dès', 'mois')}
        {box('harvestSmallMonths', 'Petit panier dès', 'mois')}{box('harvestBigMonths', 'Grand panier dès', 'mois')}
        {box('goldenGainMonths', 'Dorés : plus-value ≥', 'mois')}{box('goldenDoubledMinMonths', 'ou doublés avec plus-value ≥', 'mois')}
      </Block>

      <Block title="Fleurs" hint="Part du mois « pour te faire plaisir » qui donne les 5 fleurs (une fleur par cinquième).">
        {box('flowersFullPct', '5 fleurs à', '% du mois')}
      </Block>

      <Block title="Cabane (crédit sain)" hint="Avancement du remboursement où commence chaque étape : 1 l'échelle seule (dès l'ouverture), 2 plancher et garde-corps, 3 ossature, 4 toit, 5 cabane habitée (fenêtre allumée). Crédit soldé : cabane à toi, fanion sur le toit.">
        {box('cabinSteps.0', 'Étape 2 dès', '%')}{box('cabinSteps.1', 'Étape 3 dès', '%')}{box('cabinSteps.2', 'Étape 4 dès', '%')}{box('cabinSteps.3', 'Étape 5 dès', '%')}
      </Block>

      <Block title="Ronces (crédit cher)" hint="Crédit renouvelable ou découvert : densité minimale dès 1 €, et densité maximale à partir d'un restant dû de N mois.">
        {box('bramblesMinPct', 'Densité minimale', '%')}{box('bramblesFullMonths', 'Au plus dense dès', 'mois')}
      </Block>

      <GardenButton label="Revenir aux valeurs par défaut" variant="secondary" onPress={reset} />
    </View>
  );
}
