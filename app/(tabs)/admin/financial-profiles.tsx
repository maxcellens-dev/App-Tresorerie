import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import { useAuth } from '../../../contexts/AuthContext';
import {
  useProfileMatrixConfig,
  useProfileNotificationMessages,
  useUpdateNotificationMessage,
  useUpdateMatrixConfig,
  useFinancialProfile,
  useSimulateProfileChange,
  useProfileDistribution,
} from '../../../hooks/pilotage/useFinancialProfile';
import {
  PROFILE_INFO, FINANCIAL_PROFILE_IDS, PROFILE_TRANSITION_KEYS,
  computeProfileFromData, thresholdsFromMatrix,
} from '../../../lib/finance/financialProfileEngine';
import type { FinancialProfileId } from '../../../types/database';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useSavingsConfig, useSaveSavingsConfig, SAVINGS_DEFAULTS } from '../../../hooks/config/useSavingsConfig';


type Tab = 'simulate' | 'messages' | 'matrix' | 'global';

const TABS: { key: Tab; label: string }[] = [
  { key: 'simulate', label: 'Simulation' },
  { key: 'messages', label: 'Messages' },
  { key: 'matrix',   label: 'Matrice' },
  { key: 'global',   label: 'Paramètres' },
];

/* Listes DÉRIVÉES du référentiel (lib/financialProfileEngine) : écrites à la main, elles
   restaient à cinq paliers pendant que le reste de l'app en comptait dix — l'écran d'admin
   devenait le seul endroit à ignorer la moitié des profils. */
const ALL_PROFILES: FinancialProfileId[] = FINANCIAL_PROFILE_IDS;

/** Les trois passages gouvernés par le PATRIMOINE, et non par le seul matelas. */
const WEALTH_TRANSITIONS = new Set(['P6_P7', 'P7_P8', 'P8_P9']);

const TRANSITIONS = PROFILE_TRANSITION_KEYS.map((key) => {
  const [from, to] = key.split('_') as [FinancialProfileId, FinancialProfileId];
  return { key, label: `${from} → ${to}`, from, to };
});

// Clés = convention du modal (ProfileChangeModal) : 'P<bas>_P<haut>', la DIRECTION distingue
// montée/descente. Les anciennes clés 'P2_P1'… étaient stockées mais jamais lues (migration 145).
const DOWNGRADE_TRANSITIONS = PROFILE_TRANSITION_KEYS.map((key) => {
  const [from, to] = key.split('_');
  return { key, label: `${to} → ${from}` };
});

const EXCEPTIONAL_TRANSITIONS = [
  { key: 'exceptional_one', label: 'Baisse de revenus (−1 niveau)' },
  { key: 'exceptional_two', label: 'Revenus nuls (−2 niveaux)' },
];

// Messages de « maintien » (bilan mensuel quand le profil ne change pas) — un par profil.
const MAINTAIN_TRANSITIONS = ALL_PROFILES.map((p) => ({ key: p, label: `${p} — maintien` }));

// ── Simulation (admin) ──────────────────────────────────────────

function SimulationSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: fp, isLoading } = useFinancialProfile(userId);
  const simulate = useSimulateProfileChange(userId);

  const current = (fp?.profile_id as FinancialProfileId | undefined) ?? null;
  const [target, setTarget] = useState<FinancialProfileId | null>(null);

  if (isLoading) return <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />;

  if (!current) {
    return (
      <View style={styles.sectionContent}>
        <Text style={styles.matrixInfo}>
          Aucun profil financier actif sur ce compte. Termine d'abord le questionnaire pour pouvoir simuler une transition.
        </Text>
      </View>
    );
  }

  const currentNum = parseInt(current.replace('P', ''));
  const direction: 'upgrade' | 'downgrade' | null = !target
    ? null
    : parseInt(target.replace('P', '')) > currentNum ? 'upgrade' : 'downgrade';

  const trigger = (t: FinancialProfileId, reason: 'automatic_upgrade' | 'automatic_downgrade' | 'exceptional_revenue_drop' | 'monthly_recap') => {
    simulate.mutate({ target: t, reason }, {
      onSuccess: () => setTarget(null),
      onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec de la simulation.'),
    });
  };

  const exceptionalTarget = (levels: number): FinancialProfileId =>
    `P${Math.max(1, currentNum - levels)}` as FinancialProfileId;

  return (
    <View style={styles.sectionContent}>
      <Text style={styles.matrixInfo}>
        Force ton profil vers la cible choisie et affiche immédiatement la pop-up correspondante.
        Ignore les critères, le gel des 6 mois et la date de déclenchement. Le changement est réel.
      </Text>

      {/* Profil actuel */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Profil actuel</Text>
        <View style={styles.simCurrentRow}>
          <Text style={styles.simEmoji}>{PROFILE_INFO[current].emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.simName, { color: PROFILE_INFO[current].color }]}>{PROFILE_INFO[current].name}</Text>
            <Text style={styles.simTier}>{current} · {PROFILE_INFO[current].tier}</Text>
          </View>
        </View>
      </View>

      {/* Choix de la cible */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Profil cible</Text>
        <View style={styles.simChipRow}>
          {ALL_PROFILES.map((p) => {
            const isCurrent = p === current;
            const active = p === target;
            return (
              <TouchableOpacity
                key={p}
                disabled={isCurrent}
                onPress={() => setTarget(p)}
                style={[
                  styles.simChip,
                  isCurrent && styles.simChipDisabled,
                  active && { backgroundColor: PROFILE_INFO[p].color, borderColor: PROFILE_INFO[p].color },
                ]}
              >
                <Text style={styles.simChipEmoji}>{PROFILE_INFO[p].emoji}</Text>
                <Text style={[styles.simChipText, active && { color: '#fff' }, isCurrent && { color: COLORS.textSecondary }]}>
                  {p}{isCurrent ? ' (actuel)' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {target && direction && (
          <View style={[styles.simDirBadge, { backgroundColor: (direction === 'upgrade' ? COLORS.emerald : '#f87171') + '20' }]}>
            <Ionicons name={direction === 'upgrade' ? 'trending-up' : 'trending-down'} size={15} color={direction === 'upgrade' ? COLORS.emerald : '#f87171'} />
            <Text style={[styles.simDirText, { color: direction === 'upgrade' ? COLORS.emerald : '#f87171' }]}>
              {direction === 'upgrade' ? 'Montée' : 'Descente'} · {current} → {target}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, (!target || simulate.isPending) && { opacity: 0.5 }]}
          disabled={!target || simulate.isPending}
          onPress={() => target && direction && trigger(target, direction === 'upgrade' ? 'automatic_upgrade' : 'automatic_downgrade')}
        >
          {simulate.isPending
            ? <ActivityIndicator color={COLORS.bg} size="small" />
            : <Text style={styles.saveBtnText}>Déclencher la transition</Text>}
        </TouchableOpacity>
      </View>

      {/* Cas exceptionnels (baisse de revenus) */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Cas exceptionnels (baisse de revenus)</Text>
        <TouchableOpacity
          style={[styles.simExcBtn, (currentNum <= 1 || simulate.isPending) && { opacity: 0.5 }]}
          disabled={currentNum <= 1 || simulate.isPending}
          onPress={() => trigger(exceptionalTarget(1), 'exceptional_revenue_drop')}
        >
          <Ionicons name="warning-outline" size={16} color="#f59e0b" />
          <Text style={styles.simExcText}>Baisse de revenus (−1 niveau → {exceptionalTarget(1)})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.simExcBtn, (currentNum < 3 || simulate.isPending) && { opacity: 0.5 }]}
          disabled={currentNum < 3 || simulate.isPending}
          onPress={() => trigger(exceptionalTarget(2), 'exceptional_revenue_drop')}
        >
          <Ionicons name="warning-outline" size={16} color="#f59e0b" />
          <Text style={styles.simExcText}>Revenus nuls (−2 niveaux → {exceptionalTarget(2)})</Text>
        </TouchableOpacity>
      </View>

      {/* Bilan mensuel — message « maintien » (le profil ne change pas) */}
      <View style={styles.simCard}>
        <Text style={styles.fieldLabel}>Bilan mensuel (même profil)</Text>
        <TouchableOpacity
          style={[styles.simMaintainBtn, simulate.isPending && { opacity: 0.5 }]}
          disabled={simulate.isPending}
          onPress={() => trigger(current, 'monthly_recap')}
        >
          <Ionicons name="sync-outline" size={16} color="#60a5fa" />
          <Text style={styles.simExcText}>Message de maintien ({current})</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Messages de notification ────────────────────────────────────

function MessagesSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: messages = [], isLoading } = useProfileNotificationMessages();
  const updateMsg = useUpdateNotificationMessage(userId);

  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  const allTransitions = [
    ...TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'upgrade' as const })),
    ...DOWNGRADE_TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'downgrade' as const })),
    ...EXCEPTIONAL_TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'exceptional' as const })),
    ...MAINTAIN_TRANSITIONS.map(t => ({ key: t.key, label: t.label, direction: 'same' as const })),
  ];

  function startEdit(transition: string, direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same') {
    const msg = messages.find(m => m.transition === transition && m.direction === direction);
    setEditTitle(msg?.title ?? '');
    setEditBody(msg?.body ?? '');
    setEditing(`${transition}|${direction}`);
  }

  async function handleSave(transition: string, direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same') {
    if (!editTitle.trim()) { Alert.alert('Titre requis'); return; }
    try {
      await updateMsg.mutateAsync({ transition, direction, title: editTitle.trim(), body: editBody.trim() });
      setEditing(null);
      Alert.alert('Sauvegardé');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  if (isLoading) return <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />;

  return (
    <View style={styles.sectionContent}>
      {allTransitions.map(({ key: transition, label, direction }) => {
        const msg = messages.find(m => m.transition === transition && m.direction === direction);
        const editKey = `${transition}|${direction}`;
        const isEditing = editing === editKey;
        const dirColor = direction === 'upgrade' ? COLORS.emerald : direction === 'downgrade' ? '#f87171' : direction === 'same' ? '#60a5fa' : '#f59e0b';

        return (
          <View key={editKey} style={styles.msgCard}>
            <View style={styles.msgHeader}>
              <View style={[styles.dirBadge, { backgroundColor: dirColor + '20' }]}>
                <Text style={[styles.dirBadgeText, { color: dirColor }]}>
                  {direction === 'upgrade' ? '↑ Montée' : direction === 'downgrade' ? '↓ Descente' : direction === 'same' ? '↺ Maintien' : '⚠ Exceptionnel'}
                </Text>
              </View>
              <Text style={styles.msgTransition}>{label}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={isEditing ? 'Annuler la modification' : 'Modifier la transition'} onPress={() => isEditing ? setEditing(null) : startEdit(transition, direction)}>
                <Ionicons name={isEditing ? 'close' : 'create-outline'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {isEditing ? (
              <View style={styles.editForm}>
                <Text style={styles.fieldLabel}>Titre</Text>
                <TextInput
                  style={styles.input}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  multiline
                  placeholderTextColor={COLORS.textSecondary}
                  placeholder="Titre du message"
                />
                <Text style={styles.fieldLabel}>Corps</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={editBody}
                  onChangeText={setEditBody}
                  multiline
                  numberOfLines={4}
                  placeholderTextColor={COLORS.textSecondary}
                  placeholder="Contenu du message"
                />
                <TouchableOpacity
                  style={[styles.saveBtn, updateMsg.isPending && { opacity: 0.6 }]}
                  onPress={() => handleSave(transition, direction)}
                  disabled={updateMsg.isPending}
                >
                  {updateMsg.isPending
                    ? <ActivityIndicator color={COLORS.bg} size="small" />
                    : <Text style={styles.saveBtnText}>Sauvegarder</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.msgPreview}>
                <Text style={styles.msgTitle} numberOfLines={2}>{msg?.title ?? '—'}</Text>
                <Text style={styles.msgBody} numberOfLines={3}>{msg?.body ?? '—'}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Garde-fou de calibrage : la monotonie de l'échelle ──────────

/**
 * L'échelle doit rester une CHAÎNE CUMULATIVE : chaque palier ajoute une condition à celui d'en
 * dessous. Si la réserve exigée décroît quelque part, un palier « supérieur » devient plus facile à
 * atteindre que le précédent — on peut alors sauter P5/P6, puis retomber de plusieurs crans sans
 * qu'aucune donnée n'ait bougé. Ça ne se voit pas en éditant une ligne : ça se voit en les lisant
 * toutes. D'où ce contrôle, ici, sur les valeurs RÉELLEMENT enregistrées.
 */
function MonotonyWarning({ configs }: { configs: any[] }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const ladder = ['P2_P3', 'P3_P4', 'P4_P5', 'P5_P6', 'P6_P7', 'P7_P8', 'P8_P9'];

  const breaks: string[] = [];
  let previous = -Infinity;
  for (const t of ladder) {
    const v = Number(configs.find((c: any) => c.transition === t)?.upgrade_months_threshold);
    if (!Number.isFinite(v)) continue;
    if (v < previous) breaks.push(t);
    previous = Math.max(previous, v);
  }
  if (breaks.length === 0) return null;

  return (
    <View style={[styles.matrixCard, { borderColor: COLORS.orange + '66' }]}>
      <Text style={[styles.matrixLabel, { color: COLORS.orange }]}>⚠️ Échelle non monotone</Text>
      <Text style={styles.matrixSummaryText}>
        La réserve exigée DIMINUE sur : {breaks.join(', ')}. Un palier supérieur devient plus facile
        à atteindre que celui d’en dessous — des sauts et des rechutes apparaîtront sans qu’aucune
        donnée n’ait bougé.
      </Text>
    </View>
  );
}

// ── Distribution des paliers ────────────────────────────────────

/** Où tombe réellement la base. Un palier qui ramasse tout le monde ne segmente rien. */
function ProfileDistribution() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data, isLoading, isError } = useProfileDistribution();

  if (isLoading) return <ActivityIndicator color={COLORS.emerald} style={{ marginVertical: 16 }} />;
  if (isError || !data || data.total === 0) return null;

  const max = Math.max(...ALL_PROFILES.map((p) => data.counts[p] ?? 0), 1);

  return (
    <View style={styles.matrixCard}>
      <Text style={styles.matrixLabel}>Répartition de la base ({data.total} profils)</Text>
      {ALL_PROFILES.map((p) => {
        const n = data.counts[p] ?? 0;
        const pct = Math.round((n / data.total) * 100);
        const info = PROFILE_INFO[p];
        return (
          <View key={p} style={styles.distRow}>
            <Text style={styles.distLabel} numberOfLines={1}>{info.emoji} {p}</Text>
            <View style={styles.distTrack}>
              <View style={[styles.distFill, { width: `${(n / max) * 100}%`, backgroundColor: info.color }]} />
            </View>
            <Text style={styles.distValue}>{n} · {pct} %</Text>
          </View>
        );
      })}
      {data.pending > 0 && (
        <Text style={styles.matrixSummaryText}>
          {data.pending} profil(s) encore sur les règles précédentes : ils seront reclassés en
          silence à leur prochaine ouverture de l’app.
        </Text>
      )}
    </View>
  );
}

// ── Simulateur : où tombe cet utilisateur, avec CES seuils ? ─────

/**
 * ON NE RECALIBRE PAS À L'AVEUGLE. Un seuil déplacé d'un demi-mois change le palier — donc les
 * recommandations — de milliers de personnes. Le simulateur applique le MOTEUR RÉEL
 * (`computeProfileFromData`) aux seuils actuellement enregistrés : ce qu'il affiche est exactement
 * ce que l'app calculerait pour cette situation.
 */
function LadderSimulator({ configs }: { configs: any[] }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [v, setV] = useState({
    income: '2500', expenses: '1600', savings: '6000', invested: '0', wealth: '',
  });
  const num = (s: string) => {
    const n = parseFloat(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const thresholds = useMemo(() => thresholdsFromMatrix(configs as any[]), [configs]);
  const savings = num(v.savings);
  const invested = num(v.invested);
  const inputs = {
    availableSavings: savings,
    avgMonthlyIncome: num(v.income),
    monthlyEssentialExpenses: num(v.expenses),
    totalInvested: invested,
    totalLiquidWealth: v.wealth.trim() === '' ? undefined : num(v.wealth),
    hasSavingsAccount: true,
    hasRecurringExpenses: num(v.expenses) > 0,
  };
  const profile = computeProfileFromData(inputs, thresholds, 'up');
  const floor = computeProfileFromData(inputs, thresholds, 'down');
  const info = PROFILE_INFO[profile];
  const months = num(v.expenses) > 0 ? savings / num(v.expenses) : null;

  const FIELDS: { key: keyof typeof v; label: string }[] = [
    { key: 'income',   label: 'Revenu mensuel de référence (€)' },
    { key: 'expenses', label: 'Dépenses essentielles / mois (€)' },
    { key: 'savings',  label: 'Épargne disponible (€)' },
    { key: 'invested', label: 'Total réellement placé (€)' },
    { key: 'wealth',   label: 'Patrimoine bancaire (€, vide = épargne + placements)' },
  ];

  return (
    <View style={styles.matrixCard}>
      <Text style={styles.matrixLabel}>Simulateur — avec les seuils enregistrés</Text>
      {FIELDS.map(({ key, label }) => (
        <View key={key} style={styles.matrixRow}>
          <Text style={styles.matrixRowLabel}>{label}</Text>
          <TextInput
            style={styles.matrixInput}
            value={v[key]}
            onChangeText={(t) => setV((p) => ({ ...p, [key]: t }))}
            keyboardType="decimal-pad"
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>
      ))}
      <View style={[styles.matrixSummary, { borderColor: info.color + '55', borderWidth: 1, borderRadius: 12, padding: 10 }]}>
        <Text style={[styles.matrixLabel, { color: info.color }]}>
          {info.emoji} {profile} — {info.name}
        </Text>
        <Text style={styles.matrixSummaryText}>
          Matelas : {months == null ? '—' : `${months.toFixed(1)} mois`} ·
          Patrimoine : {(inputs.totalLiquidWealth ?? savings + invested).toLocaleString('fr-FR')} €
        </Text>
        {/* Les deux lectures : c'est la bande d'hystérésis rendue visible. */}
        <Text style={styles.matrixSummaryText}>
          Lecture montée : {profile} · lecture descente : {floor}
          {profile !== floor ? ' — dans la bande, un utilisateur déjà classé ne bougerait pas.' : ''}
        </Text>
      </View>
    </View>
  );
}

// ── Matrice de seuils ───────────────────────────────────────────

function MatrixSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: configs = [], isLoading } = useProfileMatrixConfig();
  const updateConfig = useUpdateMatrixConfig(userId);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  /** Champ laissé vide → `null` (le moteur applique son repli), et non 0 (seuil nul). */
  const numOrNull = (raw: string | undefined): number | null => {
    const t = String(raw ?? '').replace(',', '.').trim();
    if (t === '') return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };

  function startEdit(transition: string) {
    const cfg = configs.find((c: any) => c.transition === transition);
    if (cfg) {
      /* ⚠️ N'ÉDITER QUE CE QUE LE MOTEUR LIT. Cet écran proposait encore quatre leviers morts —
         seuils de flux (le taux d'épargne ne classe plus, échelle v2) et « mois consécutifs requis »
         (remplacé par l'hystérésis). On croyait calibrer, rien ne bougeait : exactement le piège que
         la migration 194 avait déjà corrigé une première fois. Chaque champ ci-dessous est lu par
         `thresholdsFromMatrix`. */
      setEditValues({
        upgrade_months_threshold: String(cfg.upgrade_months_threshold ?? ''),
        downgrade_months_threshold: String(cfg.downgrade_months_threshold ?? ''),
        upgrade_wealth_threshold: String((cfg as any).upgrade_wealth_threshold ?? ''),
        downgrade_wealth_threshold: String((cfg as any).downgrade_wealth_threshold ?? ''),
        chronic_overdraft_months: String((cfg as any).chronic_overdraft_months ?? ''),
        viability_exit_ratio: String((cfg as any).viability_exit_ratio ?? ''),
        viability_enter_ratio: String((cfg as any).viability_enter_ratio ?? ''),
        viability_grace_months: String((cfg as any).viability_grace_months ?? ''),
      });
    }
    setEditingKey(transition);
  }

  async function handleSave(transition: string) {
    try {
      await updateConfig.mutateAsync({
        transition,
        /* Vide ⇒ `null`, JAMAIS 0. Le moteur retombe alors sur sa valeur de repli ; un zéro, lui,
           serait un seuil atteint par tout le monde. */
        upgrade_months_threshold: numOrNull(editValues.upgrade_months_threshold),
        downgrade_months_threshold: numOrNull(editValues.downgrade_months_threshold),
        upgrade_wealth_threshold: numOrNull(editValues.upgrade_wealth_threshold),
        downgrade_wealth_threshold: numOrNull(editValues.downgrade_wealth_threshold),
        chronic_overdraft_months: numOrNull(editValues.chronic_overdraft_months),
        viability_exit_ratio: numOrNull(editValues.viability_exit_ratio),
        viability_enter_ratio: numOrNull(editValues.viability_enter_ratio),
        viability_grace_months: numOrNull(editValues.viability_grace_months),
      } as any);
      setEditingKey(null);
      Alert.alert('Sauvegardé');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  if (isLoading) return <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />;

  return (
    <View style={styles.sectionContent}>
      {/* Ce texte décrivait l'ANCIEN moteur (compteurs de mois consécutifs), débranché depuis que le
          profil est évalué en temps réel. Il décrit maintenant ce qui se passe réellement. */}
      <Text style={styles.matrixInfo}>
        Le profil répond à quatre questions, dans cet ordre : la situation est-elle viable (P1) ·
        combien de temps tient-elle (P2 → P5) · investit-il réellement (P6) · quelle taille fait le
        patrimoine (P7 → P9). Le taux d’épargne ne classe plus rien.
      </Text>
      <Text style={styles.matrixInfo}>
        Le profil est recalculé DÈS QUE les données changent. L’écart entre le seuil de montée et
        celui de descente est la bande dans laquelle rien ne bouge : c’est elle qui empêche le
        profil de basculer d’avant en arrière autour d’un seuil. Un champ laissé vide reprend la
        valeur par défaut du moteur.
      </Text>
      {/* GARDE-FOU DE CALIBRAGE. La réserve exigée ne doit jamais décroître en montant l'échelle,
          sinon un palier « supérieur » devient plus facile à atteindre que celui d'en dessous — et
          l'utilisateur peut sauter P5/P6 puis retomber sans qu'aucune donnée n'ait bougé. */}
      <MonotonyWarning configs={configs} />
      <ProfileDistribution />
      <LadderSimulator configs={configs} />

      {TRANSITIONS.map(({ key: transition, label, from, to }) => {
        const cfg = configs.find((c: any) => c.transition === transition);
        const isEditing = editingKey === transition;
        const fromInfo = PROFILE_INFO[from];
        const toInfo = PROFILE_INFO[to];

        return (
          <View key={transition} style={styles.matrixCard}>
            <View style={styles.matrixHeader}>
              <Text style={styles.matrixLabel}>
                {fromInfo.emoji} {fromInfo.name} → {toInfo.emoji} {toInfo.name}
              </Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={isEditing ? 'Annuler la modification' : 'Modifier la transition'} onPress={() => isEditing ? setEditingKey(null) : startEdit(transition)}>
                <Ionicons name={isEditing ? 'close' : 'create-outline'} size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {isEditing ? (
              <View style={styles.editForm}>
                {[
                  // « Mois de sécurité » = épargne ÷ DÉPENSES essentielles mensuelles, c'est-à-dire
                  // charges récurrentes + budget variable (lib/securityCushion) — MÊME définition
                  // partout dans l'app (Pouls, Reporting, recommandations).
                  {
                    field: 'upgrade_months_threshold',
                    label: WEALTH_TRANSITIONS.has(transition)
                      ? 'Réserve minimale exigée (mois de dépenses)'
                      : 'Montée — mois de DÉPENSES couverts ≥',
                  },
                  ...(WEALTH_TRANSITIONS.has(transition) ? [] : [
                    { field: 'downgrade_months_threshold', label: 'Descente — mois de DÉPENSES couverts <' },
                  ]),

                  /* PALIERS DE PATRIMOINE : ne concernent que P6→P7, P7→P8, P8→P9. Sur ces trois
                     transitions, la RÉSERVE minimale s'ajoute au montant — le patrimoine seul
                     n'ouvre jamais un palier, et elle ne descend jamais sous celle de P5/P6 (sinon
                     un palier « supérieur » deviendrait moins exigeant que ceux qu'il surplombe). */
                  ...(WEALTH_TRANSITIONS.has(transition) ? [
                    { field: 'upgrade_wealth_threshold',   label: 'Montée — patrimoine bancaire ≥ (€)' },
                    { field: 'downgrade_wealth_threshold', label: 'Descente — patrimoine bancaire < (€)' },
                  ] : []),
                  /* VIABILITÉ + découvert chronique : portés par la ligne P1_P2, la seule où ils
                     aient un sens. Ce sont eux qui gouvernent l'entrée et la sortie de « Fragile ». */
                  ...(transition === 'P1_P2' ? [
                    { field: 'viability_exit_ratio',     label: 'Sortie de P1 — charges ≤ × revenu (0,95)' },
                    { field: 'viability_enter_ratio',    label: 'Entrée en P1 — charges > × revenu (1,02)' },
                    { field: 'viability_grace_months',   label: 'Réserve qui dispense de P1 (mois)' },
                    { field: 'chronic_overdraft_months', label: 'Découvert chronique — mois consécutifs ≥' },
                  ] : []),
                ].map(({ field, label: fl }) => (
                  <View key={field} style={styles.matrixRow}>
                    <Text style={styles.matrixRowLabel}>{fl}</Text>
                    <TextInput
                      style={styles.matrixInput}
                      value={editValues[field]}
                      onChangeText={v => setEditValues(prev => ({ ...prev, [field]: v }))}
                      keyboardType="decimal-pad"
                      placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                ))}
                {!WEALTH_TRANSITIONS.has(transition) && (
                  <View style={styles.bufferRow}>
                    <Text style={styles.bufferLabel}>Écart tampon (calculé)</Text>
                    <Text style={styles.bufferValue}>
                      {(parseFloat(editValues.upgrade_months_threshold) - parseFloat(editValues.downgrade_months_threshold)).toFixed(1)} mois
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, updateConfig.isPending && { opacity: 0.6 }]}
                  onPress={() => handleSave(transition)}
                  disabled={updateConfig.isPending}
                >
                  {updateConfig.isPending
                    ? <ActivityIndicator color={COLORS.bg} size="small" />
                    : <Text style={styles.saveBtnText}>Sauvegarder</Text>}
                </TouchableOpacity>
              </View>
            ) : cfg ? (
              <View style={styles.matrixSummary}>
                {WEALTH_TRANSITIONS.has(transition) ? (
                  <>
                    <Text style={styles.matrixSummaryText}>
                      💰 Patrimoine : ≥ {(cfg as any).upgrade_wealth_threshold ?? '—'} € ·
                      sortie &lt; {(cfg as any).downgrade_wealth_threshold ?? '—'} €
                    </Text>
                    <Text style={styles.matrixSummaryText}>
                      Réserve exigée en plus : ≥ {cfg.upgrade_months_threshold} mois · placements obligatoires
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.matrixSummaryText}>↑ Montée : ≥ {cfg.upgrade_months_threshold} mois</Text>
                    <Text style={styles.matrixSummaryText}>↓ Descente : &lt; {cfg.downgrade_months_threshold} mois</Text>
                  </>
                )}
                {transition === 'P1_P2' && (
                  <>
                    <Text style={styles.matrixSummaryText}>
                      Viabilité : sortie ≤ {(cfg as any).viability_exit_ratio ?? '—'} × revenu ·
                      entrée &gt; {(cfg as any).viability_enter_ratio ?? '—'} × revenu
                    </Text>
                    <Text style={styles.matrixSummaryText}>
                      Dispense de P1 au-delà de {(cfg as any).viability_grace_months ?? '—'} mois de réserve ·
                      découvert chronique {(cfg as any).chronic_overdraft_months ?? '—'} mois
                    </Text>
                  </>
                )}
              </View>
            ) : (
              <Text style={{ color: COLORS.textSecondary }}>Non configuré</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Paramètres globaux ──────────────────────────────────────────

function GlobalSection({ userId }: { userId: string }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // ── Seuils d'épargne (globaux, en EUR) + libellés affichés (Comptes → vue d'ensemble) ──
  const { data: savingsCfg } = useSavingsConfig();
  const saveSavings = useSaveSavingsConfig();
  const [sv, setSv] = useState<Record<string, string>>({});
  useEffect(() => {
    const c = savingsCfg ?? SAVINGS_DEFAULTS;
    setSv({
      min: String(c.min), optimal: String(c.optimal), comfort: String(c.comfort),
      label_critical: c.label_critical, label_low: c.label_low, label_healthy: c.label_healthy, label_comfort: c.label_comfort,
    });
  }, [savingsCfg]);
  async function handleSaveSavings() {
    try {
      await saveSavings.mutateAsync({
        min: parseFloat(sv.min) || 0,
        optimal: parseFloat(sv.optimal) || 0,
        comfort: parseFloat(sv.comfort) || 0,
        label_critical: sv.label_critical?.trim() || SAVINGS_DEFAULTS.label_critical,
        label_low: sv.label_low?.trim() || SAVINGS_DEFAULTS.label_low,
        label_healthy: sv.label_healthy?.trim() || SAVINGS_DEFAULTS.label_healthy,
        label_comfort: sv.label_comfort?.trim() || SAVINGS_DEFAULTS.label_comfort,
      });
      Alert.alert('Sauvegardé');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de sauvegarder.');
    }
  }

  return (
    <View style={styles.sectionContent}>
      {/* ── QUATRE RÉGLAGES ONT ÉTÉ RETIRÉS D'ICI, ET C'EST VOLONTAIRE ──────────────────────────
          « Gel du profil initial », « fenêtre des flux », « fenêtre des dépenses moyennes » et
          « seuil de chute de revenus » n'étaient plus lus par aucun moteur : le profil n'est plus
          gelé (il suit les données en continu), le taux d'épargne ne classe plus rien, et la règle
          de chute exceptionnelle a disparu avec l'évaluation mensuelle décisionnelle.
          Les afficher revenait à promettre un calibrage sans effet — exactement ce que la migration
          194 avait déjà corrigé une fois. Les vrais leviers sont dans l'onglet « Matrice ». */}
      <Text style={styles.matrixInfo}>
        Les seuils qui gouvernent réellement le classement (matelas, patrimoine, viabilité,
        découvert chronique) se règlent dans l’onglet <Text style={{ fontWeight: '800' }}>Matrice</Text>,
        transition par transition. Le profil n’est plus gelé et le taux d’épargne ne le décide plus :
        les réglages correspondants ont été retirés plutôt que laissés sans effet.
      </Text>

      {/* ── Seuils d'épargne + libellés (vue d'ensemble Comptes) ── */}
      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Seuils d'épargne (en €, base — convertis dans la devise de réf.)</Text>
      {[
        { field: 'min',     label: `Seuil « ${sv.label_critical || 'Critique'} » si épargne <` },
        { field: 'optimal', label: `Seuil « ${sv.label_low || 'À renforcer'} » si épargne <` },
        { field: 'comfort', label: `Seuil « ${sv.label_healthy || 'Saine'} » si épargne <` },
      ].map(({ field, label }) => (
        <View key={field} style={styles.globalRow}>
          <Text style={styles.globalLabel}>{label}</Text>
          <TextInput
            style={styles.globalInput}
            value={sv[field] ?? ''}
            onChangeText={(v) => setSv((p) => ({ ...p, [field]: v }))}
            keyboardType="decimal-pad"
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>
      ))}
      <Text style={styles.matrixInfo}>Au-delà du seuil le plus haut : « {sv.label_comfort || 'Confortable'} ».</Text>

      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Libellés des paliers</Text>
      {[
        { field: 'label_critical', label: 'Palier 1 (le plus bas)' },
        { field: 'label_low',      label: 'Palier 2' },
        { field: 'label_healthy',  label: 'Palier 3' },
        { field: 'label_comfort',  label: 'Palier 4 (le plus haut)' },
      ].map(({ field, label }) => (
        <View key={field} style={styles.globalRow}>
          <Text style={styles.globalLabel}>{label}</Text>
          <TextInput
            style={[styles.globalInput, { width: 130, textAlign: 'left' }]}
            value={sv[field] ?? ''}
            onChangeText={(v) => setSv((p) => ({ ...p, [field]: v }))}
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>
      ))}

      <TouchableOpacity
        style={[styles.saveBtn, saveSavings.isPending && { opacity: 0.6 }]}
        onPress={handleSaveSavings}
        disabled={saveSavings.isPending}
      >
        {saveSavings.isPending
          ? <ActivityIndicator color={COLORS.bg} size="small" />
          : <Text style={styles.saveBtnText}>Enregistrer les seuils d'épargne</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ── Écran principal ─────────────────────────────────────────────

export default function FinancialProfilesAdmin() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('simulate');

  if (!user) return null;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>

        <ScreenHeader title="Profils financiers" onBack={goBack} />

        <Text style={styles.subtitle}>Configuration des profils P0-P9, seuils et messages.</Text>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'simulate' && <SimulationSection userId={user.id} />}
          {activeTab === 'messages' && <MessagesSection userId={user.id} />}
          {activeTab === 'matrix'   && <MatrixSection userId={user.id} />}
          {activeTab === 'global'   && <GlobalSection userId={user.id} />}
        </KeyboardAwareScrollView>

      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  tabTextActive: { color: c.bg },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  sectionContent: { gap: 12 },

  // Messages
  msgCard: {
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14, gap: 10,
  },
  msgHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dirBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  dirBadgeText: { fontSize: 11, fontWeight: '700' },
  msgTransition: { flex: 1, fontSize: 13, fontWeight: '600', color: c.text },
  msgPreview: { gap: 4 },
  msgTitle: { fontSize: 13, fontWeight: '600', color: c.text, lineHeight: 18 },
  msgBody: { fontSize: 12, color: c.textSecondary, lineHeight: 16 },

  // Matrice
  matrixInfo: { fontSize: 12, color: c.textSecondary, marginBottom: 4 },
  matrixCard: {
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14, gap: 10,
  },
  matrixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matrixLabel: { fontSize: 13, fontWeight: '600', color: c.text, flex: 1 },
  matrixSummary: { gap: 4 },
  matrixSummaryText: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },

  // Distribution : une barre par palier, à l'échelle du palier le plus peuplé.
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  distLabel: { width: 58, fontSize: 12, color: c.text },
  distTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.cardBorder, overflow: 'hidden' },
  distFill: { height: 8, borderRadius: 4 },
  distValue: { width: 78, fontSize: 11.5, color: c.textSecondary, textAlign: 'right' },
  matrixRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  matrixRowLabel: { flex: 1, fontSize: 13, color: c.text },
  matrixInput: {
    width: 72, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: c.text, textAlign: 'center',
  },
  bufferRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bufferLabel: { fontSize: 12, color: c.textSecondary },
  bufferValue: { fontSize: 12, fontWeight: '700', color: c.emerald },

  // Paramètres globaux
  globalRow: {
    backgroundColor: c.card, borderRadius: 12, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  globalLabel: { flex: 1, fontSize: 13, color: c.text },
  globalInput: {
    width: 72, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: c.text, textAlign: 'center',
  },

  // Simulation
  simCard: {
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1,
    borderColor: c.cardBorder, padding: 14, gap: 10,
  },
  simCurrentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  simEmoji: { fontSize: 30 },
  simName: { fontSize: 16, fontWeight: '800' },
  simTier: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  simChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  simChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.bg,
  },
  simChipDisabled: { opacity: 0.5 },
  simChipEmoji: { fontSize: 15 },
  simChipText: { fontSize: 13, fontWeight: '700', color: c.text },
  simDirBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  simDirText: { fontSize: 12.5, fontWeight: '700' },
  simExcBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#f59e0b55', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#f59e0b12',
  },
  simExcText: { fontSize: 13, fontWeight: '600', color: c.text },
  simMaintainBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#60a5fa55', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#60a5fa12',
  },

  // Formulaire commun
  editForm: { gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  input: {
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: c.text, fontSize: 13,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: c.emerald, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  saveBtnText: { color: c.bg, fontWeight: '700', fontSize: 14 },
});
}
