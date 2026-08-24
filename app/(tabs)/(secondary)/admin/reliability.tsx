/**
 * Admin — Fiabilité & confiance.
 *  - Seuils de doute (confiance haute/basse), biais et arrondi des fourchettes.
 *  - Catalogue documenté des NOTIFICATIONS SYSTÈME (soft_close, confidence_low…) avec activation.
 * Stocké dans app_config.reliability / app_config.system_notifications.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useReliabilityConfig, useSaveReliabilityConfig } from '../../../../hooks/pilotage/useReliability';
import { RELIABILITY_DEFAULTS, type ReliabilityConfig } from '../../../../lib/finance/confidenceEngine';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { sanitizeAmountInput } from '../../../../lib/ui/amountInput';

// Champs dans l'ORDRE du calcul : base → ancienneté → dérive → seuils du ratio → fourchette.
const NUM_FIELDS: { key: keyof ReliabilityConfig; label: string; help: string; pct?: boolean }[] = [
  { key: 'absoluteFloor', label: 'Base minimale (€)', help: '① le doute est toujours comparé à au moins ce montant (évite les % absurdes quand le Relyka est proche de 0)' },
  { key: 'coldStartDays', label: 'Plafond d’ancienneté (jours)', help: '② on ne compte jamais plus de X jours depuis la dernière vérif (le doute sature au lieu d’exploser) · la création du compte = vérif n° 0 · plafonne aussi l’amorçage à la 1ʳᵉ régul' },
  { key: 'coldStartWeeklyFraction', label: 'Méfiance de départ / semaine', help: '③ avant la 1ʳᵉ régularisation : part supposée « perdue de vue » chaque semaine — appliquée à l’enveloppe de dépenses VARIABLES du mois (ce qui peut réellement échapper à la saisie), ou à la base globale si l’enveloppe est inconnue', pct: true },
  { key: 'highMax', label: 'Chiffres nets si doute sous…', help: '④ doute inférieur à cette part de la base → montants précis, sans fourchette', pct: true },
  { key: 'lowMin', label: 'Alerte si doute au-delà de…', help: '⑤ doute au-delà de cette part → fourchette large + invitation à vérifier son solde', pct: true },
  /* « Ouverture vers le haut » (upBias) a été RETIRÉE : la fourchette ne monte plus jamais au-dessus
     du Relyka affiché. Un réglage qui promettait davantage que le chiffre montré n'était pas un
     garde-fou. Le haut de la fourchette EST le Relyka. */
  { key: 'minActionRatio', label: 'Plancher des montants proposés', help: '⑥ un virement/une réservation pré-remplis ne descendent jamais sous cette part du montant recommandé, même si la fourchette descend à 0 (le doute se mesure sur la base, pas sur le Relyka : sans plancher, un petit Relyka faisait proposer 0 €) · 1 = plancher désactivé (montant plein)', pct: true },
  { key: 'roundStep', label: 'Arrondi des fourchettes (€)', help: '⑦ bornes arrondies à ce pas (100 = à la centaine)' },
  { key: 'activityDampening', label: 'Amortisseur d’activité', help: '⑧ saisie manuelle du jour (mois courant) → le doute est multiplié par ce facteur (0,5 = moitié), puis revient à 1 sur la fenêtre · resserre la fourchette, peut remonter bas → moyen, jamais → haut (« À jour » = vraie vérif) · 1 = désactivé' },
  { key: 'activityWindowDays', label: 'Fenêtre d’activité (jours)', help: '⑨ au-delà de X jours sans saisie manuelle, l’amortisseur ne s’applique plus' },
];

