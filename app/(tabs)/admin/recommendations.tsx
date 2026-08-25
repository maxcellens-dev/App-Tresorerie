import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import {
  RECO_COLORS,
  RECO_TYPE_LABELS,
  CONSUMPTION_MODE_LABELS,
  DEFAULT_CONSUMPTION_ORDERS,
  DEFAULT_AUTO_PROFILE_MAP,
} from '../../../lib/finance/recommendationEngine';
import type { RecoType, ConsumptionMode } from '../../../lib/finance/recommendationEngine';
import type { FinancialProfileId } from '../../../types/database';
import { FINANCIAL_PROFILE_IDS, PROFILE_INFO } from '../../../lib/finance/financialProfileEngine';
import { useRecoThresholds, useUpdateRecoThresholds, useUpdateRecoConsumption } from '../../../hooks/pilotage/useRecoThresholds';
import { useAuth } from '../../../contexts/AuthContext';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { sanitizeAmountInput } from '../../../lib/ui/amountInput';


const RECO_ICONS: Record<RecoType, string> = {
  save: 'shield-outline',
  invest: 'trending-up-outline',
  enjoy: 'sparkles-outline',
  keep: 'hourglass-outline',
};

const RECO_DESC: Record<RecoType, string> = {
  save: 'Transférer vers l\'épargne de sécurité.',
  invest: 'Alimenter un compte d\'investissement.',
  enjoy: 'Marge de confort : ce qu\'il reste en plus une fois les dépenses variables habituelles couvertes. Grignotée en premier en cas de dépassement.',
  keep: 'Conserver sur le compte courant. Récupère aussi ce que les garde-fous retirent à Épargner / Investir.',
};

const CONSUMPTION_MODES: ConsumptionMode[] = ['prudent', 'equilibre', 'dynamique'];
/* Liste et libellés DÉRIVÉS du référentiel (lib/financialProfileEngine) : recopiés ici, ils
   divergeaient au premier profil ajouté — et l'écran d'administration devenait alors le seul
   endroit de l'app à afficher d'anciens noms. */
const PROFILES: FinancialProfileId[] = FINANCIAL_PROFILE_IDS;
const PROFILE_LABELS_SHORT: Record<FinancialProfileId, string> = Object.fromEntries(
  FINANCIAL_PROFILE_IDS.map((p) => [p, `${p} — ${PROFILE_INFO[p].name}`]),
) as Record<FinancialProfileId, string>;

type AdminTab = 'infos' | 'seuils' | 'ordre';
const ADMIN_TABS: { key: AdminTab; label: string }[] = [
  { key: 'seuils', label: 'Seuils' },
  { key: 'ordre', label: 'Ordre' },
  { key: 'infos', label: 'Infos' },
];

const TYPES: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];

/**
 * Garde-fous et bornes appliqués APRÈS la répartition en %, sur les MONTANTS.
 * Ils ne sont pas éditables : ce sont des règles de sécurité, pas des réglages.
 */
const GUARDS = [
  { icon: 'shield-outline', name: 'Solde sous la marge', desc: 'Solde courant < marge de sécurité → une seule reco : Conserver (tout ce qui reste).' },
  { icon: 'trending-down-outline', name: 'Projection en danger', desc: 'Trajectoire déjà signalée en danger → tout Conserver, idem.' },
  { icon: 'git-branch-outline', name: 'Garde-fou marge × projection (6 mois)', desc: 'Si le point bas des 6 prochains mois est déjà sous la marge → tout Conserver, avec le message qui l\'explique. Sinon, Épargner et Investir sont plafonnés au « headroom » (point bas − marge) pour qu\'exécuter les recos ne fasse pas plonger la trajectoire : Investir est réduit EN PREMIER (illiquide), puis Épargner ; l\'excédent file vers Conserver.' },
  { icon: 'repeat-outline', name: 'Tenue en virement récurrent', desc: 'Chaque montant est testé sur 12 mois : tenable en récurrent, plafonné à X €/mois, ou ponctuel seulement. Deux conditions — ne pas passer sous la marge pendant l\'horizon, ET ne pas dépasser le surplus mensuel structurel (sinon le solde décline).' },
  { icon: 'help-circle-outline', name: 'Doute DIRECTIONNEL', desc: 'En confiance moyenne/basse, les montants s\'affichent en fourchette. Les gestes qui SORTENT l\'argent (Épargner, Investir — irréversibles) prennent la borne BASSE ; Conserver ne sort rien du compte, donc en cas de doute il en faut PLUS : montant plein, jamais de fourchette.' },
];

