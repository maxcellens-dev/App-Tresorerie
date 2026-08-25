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
import { useFinancialProfile, useProfileAllocations } from '../../../hooks/pilotage/useFinancialProfile';
import { usePilotageData } from '../../../hooks/pilotage/usePilotageData';
import { useProfile, useUpdateProfile } from '../../../hooks/data/useProfile';
import {
  PROFILE_INFO, resolveProfileId,
  WEEKS_PER_MONTH,
} from '../../../lib/finance/financialProfileEngine';
import { computeSecurityCushion, securityMonthsLabel, securityBaseLabel } from '../../../lib/finance/securityCushion';
import { resolveRecoMode, appliedAllocation } from '../../../lib/finance/recoMode';
import { useProfileReliability } from '../../../hooks/pilotage/useProfileReliability';
import type { ProfileReliabilityTone } from '../../../lib/finance/profileReliability';
import RecoModeModal from '../../../components/pilotage/RecoModeModal';
import ProfileReliabilitySheet from '../../../components/ui/ProfileReliabilitySheet';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useCurrencySymbol } from '../../../hooks/data/useCurrency';
import { sanitizeAmountInput } from '../../../lib/ui/amountInput';

export default withDeferredMount(ProfilFinancierScreen);

function ProfilFinancierScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const symbol = useCurrencySymbol();
  const goBack = useNavBack();
  const { user, isImpersonating } = useAuth();

  const { data: fp, isLoading: fpLoading } = useFinancialProfile(user?.id);
  /* Les anciennes réponses du questionnaire ne sont PLUS lues ici. Cet écran s'en servait pour un
     seul usage : donner au matelas un dernier repli sur la tranche de revenu déclarée (q3), quand
     aucun revenu n'est constaté. Or dans ce cas précis le classement, lui, refuse de conclure
     (P0 « Découverte ») — la page affichait donc « ≈ 3,3 mois de sécurité » sous un profil qui dit
     ne rien savoir. Deux mesures du même matelas sur la même page, dont une que le moteur n'utilise
     pas. On lit désormais exactement ce que le moteur lit, et rien d'autre. */
  const { data: pilotage } = usePilotageData(user?.id);
  /* ⚠️ La marge de sécurité et l'enveloppe variable vivent dans `profiles` — c'est là que tout le
     reste de l'app les écrit et les lit (le guide de démarrage, le Pilotage, le moteur du Relyka).
     Cet écran allait les chercher dans les anciennes réponses du questionnaire : DEUX
     stockages différents, d'où des cases vides ici alors que l'utilisateur venait de les saisir
     pendant le tour, et un doublon avec la ligne mesurée juste au-dessus. Une seule source. */
  const { data: userProfile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  /* Fiabilité du profil : sur quoi le classement repose. Indépendante du palier — elle ne le
     déplace jamais (cf. lib/finance/profileReliability). */
  const reliability = useProfileReliability(user?.id);
  /* Répartitions par palier réglées en administration (migration 207) : cet écran affiche ce que le
     moteur applique, il doit donc lire la MÊME table que lui. */
  const { data: allocTable } = useProfileAllocations();

  /* (Le recalcul du profil n'est pas déclenché ici : un observateur global surveille les comptes et
     les transactions et le relance dès qu'ils bougent — cf. components/LiveProfileSync.) */

  /* Panneau d'édition ouvert (une seule ligne à la fois).
     ⚠️ Les clés s'appelaient 'q8' et 'q9' — les numéros des questions du questionnaire d'accueil.
     Elles ne désignent plus rien : ces deux montants vivent dans `profiles`, et le questionnaire
     n'existe plus. Un identifiant qui porte le nom d'un système disparu finit par faire croire
     qu'on édite ce système. */
  const [editing, setEditing] = useState<null | 'margin' | 'variable'>(null);
  /** Réglage de la répartition (profil ↔ pourcentages choisis) — même modale que le tableau de bord. */
  const [showRecoMode, setShowRecoMode] = useState(false);
  /** Détail de la fiabilité : le niveau reste sur la carte, le pourquoi s'ouvre à la demande. */
  const [showReliability, setShowReliability] = useState(false);
  const [amountDraft, setAmountDraft] = useState('');
  const [saving, setSaving] = useState(false);
  /** Verrou SYNCHRONE contre la double soumission (cf. persistAmount). */
  const savingRef = useRef(false);

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
    if (params.edit && !autoOpened.current) {
      autoOpened.current = true;
      // On accepte encore les anciens noms au cas où un lien traînerait quelque part.
      setEditing(params.edit === 'variable' || params.edit === 'q9' ? 'variable' : 'margin');
    }
  }, [params.edit]);

  if (fpLoading) {
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

  /** Matelas MESURÉ sur les données réelles : épargne ÷ dépenses essentielles (cf. securityCushion). */
  const cushion = computeSecurityCushion({
    availableSavings: pilotage?.current_savings ?? 0,
    monthlyEssentialExpenses: pilotage?.monthly_essential_expenses ?? 0,
    /* MÊME garde que le moteur de profil : sans charge récurrente saisie, les « dépenses
       essentielles » se réduisent à l'enveloppe variable et le matelas gonfle. On retombe alors sur
       le revenu, dénominateur prudent — sinon cet écran annoncerait un matelas que le classement,
       lui, aurait refusé d'utiliser. */
    recurringExpensesKnown: !!pilotage?.has_recurring_expenses,
    avgMonthlyIncome: pilotage?.avg_monthly_income ?? 0,
  });

  /* ── LES POURCENTAGES AFFICHÉS SONT CEUX QUI SONT APPLIQUÉS ────────────────────────────────
     Même point d'entrée que le moteur de recommandations (`appliedAllocation`) : le réglage manuel
     s'il existe, sinon la table du palier — celle de l'administration si elle a pu être chargée.
     C'est ce qui garantit que cette page ne peut pas annoncer 30 % pendant que le tableau de bord
     en applique 45. */
  const recoMode = resolveRecoMode(userProfile);
  const alloc = profileId ? appliedAllocation(profileId, recoMode.manualAllocation, allocTable) : null;

  const margin = Number((userProfile as any)?.safety_margin_amount ?? 0);
  const weekly = Number((userProfile as any)?.weekly_variable_budget ?? 0);

  /** Enregistre une valeur LÀ OÙ TOUTE L'APP la lit (profiles), puis laisse le profil se recalculer. */
  async function persistAmount(key: 'margin' | 'weekly', raw: string) {
    /* ── CONSULTATION SEULE ────────────────────────────────────────────────────────────────────
       Cette page porte les deux MÊMES réglages que le tableau de bord — la marge de sécurité et le
       budget variable — et ils déplacent tous deux le Relyka. Le Pilotage refuse déjà de les écrire
       en « connecté en tant que » ; cet écran-ci le faisait sans rien demander, sur le compte de la
       personne visitée. La règle vaut pour tous les points d'écriture, pas pour un seul. */
    if (isImpersonating) {
      Alert.alert(
        'Consultation seule',
        "Tu es connecté en tant qu'un autre utilisateur : cet écran est en lecture seule. Rien n'est modifié sur son compte.",
      );
      setEditing(null);
      return;
    }
    /* VERROU SYNCHRONE : `disabled={saving}` est un état React, il ne bloque qu'au rendu SUIVANT —
       deux appuis rapprochés passent tous les deux (cf. hooks/useSubmitLock). */
    if (savingRef.current) return;
    savingRef.current = true;
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
      savingRef.current = false;
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
                déduit de tes données : le solde de tes comptes, ton revenu et tes charges.
              </Text>
              {/* On dit le geste qui manque, pas ce qu'on ne demande pas : « aucune question à
                  remplir » répondait à une inquiétude que l'utilisateur n'a pas. */}
              <Text style={styles.emptyText}>
                Renseigne tes comptes et tes rentrées d’argent récurrentes, et ton profil apparaît ici.
              </Text>
              <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/comptes' as any)} activeOpacity={0.85}>
                <Text style={styles.ctaText}>Voir mes comptes</Text>
                <Ionicons name="arrow-forward" size={17} color={COLORS.onAccent} />
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    );
  }

  /* Le module de fiabilité rend un TON sémantique, jamais une couleur : la palette appartient au
     thème (clair/sombre), pas à une bibliothèque de calcul. */
  const toneColor = (tone: ProfileReliabilityTone) =>
    tone === 'good' ? (COLORS.green ?? COLORS.emerald) : tone === 'warn' ? COLORS.orange : COLORS.danger;

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
    key: 'margin' | 'variable',
    label: string,
    value: string,
    term?: any,
  ) => (
    <TouchableOpacity
      key={key}
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => {
        setAmountDraft(key === 'margin' ? (margin > 0 ? String(margin) : '') : (weekly > 0 ? String(weekly) : ''));
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
          onChangeText={(v) => setAmountDraft(sanitizeAmountInput(v))}
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

          {/* ── LA CARTE DU PROFIL ───────────────────────────────────────────────────────────────
              Trois étages, dans l'ordre où on les lit : QUI (emblème, nom), CE QUE ÇA VEUT DIRE
              (description), et CE QUI LE QUALIFIE (fiabilité, mode de répartition).
              Le bouton de réglage est le même qu'en haut de « Tes recommandations » sur le tableau
              de bord : même icône, même modale — c'est le même réglage. */}
          <View style={[styles.hero, { borderColor: info.color + '55' }]}>
            {/* RANGÉE D'IDENTITÉ : l'emblème, le nom, le réglage. Trois choses, trois places fixes.
                L'emblème est posé sur une tuile teintée du palier plutôt que nu : il tient alors sa
                colonne quelle que soit la hauteur du texte à côté, et la carte cesse de flotter. */}
            <View style={styles.heroTop}>
              <View style={[styles.heroEmojiTile, { backgroundColor: info.color + '1A' }]}>
                <Text style={styles.heroEmoji}>{info.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                {/* Ligne du titre PROPRE à la carte (et non `rowLabelLine`, partagée avec les lignes
                    de réglage) : elle se replie plutôt que de laisser la puce d'aide sortir du
                    cadre sur un écran étroit. */}
                <View style={styles.heroTitleLine}>
                  <Text style={[styles.heroName, { color: info.color }]}>{info.name}</Text>
                  <InfoDot term="profil_financier" size={14} color={info.color} />
                </View>
              </View>
            </View>

            <Text style={styles.heroDesc}>{info.description}</Text>

            {/* ── PIED DE CARTE : ce qui QUALIFIE le palier ──────────────────────────────────────
                La fiabilité et le mode de répartition disent tous deux « d'où vient ce que tu
                vois ». Ils tenaient auparavant l'un dans une carte pleine largeur sous celle-ci,
                l'autre au milieu du titre : beaucoup de place pour deux informations qu'on consulte
                rarement, et qui poussaient la répartition sous la ligne de flottaison.
                Le NIVEAU reste lisible en un mot, le DÉTAIL s'ouvre au point d'exclamation. */}
            <View style={styles.heroFoot}>
              <View style={styles.heroFootChips}>
                {!!reliability && (
                  <TouchableOpacity
                    style={styles.relChip}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${reliability.title} — voir le détail`}
                    onPress={() => setShowReliability(true)}
                  >
                    <View style={[styles.relDot, { backgroundColor: toneColor(reliability.tone) }]} />
                    <Text style={styles.relLabel} numberOfLines={1}>{reliability.title}</Text>
                    <View style={[styles.relMark, { borderColor: toneColor(reliability.tone) }]}>
                      <Text style={[styles.relMarkText, { color: toneColor(reliability.tone) }]}>!</Text>
                    </View>
                  </TouchableOpacity>
                )}
                {recoMode.mode === 'manual' && (
                  <View style={styles.modePill}>
                    <Text style={styles.modePillText}>Répartition manuelle</Text>
                  </View>
                )}
              </View>
              {/* Le réglage vit sur cette ligne, à droite : la rangée d'identité redevient le seul
                  endroit où l'on lit QUI l'on est, et les deux commandes de la carte — consulter la
                  fiabilité, régler la répartition — se tiennent côte à côte, au même niveau. */}
              <TouchableOpacity
                style={styles.modeBtn}
                onPress={() => setShowRecoMode(true)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Régler la répartition de tes recommandations"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="options-outline" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Ce qu'il change concrètement ── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {recoMode.mode === 'manual' ? 'Ce qui est appliqué' : 'Ce qu’il change'}
            </Text>
            {/* Ces pourcentages sont EXACTEMENT ceux qui s'appliquent : plus rien ne les réécrit
                entre cet écran et les recommandations (l'étage « priorité du mois » a été retiré).
                Ce qui peut encore faire varier les MONTANTS, plus bas dans le moteur, ce sont les
                garde-fous de faisabilité — jamais ces pourcentages-ci. */}
            <Text style={styles.cardLead}>
              {recoMode.mode === 'manual' ? (
                <>Ce sont <Text style={styles.b}>tes pourcentages</Text> qui répartissent ton Relyka entre
                les quatre décisions — jamais les montants, qui viennent de ta trésorerie réelle.</>
              ) : (
                <>Ton profil fixe la <Text style={styles.b}>répartition</Text> de ton Relyka entre les 4
                recommandations — jamais les montants, qui viennent de ta trésorerie réelle.</>
              )}
            </Text>
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
              'margin', 'Ta marge de sécurité',
              margin > 0 ? `${margin.toLocaleString('fr-FR')} ${symbol}` : 'aucune',
              'marge_securite',
            )}
            {editing === 'margin' && amountPanel(
              symbol,
              'Le montant que tu veux avoir au minimum sur tes comptes courants en fin de mois. Il reste sur ton compte : on te dit juste ce que tu peux utiliser avant d’y toucher.',
              (v) => persistAmount('margin', v),
            )}

            {editableRow(
              'variable', 'Ton estimation de dépenses variables',
              weekly > 0 ? `${weekly.toLocaleString('fr-FR')} ${symbol} / sem.` : 'estimée pour toi',
              'enveloppe_variable',
            )}
            {editing === 'variable' && amountPanel(
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
            {/* En manuel, le palier n'est plus ce qui pilote les pourcentages — mais il continue
                d'être calculé, et c'est ce qui rend un retour à l'automatique immédiat et juste. */}
            {recoMode.mode === 'manual' && (
              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={14} color={COLORS.teal} />
                <Text style={styles.noteText}>
                  Tes pourcentages restent les tiens : ton profil continue d’être calculé en
                  arrière-plan, prêt à reprendre la main si tu reviens à l’automatique.
                </Text>
              </View>
            )}
            {/* La note « revenus irréguliers » a été retirée : elle promettait que « les baisses de
                revenus seront repérées plus tôt », ce qu'aucun calcul ne fait — et elle reposait sur
                un drapeau que plus rien n'écrit depuis le retrait du questionnaire. Elle ne pouvait
                donc ni s'afficher, ni tenir sa promesse. */}
          </View>

          <View style={{ height: 40 }} />
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* Même modale que le tableau de bord : un seul endroit règle la répartition. */}
      <RecoModeModal visible={showRecoMode} onClose={() => setShowRecoMode(false)} userId={user?.id} />

      {/* Le détail de la fiabilité, à la demande — et chaque manque emmène là où il se comble. */}
      {showReliability && !!reliability && (
        <ProfileReliabilitySheet
          reliability={reliability}
          onClose={() => setShowReliability(false)}
          onNavigate={(route) => router.push(route as any)}
        />
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    scroll: { flex: 1 },
    content: { gap: 14, paddingBottom: 20 },

    /* CARTE DU PROFIL — trois étages, dans l'ordre où on les lit :
       1. l'identité (emblème · nom · réglage),
       2. ce que le palier veut dire (description),
       3. ce qui le qualifie (fiabilité, mode de répartition).
       Elle était une simple rangée : le nom, une pastille et une puce d'aide se disputaient la même
       ligne, et la fiabilité occupait une carte entière juste en dessous. */
    hero: {
      backgroundColor: c.card, borderWidth: 1, borderRadius: 20, padding: 16, gap: 10,
    },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: 13 },
    heroEmojiTile: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    heroEmoji: { fontSize: 27 },
    heroTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    heroName: { fontSize: 18, fontWeight: '800', flexShrink: 1, letterSpacing: -0.2 },
    heroDesc: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },

    /* Pied : les qualificatifs à gauche, le réglage à droite, séparés du reste par un filet.
       Le repli reste sur le GROUPE de gauche seulement — sinon, sur un écran étroit, le bouton
       passerait à la ligne et se retrouverait seul sous les puces, sans rien à quoi s'aligner. */
    heroFoot: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 10, marginTop: 1,
    },
    heroFootChips: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    relChip: {
      flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1,
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
      borderRadius: 999, paddingLeft: 10, paddingRight: 6, paddingVertical: 5,
    },
    relLabel: { fontSize: 12, fontWeight: '700', color: c.text, flexShrink: 1 },
    /* Le point d'exclamation : une CIBLE, pas une décoration. Cerclé à la couleur du niveau, il se
       lit comme « il y a quelque chose à savoir ici » — et il porte l'ouverture du détail. */
    relMark: {
      width: 18, height: 18, borderRadius: 9, borderWidth: 1.2,
      alignItems: 'center', justifyContent: 'center',
    },
    relMarkText: { fontSize: 11, fontWeight: '900', lineHeight: 14 },

    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 20, padding: 16, gap: 9,
    },
    cardTitle: { fontSize: 15.5, fontWeight: '800', color: c.text },
    cardLead: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    b: { fontWeight: '800', color: c.text },

    /* Réglage de la répartition — MÊMES styles que l'en-tête de « Tes recommandations »
       (components/pilotage/PilotageSimple) : c'est le même bouton, il doit se reconnaître. */
    modePill: {
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
      backgroundColor: c.teal + '1A', borderWidth: 1, borderColor: c.teal + '40',
    },
    modePillText: { fontSize: 10.5, fontWeight: '800', color: c.teal },
    modeBtn: {
      width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
    },

    /* Pastille du niveau de fiabilité. Le DÉTAIL des manques a déménagé dans sa fiche
       (components/ui/ProfileReliabilitySheet) : il occupait ici une carte pleine largeur pour une
       information qu'on consulte une fois. */
    relDot: { width: 8, height: 8, borderRadius: 4 },

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
    saveBtnText: { fontSize: 14.5, fontWeight: '800', color: c.onAccent },

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
    ctaText: { fontSize: 15, fontWeight: '800', color: c.onAccent },
  });
}