export default function AdminReliability() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { data: cfg } = useReliabilityConfig();
  const saveCfg = useSaveReliabilityConfig();

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    // Ne pas écraser une saisie en cours (refetchOnWindowFocus recharge cfg à chaque retour de focus).
    if (cfg && !dirty) {
      const d: Record<string, string> = {};
      for (const f of NUM_FIELDS) d[f.key] = String(cfg[f.key]);
      setDraft(d);
    }
  }, [cfg, dirty]);

  const saveAll = () => {
    const patch: Partial<ReliabilityConfig> = {};
    for (const f of NUM_FIELDS) {
      const raw = (draft[f.key] ?? '').replace(',', '.');
      const v = parseFloat(raw);
      if (!Number.isNaN(v)) (patch as any)[f.key] = v;
    }
    if (Object.keys(patch).length === 0) return;
    saveCfg.mutate(patch, {
      onSuccess: () => { setDirty(false); setSavedAt(Date.now()); },
    });
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Fiabilité & confiance" onBack={goBack} />
        <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={styles.helpToggle} onPress={() => setShowHelp((v) => !v)}>
            <Ionicons name={showHelp ? 'chevron-down' : 'chevron-forward'} size={16} color={COLORS.emerald} />
            <Text style={styles.helpToggleTxt}>Comment ça marche ?</Text>
          </TouchableOpacity>
          {showHelp && (
            <>
              <Text style={styles.p}>
                L’app calcule un « doute » : combien d’euros d’erreur ont pu s’accumuler depuis la dernière
                vérification du solde (régularisation). Petit doute → chiffres nets. Gros doute → fourchettes.
                Une seule formule alimente le Relyka, les recommandations et la projection.
              </Text>
              <Text style={styles.p}>
                La vitesse d’accumulation est apprise par utilisateur dès sa première régularisation (écarts
                réellement trouvés). Avant ça, les réglages « de départ » ci-dessous s’appliquent.
              </Text>
              <Text style={styles.p}>
                La « base » = la taille du budget de l’utilisateur : le plus grand entre son Relyka, son
                revenu mensuel moyen et son enveloppe variable (jamais moins que la base minimale). Le doute
                est jugé en proportion de cette base, pas en euros : 100 € de doute, c’est énorme sur un
                budget de 500 €, négligeable sur 5 000 €. On ne compare pas au seul Relyka car il frôle 0 en
                fin de mois — le moindre doute paraîtrait infini.
              </Text>
              <View style={styles.calcCard}>
                <Text style={styles.calcTitle}>Le calcul, pas à pas</Text>
                <Text style={styles.calcLine}>1 · dérive/jour = médiane des |écarts trouvés| ÷ médiane des jours entre vérifs</Text>
                <Text style={styles.calcSub}>(avant la 1ʳᵉ régul : enveloppe variable du mois × méfiance de départ ÷ 7 — à défaut, la base)</Text>
                <Text style={styles.calcLine}>2 · doute (€) = dérive/jour × jours depuis la dernière vérif (plafonnés au « Plafond d’ancienneté » ; la création du compte compte comme vérif n° 0)</Text>
                <Text style={styles.calcLine}>3 · ratio = doute ÷ base → sous le 1ᵉʳ seuil : chiffres nets · entre les deux : fourchette · au-delà du 2ᵉ : fourchette large + alerte</Text>
                <Text style={styles.calcLine}>4 · fourchette = [montant − doute ; MONTANT]. Elle ne monte JAMAIS au-dessus du chiffre affiché : ce qui n’est pas saisi fait baisser le solde, pas monter. La borne basse est arrondie vers le bas (jamais négative ; à 0 on n’affiche que « jusqu’à … »).</Text>
                <Text style={styles.calcLine}>5 · montants PROPOSÉS aux actions (virement, réservation) = borne basse, mais jamais sous le « plancher des montants proposés ». « Conserver » fait exception : garder de l’argent ne le sort pas du compte, donc le doute ne doit pas faire conserver MOINS → montant plein.</Text>

                <Text style={[styles.calcTitle, { marginTop: 12 }]}>Exemple : Léa, 2 500 € de revenu/mois (= sa base)</Text>

                <Text style={styles.calcCase}>Avant sa 1ʳᵉ régul</Text>
                <Text style={styles.calcLine}>
                  À la création de son compte, Léa recopie son solde depuis sa banque : c’est la vérif n° 0,
                  le doute part de zéro. Ensuite l’app suppose qu’elle « perd de vue » 5 % par semaine de son
                  enveloppe de dépenses variables (2 500 € de revenu, mais 1 200 € de variables : c’est là que
                  se cachent les oublis, pas dans le loyer prélevé), soit 1 200 × 0,05 ÷ 7 ≈ 9 € par jour.
                </Text>
                <Text style={styles.calcSub}>3 jours après la création : doute = 9 × 3 ≈ 27 € · ratio 0,01 → chiffres nets. Sans jamais vérifier, le doute grimpe puis sature au plafond d’ancienneté : 9 × 31 ≈ 266 € · ratio 0,11 → fourchette + invitation à vérifier. Le ratio se juge toujours sur la BASE (2 500 €), c’est seulement la vitesse d’accumulation qui suit les variables.</Text>

                <Text style={styles.calcCase}>Après sa 1ʳᵉ régul</Text>
                <Text style={styles.calcLine}>
                  30 jours après la création, Léa régularise : il manquait 100 €. Un seul point de mesure, pas
                  encore d’intervalle entre deux vérifs — alors l’app se dit : « ces 100 € se sont accumulés
                  depuis la vérif n° 0, il y a 30 jours » → dérive = 100 ÷ 30 ≈ 3,3 € par jour.
                </Text>
                <Text style={styles.calcSub}>8 jours plus tard : doute = 3,3 × 8 ≈ 27 € · ratio = 27 ÷ 2 500 = 0,011 → chiffres nets.</Text>

                <Text style={styles.calcCase}>Après sa 2ᵉ régul</Text>
                <Text style={styles.calcLine}>
                  30 jours après la première, Léa régularise à nouveau : écart 90 €. Cette fois l’app a une
                  vraie mesure entre deux vérifs : 90 € en 30 jours → dérive = 3 € par jour. Si l’écart avait
                  été 0 €, la dérive tomberait vers 0 → confiance durable.
                </Text>
                <Text style={styles.calcSub}>8 jours plus tard : doute = 3 × 8 = 24 € · ratio ≈ 0,01 → chiffres nets, même si son Relyka ne fait que 220 €. Et si elle laisse traîner, le doute sature à 3 × 31 ≈ 93 € (plafond).</Text>
              </View>
            </>
          )}

          <Text style={styles.section}>Réglages du doute</Text>
          {NUM_FIELDS.map((f) => (
            <View key={f.key} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{f.label}</Text>
                <Text style={styles.help}>{f.help} · défaut {String(RELIABILITY_DEFAULTS[f.key])}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={draft[f.key] ?? ''}
                onChangeText={(v) => { setDirty(true); setDraft((p) => ({ ...p, [f.key]: sanitizeAmountInput(v) })); }}
                keyboardType="decimal-pad"
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>
          ))}
          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || saveCfg.isPending) && styles.saveBtnDisabled]}
            onPress={saveAll}
            disabled={!dirty || saveCfg.isPending}
          >
            {saveCfg.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Ionicons name="checkmark" size={18} color="#fff" />}
            <Text style={styles.saveBtnTxt}>{saveCfg.isPending ? 'Enregistrement…' : 'Enregistrer'}</Text>
          </TouchableOpacity>
          {!dirty && savedAt != null && !saveCfg.isPending && (
            <Text style={styles.savedTxt}>Modifications enregistrées ✓</Text>
          )}
          {saveCfg.isError && (
            <Text style={styles.errorTxt}>Échec de l’enregistrement — réessaie.</Text>
          )}

          <Text style={styles.section}>Notifications système</Text>
          <Text style={styles.p}>
            Le catalogue des notifications automatiques (soft_close, confidence_low, …) se gère désormais
            dans Admin → Notifications, section « Notifications automatiques (système) ».
          </Text>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    p: { fontSize: 13, color: c.textSecondary, marginTop: 6, lineHeight: 19 },
    helpToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
    helpToggleTxt: { fontSize: 13.5, fontWeight: '700', color: c.emerald },
    calcCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginTop: 10 },
    calcTitle: { fontSize: 12.5, fontWeight: '800', color: c.text, marginBottom: 6 },
    calcLine: { fontSize: 12.5, color: c.text, lineHeight: 18, marginTop: 4 },
    calcSub: { fontSize: 11.5, color: c.textSecondary, fontStyle: 'italic', lineHeight: 16, marginTop: 2 },
    calcCase: { fontSize: 12.5, fontWeight: '800', color: c.emerald, marginTop: 10 },
    section: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
    label: { fontSize: 14, fontWeight: '600', color: c.text },
    help: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    input: { width: 90, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'right', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 12, marginTop: 16 },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
    savedTxt: { fontSize: 12.5, color: c.emerald, fontWeight: '600', textAlign: 'center', marginTop: 8 },
    errorTxt: { fontSize: 12.5, color: c.red, fontWeight: '600', textAlign: 'center', marginTop: 8 },
    notifCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    notifHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    notifTitle: { fontSize: 14.5, fontWeight: '800', color: c.text, flex: 1, marginRight: 10 },
    notifId: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: c.emerald, marginTop: 2 },
    notifBody: { fontSize: 12.5, color: c.text, fontStyle: 'italic', marginTop: 6 },
    notifMeta: { fontSize: 11.5, color: c.textSecondary, marginTop: 4 },
  });
}
