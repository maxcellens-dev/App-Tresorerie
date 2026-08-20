/**
 * PROFIL FINANCIER — ce qui décide de la RÉPARTITION de ton Relyka (jamais des montants).
 *
 * L'écran ne présente plus un questionnaire de neuf questions : la plupart des réponses sont
 * désormais MESURÉES sur les données réelles (matelas de sécurité = épargne ÷ DÉPENSES, revenu de
 * référence = recettes constatées). Seules restent modifiables les rares choses que l'app ne peut
 * pas deviner : ta marge de sécurité et ton enveloppe de dépenses variables. Toutes deux vivent
 * dans `profiles`, la MÊME source que le reste de l'app — jamais dans d'anciennes réponses.
 *
 * Le profil n'est plus figé : il se recalcule dès que les données bougent (useLiveProfileSync),
 * puis le bilan mensuel prend le relais.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import InfoDot from '../../../components/ui/InfoDot';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useFinancialProfile, useQuestionnaireAnswers } from '../../../hooks/pilotage/useFinancialProfile';
import { usePilotageData } from '../../../hooks/pilotage/usePilotageData';
import { useProfile, useUpdateProfile } from '../../../hooks/data/useProfile';
import {
  PROFILE_INFO, PROFILE_ALLOCATIONS, resolveProfileId,
  WEEKS_PER_MONTH,
} from '../../../lib/finance/financialProfileEngine';
import { computeSecurityCushion, securityMonthsLabel, securityBaseLabel } from '../../../lib/finance/securityCushion';
import type { QuestionnaireAnswers } from '../../../lib/finance/financialProfileEngine';
import { resolveMonthlyAllocation } from '../../../lib/finance/financialPriorities';
import type { FinancialProfileId } from '../../../types/database';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useCurrencySymbol } from '../../../hooks/data/useCurrency';

export default withDeferredMount(ProfilFinancierScreen);

function ProfilFinancierScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const symbol = useCurrencySymbol();
  const goBack = useNavBack();
  const { user } = useAuth();

  const { data: fp, isLoading: fpLoading } = useFinancialProfile(user?.id);
  const { data: saved, isLoading: answersLoading } = useQuestionnaireAnswers(user?.id);
  const { data: pilotage } = usePilotageData(user?.id);
  /* ⚠️ La marge de sécurité et l'enveloppe variable vivent dans `profiles` — c'est là que tout le
     reste de l'app les écrit et les lit (le guide de démarrage, le Pilotage, le moteur du Relyka).
     Cet écran allait les chercher dans les anciennes réponses q8/q9 du questionnaire : DEUX
     stockages différents, d'où des cases vides ici alors que l'utilisateur venait de les saisir
     pendant le tour, et un doublon avec la ligne mesurée juste au-dessus. Une seule source. */
  const { data: userProfile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);

  /* (Le recalcul du profil n'est pas déclenché ici : un observateur global surveille les comptes et
     les transactions et le relance dès qu'ils bougent — cf. components/LiveProfileSync.) */

  /** Panneau d'édition ouvert (une seule ligne à la fois). */
  const [editing, setEditing] = useState<null | 'q8' | 'q9'>(null);
  const [amountDraft, setAmountDraft] = useState('');
  const [saving, setSaving] = useState(false);

  /* FOCUS SANS SAUT DE DÉFILEMENT (cf. le commentaire de `amountPanel`).
     `preventScroll` est une option du DOM : sur le web, `.focus({ preventScroll: true })` empêche
     le navigateur de faire remonter la page de son côté. Sur natif, `focus()` ne prend pas
     d'options et les ignore — le repli couvre les deux mondes sans branche par plateforme. */
  const amountInputRef = useRef<any>(null);
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => {
      const node = amountInputRef.current;
      if (!node?.focus) return;
      try { node.focus({ preventScroll: true }); } catch { node.focus(); }
    }, 60);
    return () => clearTimeout(t);
  }, [editing]);

  // Renvoi « complète ton profil » (ex. enveloppe variable manquante depuis le Pilotage).
  const params = useLocalSearchParams<{ edit?: string }>();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (params.edit && saved && !autoOpened.current) {
      autoOpened.current = true;
      setEditing(params.edit === 'q9' ? 'q9' : 'q8');
    }
  }, [params.edit, saved]);

  if (fpLoading || answersLoading) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.emerald} />
      </View>
    );
  }

  // Ramené sur le référentiel de ce bundle (cf. resolveProfileId) : sinon un identifiant inconnu
  // renvoyait l'utilisateur sur l'écran « ton profil se calcule tout seul », profil à l'appui.
  const profileId = fp?.profile_id ? resolveProfileId(fp.profile_id) : undefined;
  const info = profileId ? PROFILE_INFO[profileId] : null;
  const a = (saved ?? {}) as Partial<QuestionnaireAnswers>;

  /** Matelas MESURÉ sur les données réelles — c'est lui qui remplace l'ancienne question q5. */
  const cushion = computeSecurityCushion({
    availableSavings: pilotage?.current_savings ?? 0,
    monthlyEssentialExpenses: pilotage?.monthly_essential_expenses ?? 0,
    avgMonthlyIncome: pilotage?.avg_monthly_income ?? 0,
    questionnaireQ3: a.q3 ?? null,
  });

  /* ── LES POURCENTAGES AFFICHÉS SONT CEUX QUI SONT APPLIQUÉS ────────────────────────────────
     Cet écran lisait `PROFILE_ALLOCATIONS[profileId]` — la table BRUTE du palier. Or la
     répartition réellement utilisée par les recommandations passe par les BORNES DE LA PRIORITÉ
     du mois (cf. resolveMonthlyAllocation) : un P6 en déficit structurel se voit recommander 0 %
     d'investissement, pendant que cette page continuait d'annoncer 30 %. Deux chiffres pour la
     même chose, sur deux écrans — exactement ce que le profil est censé expliquer.
     `resolveMonthlyAllocation` est le point d'entrée unique prévu pour ça ; il n'était appelé
     nulle part. Sans données de Pilotage, on retombe sur la table du palier. */
  const situation = pilotage ? {
    monthsOfReserve: cushion.months,
    monthlySurplus: pilotage.projected_surplus ?? 0,
    avgMonthlyIncome: pilotage.avg_monthly_income ?? 0,
    monthlyEssentialExpenses: pilotage.monthly_essential_expenses ?? 0,
    checkingBalance: pilotage.current_checking_balance ?? 0,
    savingsBalance: pilotage.current_savings ?? 0,
    investedBalance: pilotage.total_invested ?? 0,
    irregularIncome: Boolean((fp as any)?.is_irregular_income),
  } : null;
  const resolved = profileId && situation ? resolveMonthlyAllocation(profileId, situation) : null;
  const alloc = resolved?.alloc ?? (profileId ? PROFILE_ALLOCATIONS[profileId] : null);

  const margin = Number((userProfile as any)?.safety_margin_amount ?? 0);
  const weekly = Number((userProfile as any)?.weekly_variable_budget ?? 0);

  /** Enregistre une valeur LÀ OÙ TOUTE L'APP la lit (profiles), puis laisse le profil se recalculer. */
  async function persistAmount(key: 'margin' | 'weekly', raw: string) {
    const n = Math.max(0, Math.round(parseFloat(String(raw).replace(',', '.')) || 0));
    setSaving(true);
    try {
      await updateProfile.mutateAsync(
        key === 'margin' ? { safety_margin_amount: n } : { weekly_variable_budget: n > 0 ? n : null },
      );
      setEditing(null);
    } catch (e: unknown) {
      Alert.alert('Un souci', (e as any)?.message ?? 'Impossible d’enregistrer.');
    } finally {
      setSaving(false);
    }
  }

  /* ── Profil absent (cas résiduel : compte créé avant le socle) ── */
  if (!profileId || !info || !alloc) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Profil financier" onBack={goBack} />
          {/* DÉFILANT : le conteneur est à hauteur fixe, sans lui la fin du paragraphe se faisait
              couper en bas sur les écrans étroits. Deux paragraphes distincts plutôt qu'un `\n\n`
              dans un seul Text : chacun se mesure et s'affiche pour lui-même. */}
          <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>Ton profil se calcule tout seul</Text>
              <Text style={styles.emptyText}>
                Il décide de la répartition entre Épargner, Investir, Confort et Conserver, et il se
                déduit de tes données : le solde de tes comptes, ton revenu et ce que tu mets de côté.
              </Text>
              <Text style={styles.emptyText}>
                Aucune question à remplir : renseigne tes comptes et tes revenus récurrents, et ton
                profil apparaît ici.
              </Text>
              <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/comptes' as any)} activeOpacity={0.85}>
                <Text style={styles.ctaText}>Voir mes comptes</Text>
                <Ionicons name="arrow-forward" size={17} color={COLORS.bg} />
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    );
  }

  const ALLOC_ROWS = [
    { label: 'Épargner', key: 'save' as const, color: COLORS.green ?? COLORS.emerald },
    { label: 'Investir', key: 'invest' as const, color: COLORS.violet },
    { label: 'Confort', key: 'enjoy' as const, color: COLORS.orange },
    { label: 'Conserver', key: 'keep' as const, color: COLORS.blue },
  ];

  /** Ligne « fait » : une donnée mesurée, non modifiable, avec sa provenance. */
  const measuredRow = (label: string, value: string, source: string, term?: any) => (
    <View style={styles.row} key={label}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowLabelLine}>
          <Text style={styles.rowLabel}>{label}</Text>
          {!!term && <InfoDot term={term} size={13} />}
        </View>
        <Text style={styles.rowSource}>{source}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );

  /** Ligne modifiable : ouvre son panneau de choix / de saisie. */
  const editableRow = (
    key: 'q8' | 'q9',
    label: string,
    value: string,
    term?: any,
  ) => (
    <TouchableOpacity
      key={key}
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => {
        setAmountDraft(key === 'q8' ? (margin > 0 ? String(margin) : '') : key === 'q9' ? (weekly > 0 ? String(weekly) : '') : '');
        setEditing(editing === key ? null : key);
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.rowLabelLine}>
          <Text style={styles.rowLabel}>{label}</Text>
          {!!term && <InfoDot term={term} size={13} />}
        </View>
      </View>
      <Text style={[styles.rowValue, { color: COLORS.emerald }]}>{value}</Text>
      <Ionicons name={editing === key ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
    </TouchableOpacity>
  );


  const amountPanel = (unit: string, hint: string, onSave: (v: string) => void) => (
    <View style={styles.panel}>
      <View style={styles.amountRow}>
        {/* PAS d'`autoFocus` ICI — c'est lui qui provoquait l'aller-retour à l'ouverture du panneau.
            Le focus automatique déclenche la mise en vue NATIVE du champ (le navigateur ou la
            plateforme scrolle de son côté), puis notre KeyboardAwareScrollView le remonte à sa
            propre position quand le clavier s'ouvre : deux défilements concurrents, d'où le saut
            vers le haut suivi d'un retour. On garde le focus (personne n'a envie de retaper sur le
            champ), mais on le pose nous-mêmes juste après le montage, en demandant explicitement à
            la plateforme de NE PAS scroller — un seul défilement, celui du clavier. */}
        <TextInput
          ref={amountInputRef}
          style={styles.amountInput}
          value={amountDraft}
          onChangeText={(v) => setAmountDraft(v.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={COLORS.textSecondary}
        />
        <Text style={styles.amountUnit}>{unit}</Text>
      </View>
      <Text style={styles.panelHint}>{hint}</Text>
      <TouchableOpacity style={styles.saveBtn} onPress={() => onSave(amountDraft)} disabled={saving} activeOpacity={0.85}>
        <Text style={styles.saveBtnText}>{saving ? 'Un instant…' : 'Enregistrer'}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Profil financier" onBack={goBack} />

        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Le profil ── */}
          <View style={[styles.hero, { borderColor: info.color + '55' }]}>
            <Text style={styles.heroEmoji}>{info.emoji}</Text>
            <View style={{ flex: 1 }}>
              <View style={styles.rowLabelLine}>
                <Text style={[styles.heroName, { color: info.color }]}>{info.name}</Text>
                <InfoDot term="profil_financier" size={14} color={info.color} />
              </View>
              <Text style={styles.heroDesc}>{info.description}</Text>
            </View>
          </View>

          {/* ── Ce qu'il change concrètement ── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ce qu’il change</Text>
            {/* Le profil PROPOSE, la situation du mois DISPOSE : dire « il fixe la répartition »
                serait faux depuis que la priorité du mois borne les pourcentages — et l'écran
                annoncerait autre chose que ce que le Pilotage applique. */}
            <Text style={styles.cardLead}>
              Il oriente la <Text style={styles.b}>répartition</Text> de ton Relyka entre les quatre
              décisions — jamais les montants, qui viennent de ta trésorerie réelle.
            </Text>
            {resolved && (
              <Text style={styles.cardLead}>
                Ce mois-ci, la priorité <Text style={styles.b}>{resolved.priority.label.toLowerCase()}</Text> ajuste
                ces pourcentages : {resolved.priority.reason}
              </Text>
            )}
            {ALLOC_ROWS.map(({ label, key, color }) => (
              <View key={key} style={styles.allocRow}>
                <Text style={styles.allocLabel}>{label}</Text>
                <View style={styles.allocTrack}>
                  <View style={[styles.allocFill, { width: `${alloc[key]}%`, backgroundColor: color }]} />
                </View>
                <Text style={[styles.allocPct, { color }]}>{alloc[key]} %</Text>
              </View>
            ))}
          </View>

          {/* ── Ce que l'app MESURE (non modifiable) ── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ce que l’app mesure</Text>
            <Text style={styles.cardLead}>
              Ces éléments sont lus dans tes comptes : ils se mettent à jour tout seuls, et ton
              profil suit.
            </Text>
            {measuredRow(
              'Ton matelas de sécurité',
              cushion.months != null ? securityMonthsLabel(cushion.months) : '—',
              cushion.months != null
                ? securityBaseLabel(cushion.base)
                : 'ajoute un compte d’épargne pour le calculer',
              'matelas',
            )}
            {measuredRow(
              'Ton revenu de référence',
              (pilotage?.avg_monthly_income ?? 0) > 0
                ? `${Math.round(pilotage!.avg_monthly_income).toLocaleString('fr-FR')} ${symbol}`
                : '—',
              (pilotage?.avg_monthly_income ?? 0) > 0
                ? 'moyenne de tes recettes sur 6 mois'
                : 'saisis tes rentrées d’argent pour l’affiner',
            )}
            {measuredRow(
              'Tes dépenses variables',
              (pilotage?.variable_envelope_initial ?? 0) > 0
                ? `${Math.round(pilotage!.variable_envelope_initial).toLocaleString('fr-FR')} ${symbol} / mois`
                : '—',
              pilotage?.variable_envelope_source === 'history'
                ? `moyenne réelle sur ${pilotage.variable_envelope_months_used} mois`
                : 'ton estimation, en attendant 2 mois d’historique',
              'enveloppe_variable',
            )}
          </View>

          {/* ── Ce que TU renseignes ──
              Il ne reste que ce que l'app ne peut PAS mesurer. Le rythme de revenus, le
              comportement de fin de mois et la capacité d'épargne étaient des questions déclarées :
              elles n'entrent plus dans le calcul du profil (il se déduit des données réelles), donc
              les demander ne servait plus à rien. */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ce que tu nous dis</Text>
            <Text style={styles.cardLead}>
              Les deux seules choses que l'app ne peut pas deviner. Appuie pour les modifier.
            </Text>

            {editableRow(
              'q8', 'Ta marge de sécurité',
              margin > 0 ? `${margin.toLocaleString('fr-FR')} ${symbol}` : 'aucune',
              'marge_securite',
            )}
            {editing === 'q8' && amountPanel(
              symbol,
              'Le montant que tu veux avoir au minimum sur tes comptes courants en fin de mois. Il reste sur ton compte : on te dit juste ce que tu peux utiliser avant d’y toucher.',
              (v) => persistAmount('margin', v),
            )}

            {editableRow(
              'q9', 'Ton estimation de dépenses variables',
              weekly > 0 ? `${weekly.toLocaleString('fr-FR')} ${symbol} / sem.` : 'estimée pour toi',
              'enveloppe_variable',
            )}
            {editing === 'q9' && amountPanel(
              `${symbol} / semaine`,
              `Courses, sorties, imprévus. ${amountDraft ? `Soit environ ${Math.round((parseFloat(amountDraft.replace(',', '.')) || 0) * WEEKS_PER_MONTH).toLocaleString('fr-FR')} ${symbol} par mois. ` : ''}Sert tant que tu n’as pas 2 mois d’historique réel.`,
              (v) => persistAmount('weekly', v),
            )}
          </View>

          {/* ── Comment il évolue ── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Comment il évolue</Text>
            <Text style={styles.cardLead}>
              Il n’est pas figé. Dès qu’une donnée réelle change — un virement d’épargne, une mise à
              jour de solde — il se recalcule, et tu es prévenu s’il bouge.
            </Text>
            {(fp?.is_irregular_income ?? false) && (
              <View style={styles.note}>
                <Ionicons name="pulse-outline" size={14} color={COLORS.teal} />
                <Text style={styles.noteText}>
                  Revenus irréguliers : les baisses de revenus seront repérées plus tôt.
                </Text>
              </View>
            )}
          </View>

          <View style={{ height: 40 }} />
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    scroll: { flex: 1 },
    content: { gap: 14, paddingBottom: 20 },

    hero: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: c.card, borderWidth: 1, borderRadius: 20, padding: 16,
    },
    heroEmoji: { fontSize: 34 },
    heroName: { fontSize: 18, fontWeight: '800' },
    heroDesc: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginTop: 3 },

    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 20, padding: 16, gap: 9,
    },
    cardTitle: { fontSize: 15.5, fontWeight: '800', color: c.text },
    cardLead: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    b: { fontWeight: '800', color: c.text },

    allocRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    allocLabel: { width: 78, fontSize: 13, color: c.text },
    allocTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden' },
    allocFill: { height: 6, borderRadius: 3 },
    allocPct: { width: 42, fontSize: 13, fontWeight: '800', textAlign: 'right' },

    row: {
      flexDirection: 'row', alignItems: 'center', gap: 9,
      paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.cardBorder,
    },
    rowLabelLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    /* `flexShrink: 1` — sans lui, un Text en ligne garde sa largeur INTRINSÈQUE (flexShrink vaut 0
       par défaut en React Native) : un libellé long comme « Ton estimation de dépenses variables »
       débordait de sa colonne et poussait la pastille « ? » par-dessus le montant, à droite. Il se
       rétrécit désormais dans l'espace disponible, et la pastille reste dans la colonne du libellé,
       alignée comme sur les autres lignes. */
    rowLabel: { fontSize: 13.5, fontWeight: '600', color: c.text, flexShrink: 1 },
    rowSource: { fontSize: 11.5, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    rowValue: { fontSize: 13.5, fontWeight: '800', color: c.text },

    panel: {
      gap: 7, paddingTop: 4, paddingBottom: 10,
      borderTopWidth: 1, borderTopColor: c.cardBorder,
    },
    choice: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    },
    choiceActive: { borderColor: c.emerald, backgroundColor: c.selected },
    choiceText: { flex: 1, fontSize: 13.5, color: c.textSecondary },
    panelHint: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    amountRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.bg, borderWidth: 1.5, borderColor: c.emerald,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    },
    amountInput: { flex: 1, fontSize: 24, fontWeight: '800', color: c.text, padding: 0 },
    amountUnit: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 13, paddingVertical: 12, alignItems: 'center' },
    saveBtnText: { fontSize: 14.5, fontWeight: '800', color: c.bg },

    note: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: c.teal + '12', borderRadius: 12, padding: 11,
    },
    noteText: { flex: 1, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },

    emptyTitle: { fontSize: 17, fontWeight: '800', color: c.text },
    emptyText: { fontSize: 13.5, color: c.textSecondary, lineHeight: 20 },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.emerald, borderRadius: 15, paddingVertical: 14, marginTop: 4,
    },
    ctaText: { fontSize: 15, fontWeight: '800', color: c.bg },
  });
}
