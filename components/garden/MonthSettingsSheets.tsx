/**
 * Réglages du mois, en feuilles du Jardin — les MÊMES écritures que le Pilotage :
 *   - MarginSheet : le minimum à garder (profiles.safety_margin_amount) ;
 *   - EstimateSheet : l'estimation des dépenses du quotidien (profiles.weekly_variable_budget) ;
 *   - LeftToSpendSheet : le reste à dépenser, son addition et le choix de la base des dépenses du
 *     quotidien (Auto / Estimation / Calculé → profiles.variable_envelope_mode), avec l'annonce du
 *     nouveau Relyka une fois recalculé.
 *
 * Tout passe par useUpdateProfile (mise à jour optimiste du cache) : Ce mois et Mon parcours lisent
 * la même donnée, ils changent donc ensemble, sans rechargement.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GardenSheet from './GardenSheet';
import GardenText from './GardenText';
import GardenButton from './GardenButton';
import GardenCard from './GardenCard';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/data/useProfile';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';
import { sanitizeAmountInput } from '../../lib/ui/amountInput';
import { WEEKS_PER_MONTH } from '../../lib/finance/financialProfileEngine';
import { computeRelykaBreakdown } from '../../lib/finance/pilotageView';
import { formatEuros } from '../../lib/garden/picoChoices';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { WORDS } from '../../lib/garden/lexicon';
import { pointer } from '../../lib/ui/webLayout';

const eur = (n: number) => formatEuros(n, CURRENCY_SYMBOL);
const parse = (s: string) => Math.max(0, parseFloat(String(s).replace(',', '.')) || 0);

/** Champ de montant du Jardin. */
function AmountField({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm }}>
      <TextInput value={value} onChangeText={(v) => onChange(sanitizeAmountInput(v))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={G.muted}
        accessibilityLabel="Montant" autoFocus
        style={{ flex: 1, minHeight: 56, borderRadius: GARDEN_RADII.md, borderWidth: 1, borderColor: G.line, backgroundColor: G.card, paddingHorizontal: 16, fontSize: 22, color: G.ink }} />
      <GardenText variant="bodyStrong">{unit}</GardenText>
    </View>
  );
}

/** Refus d'écrire en « connecté en tant que » — même règle que le Pilotage. */
function useWriteGuard() {
  const { isImpersonating } = useAuth();
  return () => {
    if (!isImpersonating) return false;
    Alert.alert('Consultation seule', "Tu es connecté en tant qu'un autre utilisateur : rien n'est modifié sur son compte.");
    return true;
  };
}

/* ── Minimum à garder ─────────────────────────────────────────────────────────────────────────── */

export function MarginSheet({ visible, onClose, userId }: { visible: boolean; onClose: () => void; userId: string | undefined }) {
  const { data: profile } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const blocked = useWriteGuard();
  const current = (profile as any)?.safety_margin_amount;
  const [draft, setDraft] = useState('');
  useEffect(() => { if (visible) setDraft(current != null && Number(current) > 0 ? String(current) : ''); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (blocked()) { onClose(); return; }
    /* Fermeture immédiate : la mise à jour est optimiste (le cache change avant le réseau), et un
       échec est signalé par le filet global des écritures. */
    update.mutate({ safety_margin_amount: Math.round(parse(draft)) }, {
      onError: (e: any) => Alert.alert('Un souci', e?.message ?? 'Ta marge de sécurité n’a pas pu être enregistrée.'),
    });
    onClose();
  };

  return (
    <GardenSheet visible={visible} onClose={onClose} title={WORDS.minimumToKeep} subtitle="l'eau que tu gardes toujours dans ton arrosoir"
      footer={<GardenButton label="Enregistrer" onPress={save} />}>
      <AmountField value={draft} onChange={setDraft} unit={CURRENCY_SYMBOL} />
      <GardenText variant="body" color={G.inkSoft}>
        Le montant que tu veux avoir au minimum sur tes comptes courants à la fin du mois. Relyka ne le déplace nulle part : il te dit simplement ce que tu peux utiliser avant d’y toucher.
      </GardenText>
    </GardenSheet>
  );
}

/* ── Estimation des dépenses du quotidien ─────────────────────────────────────────────────────── */

export function EstimateSheet({ visible, onClose, userId }: { visible: boolean; onClose: () => void; userId: string | undefined }) {
  const { data: profile } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const blocked = useWriteGuard();
  const lock = useSubmitLock();
  const current = (profile as any)?.weekly_variable_budget;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) setDraft(current ? String(current) : ''); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (blocked()) { onClose(); return; }
    if (!lock.acquire()) return;
    setSaving(true);
    try {
      const weekly = parse(draft);
      await update.mutateAsync({ weekly_variable_budget: weekly > 0 ? weekly : null });
      onClose();
    } catch (e: any) {
      Alert.alert('Un souci', e?.message ?? 'Ton estimation n’a pas pu être enregistrée.');
    } finally {
      lock.release();
      setSaving(false);
    }
  };

  const monthly = Math.round(parse(draft) * WEEKS_PER_MONTH);
  return (
    <GardenSheet visible={visible} onClose={onClose} title="Dépenses du quotidien" subtitle="ton estimation par semaine"
      footer={<GardenButton label="Enregistrer" onPress={save} loading={saving} />}>
      <AmountField value={draft} onChange={setDraft} unit={`${CURRENCY_SYMBOL} / sem.`} />
      {draft ? <GardenText variant="bodyStrong" color={G.waterText}>≈ {eur(monthly)} par mois</GardenText> : null}
      <GardenText variant="body" color={G.inkSoft}>Courses, loisirs, petites dépenses. Une estimation suffit : Relyka l’ajuste à ton réel au fil des mois.</GardenText>
    </GardenSheet>
  );
}