export default function RecommendationsAdmin() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: thresholds } = useRecoThresholds();
  const updateThresholds = useUpdateRecoThresholds(user?.id);
  const updateConsumption = useUpdateRecoConsumption(user?.id);

  // Onglet actif (réorganisation de la page en onglets pour éviter une page interminable).
  const [tab, setTab] = useState<AdminTab>('infos');

  // ── Ordre de déduction (cascade de dépassement) ──
  const [orders, setOrders] = useState<Record<ConsumptionMode, RecoType[]>>(DEFAULT_CONSUMPTION_ORDERS);
  const [autoMap, setAutoMap] = useState<Record<FinancialProfileId, ConsumptionMode>>(DEFAULT_AUTO_PROFILE_MAP);
  useEffect(() => {
    if (thresholds?.consumption_orders) setOrders({ ...DEFAULT_CONSUMPTION_ORDERS, ...thresholds.consumption_orders });
    if (thresholds?.auto_profile_map) setAutoMap({ ...DEFAULT_AUTO_PROFILE_MAP, ...thresholds.auto_profile_map });
  }, [thresholds]);

  function moveInOrder(mode: ConsumptionMode, index: number, dir: -1 | 1) {
    setOrders((prev) => {
      const arr = [...prev[mode]];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return { ...prev, [mode]: arr };
    });
  }

  async function saveOrder() {
    try {
      await updateConsumption.mutateAsync({ consumption_orders: orders, auto_profile_map: autoMap });
      Alert.alert('Enregistré', 'L\'ordre de déduction a été mis à jour.');
    } catch (err: unknown) {
      Alert.alert('Erreur', err instanceof Error ? err.message : 'Impossible de sauvegarder.');
    }
  }

  // Seuils de reste min pour afficher chaque reco (§9)
  const [seuils, setSeuils] = useState<{ epargne: string; invest: string; plaisir: string; conserver: string }>({ epargne: '', invest: '', plaisir: '', conserver: '' });
  useEffect(() => {
    if (thresholds) {
      setSeuils({
        epargne: String(thresholds.seuil_reco_epargne),
        invest: String(thresholds.seuil_reco_invest),
        plaisir: String(thresholds.seuil_reco_plaisir),
        conserver: String(thresholds.seuil_reco_conserver ?? 50),
      });
    }
  }, [thresholds]);

  async function saveSeuils() {
    const e = parseFloat(seuils.epargne.replace(',', '.'));
    const i = parseFloat(seuils.invest.replace(',', '.'));
    const p = parseFloat(seuils.plaisir.replace(',', '.'));
    const c = parseFloat(seuils.conserver.replace(',', '.'));
    if ([e, i, p, c].some((v) => Number.isNaN(v) || v < 0)) {
      Alert.alert('Valeur invalide', 'Saisissez des montants positifs.');
      return;
    }
    try {
      await updateThresholds.mutateAsync({ seuil_reco_epargne: e, seuil_reco_invest: i, seuil_reco_plaisir: p, seuil_reco_conserver: c });
      Alert.alert('Enregistré', 'Les seuils ont été mis à jour.');
    } catch (err: unknown) {
      Alert.alert('Erreur', err instanceof Error ? err.message : 'Impossible de sauvegarder.');
    }
  }


  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader
          title="Recommandations"
          onBack={goBack}
        />

        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtitle}>
            Le moteur propose 2 à 4 actions dont la somme fait 100 % du « À dépenser ».
          </Text>

          {/* ── Onglets ── */}
          <View style={styles.tabBar}>
            {ADMIN_TABS.map((t) => {
              const active = tab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                  onPress={() => setTab(t.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ══════════ Onglet INFOS : types, modificateurs, règles ══════════ */}
          {tab === 'infos' && (<>
          <Text style={styles.sectionTitle}>Types de recommandation</Text>
          {TYPES.map(type => (
            <View key={type} style={[styles.typeCard, { borderLeftColor: RECO_COLORS[type] }]}>
              <View style={styles.typeHeader}>
                <Ionicons name={RECO_ICONS[type] as any} size={18} color={RECO_COLORS[type]} />
                <Text style={[styles.typeTitle, { color: RECO_COLORS[type] }]}>{RECO_TYPE_LABELS[type]}</Text>
              </View>
              <Text style={styles.typeDesc}>{RECO_DESC[type]}</Text>
            </View>
          ))}
          </>)}

          {/* ══════════ Onglet SEUILS ══════════ */}
          {tab === 'seuils' && (<>
          <Text style={styles.sectionTitle}>Seuils d'affichage</Text>
          <Text style={styles.typeDesc}>
            Une reco n'est affichée que si le « Budget libre à allouer » atteint son seuil.
          </Text>
          {([
            { key: 'epargne' as const, label: 'Épargne', color: RECO_COLORS.save },
            { key: 'invest' as const, label: 'Investissement', color: RECO_COLORS.invest },
            { key: 'plaisir' as const, label: 'Se faire plaisir', color: RECO_COLORS.enjoy },
            { key: 'conserver' as const, label: 'Conserver', color: RECO_COLORS.keep },
          ]).map((s) => (
            <View key={s.key} style={[styles.typeCard, { borderLeftColor: s.color }]}>
              <View style={styles.seuilRow}>
                <Text style={[styles.typeTitle, { color: s.color, flex: 1 }]}>{s.label}</Text>
                <View style={styles.seuilInputWrap}>
                  <TextInput
                    style={styles.seuilInput}
                    value={seuils[s.key]}
                    onChangeText={(t) => setSeuils((prev) => ({ ...prev, [s.key]: sanitizeAmountInput(t) }))}
                    keyboardType="decimal-pad"
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <Text style={styles.seuilSuffix}>€</Text>
                </View>
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.seuilSaveBtn, updateThresholds.isPending && { opacity: 0.6 }]}
            onPress={saveSeuils}
            disabled={updateThresholds.isPending}
          >
            <Text style={styles.seuilSaveLabel}>Enregistrer les seuils</Text>
          </TouchableOpacity>
          </>)}

          {/* ══════════ Onglet ORDRE de déduction (cascade de dépassement) ══════════ */}
          {tab === 'ordre' && (<>
          <Text style={styles.sectionTitle}>Ordre de déduction</Text>
          <Text style={styles.typeDesc}>
            Quand l'utilisateur dépasse ses dépenses variables habituelles, ses recommandations sont
            grignotées une par une dans cet ordre (la 1ʳᵉ en premier), jusqu'à passer sous leur seuil
            d'affichage. L'ordre dépend de la « prudence du budget » choisie en paramètres.
          </Text>

          {CONSUMPTION_MODES.map((mode) => (
            <View key={mode} style={styles.tierCard}>
              <Text style={[styles.tierName, { color: COLORS.text }]}>{CONSUMPTION_MODE_LABELS[mode]}</Text>
              {orders[mode].map((type, i) => (
                <View key={type} style={styles.orderRow}>
                  <Text style={styles.orderRank}>{i + 1}</Text>
                  <View style={[styles.allocDot, { backgroundColor: RECO_COLORS[type] }]} />
                  <Text style={[styles.orderTypeLabel, { color: RECO_COLORS[type] }]}>{RECO_TYPE_LABELS[type]}</Text>
                  <View style={styles.orderArrows}>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Monter dans l'ordre"
                      style={[styles.orderArrowBtn, i === 0 && styles.orderArrowDisabled]}
                      onPress={() => moveInOrder(mode, i, -1)}
                      disabled={i === 0}
                    >
                      <Ionicons name="chevron-up" size={16} color={i === 0 ? COLORS.cardBorder : COLORS.text} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Descendre dans l'ordre"
                      style={[styles.orderArrowBtn, i === orders[mode].length - 1 && styles.orderArrowDisabled]}
                      onPress={() => moveInOrder(mode, i, 1)}
                      disabled={i === orders[mode].length - 1}
                    >
                      <Ionicons name="chevron-down" size={16} color={i === orders[mode].length - 1 ? COLORS.cardBorder : COLORS.text} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ))}

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Mode « Auto » → profil</Text>
          <Text style={styles.typeDesc}>
            En prudence « Auto », l'ordre est dérivé du profil financier de l'utilisateur.
          </Text>
          {PROFILES.map((pid) => (
            <View key={pid} style={[styles.typeCard, { borderLeftColor: COLORS.emerald }]}>
              <Text style={[styles.typeTitle, { color: COLORS.text, marginBottom: 8 }]}>{PROFILE_LABELS_SHORT[pid]}</Text>
              <View style={styles.modeChips}>
                {CONSUMPTION_MODES.map((mode) => {
                  const active = autoMap[pid] === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      style={[styles.modeChip, active && { borderColor: COLORS.emerald, backgroundColor: COLORS.emerald + '1A' }]}
                      onPress={() => setAutoMap((prev) => ({ ...prev, [pid]: mode }))}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.modeChipLabel, { color: active ? COLORS.emerald : COLORS.textSecondary }]}>
                        {CONSUMPTION_MODE_LABELS[mode]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={[styles.seuilSaveBtn, updateConsumption.isPending && { opacity: 0.6 }]}
            onPress={saveOrder}
            disabled={updateConsumption.isPending}
          >
            <Text style={styles.seuilSaveLabel}>Enregistrer l'ordre</Text>
          </TouchableOpacity>
          </>)}

          {tab === 'infos' && (<>
          {/* ── D'où viennent les pourcentages ──────────────────────────────────────────────────
              Il n'y a plus qu'une réponse, et c'est le point le plus important de cet écran :
              deux étages réécrivaient ces pourcentages (« priorité du mois », puis quatre
              modificateurs contextuels), si bien que l'utilisateur ne retrouvait jamais ceux de son
              profil dans ses recommandations. Les deux ont été retirés. */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>D'où viennent les pourcentages</Text>
          <View style={styles.rulesCard}>
            <Text style={styles.ruleItem}>• Du <Text style={{ fontWeight: '700' }}>profil financier</Text> (P0–P9), réglable dans « Profils financiers » — ou des pourcentages que l'utilisateur a posés lui-même (mode manuel).</Text>
            <Text style={styles.ruleItem}>• <Text style={{ fontWeight: '700' }}>Rien ne les réécrit ensuite.</Text> Ce que l'utilisateur voit sur son écran de profil est ce qui s'applique.</Text>
            <Text style={styles.ruleItem}>• Seuls les <Text style={{ fontWeight: '700' }}>MONTANTS</Text> peuvent s'en écarter, via les garde-fous ci-dessous. L'écran de répartition explique alors à l'utilisateur lequel s'applique.</Text>
          </View>

          {/* ── Garde-fous (sur les montants, après la répartition) ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Garde-fous</Text>
          <Text style={styles.modNote}>
            Appliqués ensuite aux MONTANTS. Ce sont des règles de sécurité, pas des réglages.
          </Text>
          {GUARDS.map(m => (
            <View key={m.name} style={styles.modCard}>
              <Ionicons name={m.icon as any} size={18} color={COLORS.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modName}>{m.name}</Text>
                <Text style={styles.modDesc}>{m.desc}</Text>
              </View>
            </View>
          ))}

          {/* ── Règles ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Règles</Text>
          <View style={styles.rulesCard}>
            <Text style={styles.ruleItem}>• Budget de référence = <Text style={{ fontWeight: '700' }}>Ton Relyka</Text> (cf. « Formule du Relyka »), diminué de ce qui est DÉJÀ alloué (virements exécutés ou prévus, cumuls, réservations)</Text>
            <Text style={styles.ruleItem}>• La somme des recommandations affichées = exactement le Relyka</Text>
            <Text style={styles.ruleItem}>• Une part &lt; 5 % → masquée et redistribuée</Text>
            <Text style={styles.ruleItem}>• Un poste sous son seuil d'affichage (onglet « Seuils ») est reversé aux autres</Text>
            <Text style={styles.ruleItem}>• Si AUCUN poste n'atteint son seuil → une seule reco de repli, et rien du tout en dessous de 10 €</Text>
            <Text style={styles.ruleItem}>• 2 à 4 recommandations affichées</Text>
            <Text style={styles.ruleItem}>• En cas de dépassement des dépenses variables, les recos sont grignotées dans l'ordre de déduction (voir onglet « Ordre »)</Text>
            <Text style={styles.ruleItem}>• Les mêmes % servent au calcul de la capacité d'investissement ailleurs dans l'app (source unique : deriveRecoAllocations) — deux écrans ne peuvent pas annoncer deux montants plaçables différents</Text>
          </View>
          </>)}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  seuilRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seuilInputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, minWidth: 90,
  },
  seuilInput: { flex: 1, color: c.text, fontSize: 15, fontWeight: '700', paddingVertical: 9 },
  seuilSuffix: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  seuilSaveBtn: { backgroundColor: c.emerald, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  seuilSaveLabel: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 16, lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },

  /* Onglets */
  tabBar: { flexDirection: 'row', gap: 6, marginBottom: 20, flexWrap: 'wrap' },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder },
  tabBtnActive: { borderColor: c.emerald, backgroundColor: c.emerald + '1A' },
  tabLabel: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  tabLabelActive: { color: c.emerald },

  /* Ordre de déduction */
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  orderRank: { fontSize: 13, fontWeight: '800', color: c.textSecondary, width: 16 },
  orderTypeLabel: { fontSize: 14, fontWeight: '700', flex: 1 },
  orderArrows: { flexDirection: 'row', gap: 6 },
  orderArrowBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },
  orderArrowDisabled: { opacity: 0.4 },
  modeChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder },
  modeChipLabel: { fontSize: 12.5, fontWeight: '700' },

  typeCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
  },
  typeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  typeTitle: { fontSize: 14, fontWeight: '700' },
  typeDesc: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },

  tierCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  tierName: { fontSize: 14, fontWeight: '700', flex: 1 },
  allocRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  allocItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  allocDot: { width: 8, height: 8, borderRadius: 4 },
  allocText: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },

  inputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  inputItem: { width: '46%' },
  inputLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  inputLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder, paddingHorizontal: 10 },
  input: { flex: 1, color: c.text, fontSize: 16, fontWeight: '700', paddingVertical: 8 },
  inputSuffix: { color: c.textSecondary, fontSize: 14 },

  modNote: { fontSize: 12, color: c.textSecondary, marginBottom: 10, fontStyle: 'italic' },
  modCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  modName: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 4 },
  modDesc: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },

  rulesCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    gap: 6,
  },
  ruleItem: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },
});
}