/* ── Reste à dépenser ─────────────────────────────────────────────────────────────────────────── */

type VarMode = 'auto' | 'estimate' | 'real';

interface LeftProps {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
  /** Données du Pilotage (même cœur que la page) et ce qu'il faut pour recalculer le Relyka. */
  pilotageData: any;
  pilotageQuery: { refetch: () => Promise<{ data?: any }> };
  recurringLeft: number;
  recurringCount: number;
  relykaBefore: number;
  breakdownExtras: { reservationsTotal: number; preEpargneTotal: number; preInvestTotal: number };
  onShowRecurring: () => void;
  onEditEstimate: () => void;
}

export function LeftToSpendSheet({ visible, onClose, userId, pilotageData: p, pilotageQuery, recurringLeft, recurringCount, relykaBefore, breakdownExtras, onShowRecurring, onEditEstimate }: LeftProps) {
  const update = useUpdateProfile(userId);
  const blocked = useWriteGuard();
  const lock = useSubmitLock();
  const saved: VarMode = p?.variable_envelope_mode ?? 'auto';
  const [mode, setMode] = useState<VarMode>(saved);
  const [saving, setSaving] = useState(false);
  const [shift, setShift] = useState<null | { before: number; after: number }>(null);
  useEffect(() => { if (visible) { setMode(saved); setShift(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;

  const varLeft = Math.max(0, p.variable_envelope_remaining ?? 0);
  const varPlanned = Math.max(0, p.variable_envelope_planned ?? 0);
  const varTotal = varLeft + varPlanned;
  const total = varTotal + Math.max(0, recurringLeft);
  const dirty = mode !== saved;

  const options: [VarMode, string, number, boolean][] = [
    ['auto', 'Auto', p.variable_real_available ? p.variable_real_value : p.variable_estimate_value, false],
    ['estimate', 'Ton estimation', p.variable_estimate_value, false],
    ['real', 'Calculé sur ton historique', p.variable_real_value, !p.variable_real_available],
  ];
  const note = mode === 'auto'
    ? (p.variable_real_available
        ? `Relyka utilise la moyenne de tes ${p.variable_real_months} derniers mois (hors mois non clôturés), puisque tu as assez d'historique.`
        : 'Tant que tu n’as pas 2 mois complets, Relyka s’en tient à ton estimation. Il passera au calculé tout seul ensuite.')
    : mode === 'real'
      ? `La moyenne de tes ${p.variable_real_months} derniers mois de dépenses du quotidien (les mois non clôturés sont exclus).`
      : 'Le montant que tu as déclaré toi-même, ramené au mois.';

  /** Même enregistrement que le Pilotage : le mode, puis le Relyka RECALCULÉ annoncé. */
  const save = async () => {
    if (!dirty) { onClose(); return; }
    if (blocked()) { setMode(saved); return; }
    if (!lock.acquire()) return;
    setSaving(true);
    try {
      await update.mutateAsync({ variable_envelope_mode: mode });
      const fresh = await pilotageQuery.refetch();
      if (fresh.data) setShift({ before: relykaBefore, after: computeRelykaBreakdown(fresh.data, breakdownExtras).relykaAffiche });
      else onClose();
    } catch (e: any) {
      Alert.alert('Un souci', e?.message ?? "Ton choix n'a pas pu être enregistré.");
    } finally {
      lock.release();
      setSaving(false);
    }
  };

  if (shift) {
    const up = shift.after >= shift.before;
    return (
      <GardenSheet visible={visible} onClose={onClose} title="C'est enregistré" footer={<GardenButton label="Compris" onPress={onClose} />}>
        <GardenCard tint={up ? G.branchesBg : G.waterBg}>
          <GardenText variant="label" color={up ? G.branchesText : G.waterText}>Ton Relyka</GardenText>
          <GardenText variant="title" tabular>{eur(shift.before)} → {eur(shift.after)}</GardenText>
        </GardenCard>
        <GardenText variant="body" color={G.inkSoft}>{up ? 'Avec cette base, il te reste un peu plus à décider ce mois-ci.' : 'Avec cette base, Pépin garde un peu plus de côté pour ton quotidien.'}</GardenText>
      </GardenSheet>
    );
  }

  return (
    <GardenSheet visible={visible} onClose={onClose} title={WORDS.leftToSpend} subtitle="une prévision de ce qui va sortir d'ici la fin du mois"
      footer={<GardenButton label={dirty ? 'Enregistrer' : 'Fermer'} onPress={save} loading={saving} variant={dirty ? 'primary' : 'secondary'} />}>
      {/* L'addition d'abord : le total et ses deux termes ensemble. */}
      <GardenCard tint={G.waterBg}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <GardenText variant="label" color={G.waterText}>Total prévu</GardenText>
          <GardenText variant="title" tabular color={G.waterText}>{eur(total)}</GardenText>
        </View>
        <Pressable onPress={onShowRecurring} accessibilityRole="button" style={pointer}>
          <Line label={WORDS.recurringLeft} value={recurringLeft} hint={`${recurringCount} d'ici la fin du mois, ils sortiront vraiment · voir`} />
        </Pressable>
        <Line label={WORDS.dailyForecast} value={varTotal} hint={`ce que tu dépenses d'habitude, pas une obligation${varPlanned > 0 ? ` · dont ${eur(varPlanned)} déjà saisies` : ''}`} />
      </GardenCard>

      <GardenText variant="label">Sur quoi se base la prévision du quotidien</GardenText>
      <View style={{ gap: GARDEN_SPACE.sm }}>
        {options.map(([key, label, value, unavailable]) => {
          const on = mode === key;
          return (
            <Pressable key={key} disabled={unavailable} onPress={() => setMode(key)} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: unavailable }}
              style={[{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md, minHeight: 56, paddingHorizontal: 14, borderRadius: GARDEN_RADII.md, borderWidth: 2, borderColor: on ? G.primary : G.line, backgroundColor: on ? G.branchesBg : G.card, opacity: unavailable ? 0.5 : 1 }, pointer]}>
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? G.primary : G.muted} />
              <GardenText variant="bodyStrong" style={{ flex: 1 }}>{label}</GardenText>
              <GardenText variant="smallStrong" color={G.inkSoft} tabular>{unavailable ? '2 mois requis' : value > 0 ? `${eur(value)} / mois` : '—'}</GardenText>
            </Pressable>
          );
        })}
      </View>
      <GardenText variant="small" color={G.inkSoft}>{note}</GardenText>
      <GardenButton label="Modifier mon estimation" variant="secondary" onPress={onEditEstimate} />
    </GardenSheet>
  );
}

function Line({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.sm }}>
      <GardenText variant="bodyStrong" color={G.waterText}>+</GardenText>
      <View style={{ flex: 1 }}>
        <GardenText variant="body">{label}</GardenText>
        {hint ? <GardenText variant="small" color={G.muted}>{hint}</GardenText> : null}
      </View>
      <GardenText variant="bodyStrong" tabular>{eur(value)}</GardenText>
    </View>
  );
}
