/**
 * MonthlyClosure — bannière de clôture + modale de clôture.
 * Activé seulement si le drapeau admin monthly_closure_enabled est vrai (sinon rien ne s'affiche).
 * Monté sur le Pilotage.
 *
 * ⚠️ IL N'Y A PLUS DE POP-UP DE BILAN. Une fenêtre « Félicitations ! Il te restait X € sur ton
 * enveloppe le mois dernier » s'affichait après une clôture. Elle est supprimée pour trois raisons :
 *   • elle n'apprenait rien — l'état des lieux mensuel dit déjà ce qu'a donné le mois, en mieux ;
 *   • son montant était stocké en base (`profiles.last_closure_bilan`) avec un `seen` qui n'était
 *     posé qu'à la fermeture : une pop-up jamais fermée (app tuée, écran quitté) revenait
 *     indéfiniment, en annonçant « le mois dernier » pour un mois qui ne l'était plus depuis
 *     longtemps ;
 *   • surtout, elle vivait HORS de la file des sollicitations (lib/interruptQueue) et se montait en
 *     même temps que la modale de clôture. Deux `<Modal>` natifs concurrents sur Android : celle de
 *     clôture pouvait ne jamais apparaître, et comme l'ouverture automatique est à usage unique par
 *     montage (`autoOpened`), elle ne réessayait pas de la session.
 * Rien ne la remplace — c'est l'état des lieux qui porte ce rôle.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useGuide } from '../../contexts/GuideContext';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useAddTransaction, useAllTransactions } from '../../hooks/data/useTransactions';
import { useMonthlyClosure, useAccountClosures, wasReopenedThisSession, monthLabel, lastDayOfMonthKey, addMonthKey, ym } from '../../hooks/pilotage/useMonthlyClosure';
import { supabase } from '../../lib/platform/supabase';
import { CURRENCY_SYMBOL, currencySymbolFor, convertAmount } from '../../lib/finance/currency';
import { useCurrencyRates } from '../../hooks/data/useCurrencyRates';
import { useProfile } from '../../hooks/data/useProfile';
import { findRegulCategoryId } from '../../lib/finance/regul';
import { useCategories } from '../../hooks/data/useCategories';
import { todayISO, formatDateFrench, parseDateFromFrench } from '../../lib/dateUtils';
import { sheetWidth } from '../../lib/ui/appLayout';
import { useRecalibrateReliability } from '../../hooks/pilotage/useReliability';
import { useInterruptSlot } from '../../hooks/engagement/useInterruptSlot';
import { openPulse } from '../pulse/PulseHost';
import { balanceAtEnd, unknownGap, unknownTotalGap as totalGap, hasAnyTypedBalance, closingSharePct, parseTypedAmount } from '../../lib/finance/closureForm';
import { laterVerification } from '../../lib/finance/balanceAt';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import AppButton from '../ui/AppButton';
import SegmentedControl from '../ui/SegmentedControl';
import StepRail from '../ui/StepRail';
import { sanitizeAmountInput, sanitizeSignedAmountInput } from '../../lib/ui/amountInput';

interface Props {
  /**
   * Enveloppe de dépenses variables du mois (`variable_envelope_initial`).
   *
   * ⚠️ C'était auparavant un `surplusEstimate` calculé sur le MOIS EN COURS, et le bilan de clôture
   * l'annonçait ensuite comme « il te restait X € le MOIS DERNIER ». On félicitait donc l'utilisateur
   * pour un reliquat qui n'était pas celui du mois qu'il venait de clôturer — un chiffre juste, mais
   * rattaché au mauvais mois, ce qui en fait un chiffre faux. Le reliquat réel du mois clos est
   * recalculé ici, depuis ses propres dépenses.
   */
  variableEnvelope: number;
  /**
   * Comptes courants à clôturer — les miens ET les comptes JOINTS auxquels je peux écrire.
   *
   * `joint` distingue les seconds : ils appartiennent à plusieurs personnes, donc (a) ils ne sont
   * OBLIGATOIRES que pour le propriétaire, (b) ils sont retirés de la liste dès que QUELQU'UN les a
   * clôturés pour ce mois — une clôture par compte, pas une par participant.
   */
  checkingAccounts?: { id: string; name: string; balance: number; currency?: string | null; joint?: boolean; isOwner?: boolean }[];
  /** Ouvre directement la modale (deeplink « Clôture ton mois » du bandeau prochain geste). */
  autoOpen?: boolean;
}

/**
 * Bannière d'invitation à la clôture (présentation pure) — partagée entre le Pilotage et
 * l'aperçu admin (admin/banners-preview) pour que l'aperçu reste le rendu de production.
 */
export function ClosureBannerCard({ pendingMonths, onPress }: { pendingMonths: string[]; onPress?: () => void }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  if (pendingMonths.length === 0) return null;
  const multiple = pendingMonths.length > 1;
  return (
    <TouchableOpacity style={styles.banner} activeOpacity={onPress ? 0.85 : 1} onPress={onPress}>
      <Ionicons name="lock-closed-outline" size={18} color={COLORS.yellow} />
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>Clôturer {multiple ? `${pendingMonths.length} mois` : monthLabel(pendingMonths[0])}</Text>
        <Text style={styles.bannerText}>Fige le passé pour fiabiliser tes calculs et recommandations.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.yellow} />
    </TouchableOpacity>
  );
}

/**
 * Ouverture IMPÉRATIVE de la modale (bandeau « prochain geste »).
 *
 * Le bandeau naviguait vers `/(tabs)/pilotage?closure=1`. Depuis le Pilotage — c'est-à-dire là où
 * le bandeau s'affiche — cette navigation ne change rien : même route, même paramètre, aucun
 * remontage. La modale, elle, ne se rouvre qu'au montage : après l'avoir fermée une fois, le
 * bandeau devenait inerte jusqu'à un rechargement complet. Un appel direct règle ça sans dépendre
 * du routeur (même schéma que `openPulse`).
 */
let openImperative: (() => void) | null = null;
export function openClosureModal(): boolean {
  if (!openImperative) return false;
  openImperative();
  return true;
}

export default function MonthlyClosure({ variableEnvelope, checkingAccounts: allCheckingAccounts = [], autoOpen = false }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user, isImpersonating } = useAuth();
  // Catégories du profil : la régularisation de clôture est rangée selon son sens (cf. lib/regul).
  const { data: categories = [] } = useCategories(user?.id);
  const { enabled, pendingMonths, closeMonths } = useMonthlyClosure(user?.id);
  /* `isSuccess` et pas seulement les données : en cas d'échec de lecture, `data` vaut `undefined` et
     retombait sur `[]` — c'est-à-dire « aucun compte n'est clôturé ». Sur un compte JOINT déjà
     régularisé par un autre participant, clôturer dans cet état empile une seconde régularisation
     sur le même compte. Tant qu'on ne SAIT pas, on ne clôture pas (cf. `traceUnavailable`). */
  const { data: accountClosures = [], isSuccess: closureTraceLoaded } = useAccountClosures(user?.id);
  const addTransaction = useAddTransaction(user?.id);
  /* Les comptes JOINTS ne sont pas dans `useTransactions` (vue perso, volontairement) : sans leurs
     lignes, le solde de fin de mois d'un compte joint serait reconstitué à partir de rien — donc
     égal au solde du jour. On travaille ici sur la vue COMPLÈTE. */
  const { data: allTx = [] } = useAllTransactions(user?.id);

  const [open, setOpen] = useState(false);
  /* 'unknown' — « je ne sais pas ce que valait mon compte à la fin du mois ». L'utilisateur donne
     le solde qu'il a AUJOURD'HUI (ou à une date de son choix, forcément postérieure à la fin du
     mois) et dit lui-même comment il pense que l'écart se répartit entre le mois qu'on clôture et
     le mois en cours. Sans ce mode, clôturer un mois ancien exigeait de reconstituer un solde
     passé — ce que personne ne fait — ou de subir un prorata par jours qu'on ne lui demandait pas. */
  const [mode, setMode] = useState<'direct' | 'balance' | 'unknown'>('direct');
  /* ── UNE ÉTAPE, UNE QUESTION ──────────────────────────────────────────────────────────────────
     Cet écran posait TOUT en même temps : le mois concerné, le mode de saisie, un champ par compte,
     la répartition de l'écart, l'aperçu, deux encadrés d'explication et le bouton — dans une feuille
     qu'il fallait faire défiler pour atteindre la validation. On y arrivait sans savoir ce qu'on
     allait devoir répondre, et on validait sans avoir vu la moitié de ce qui était écrit.
     Le parcours suit désormais celui d'une saisie de dépense (app/(tabs)/transactions/add) :
       1. de quoi il s'agit, et comment on veut s'y prendre ;
       2. la saisie elle-même (ou la simple validation si on est à jour) ;
       3. — mode « je ne sais pas » uniquement — à quel mois appartient l'écart.
     Le fil d'étapes est le composant partagé `components/ui/StepRail`. */
  const [step, setStep] = useState<1 | 2 | 3>(1);
  /** Part de l'écart attribuée au mois CLÔTURÉ, en % (curseur). Défaut : le prorata par jours. */
  const [unknownShare, setUnknownShare] = useState<number | null>(null);
  const [unknownDate, setUnknownDate] = useState(todayISO());
  const [flash, setFlash] = useState(false);
  const [balances, setBalances] = useState<Record<string, string>>({}); // par compte courant
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mois déjà clôturés dans cette session (avance immédiate au mois suivant, avant le refetch).
  const [closedLocally, setClosedLocally] = useState<string[]>([]);

  const effectivePending = pendingMonths.filter((m) => !closedLocally.includes(m));
  const oldest = effectivePending[0];
  const multiple = effectivePending.length > 1;
  const monthsToClose = flash ? effectivePending : (oldest ? [oldest] : []);
  const targetKeyRaw = monthsToClose[monthsToClose.length - 1] ?? oldest;

  /* ── COMPTES À CLÔTURER ─────────────────────────────────────────────────────────────────────
     Règle produit, pour les comptes JOINTS :
       • le PROPRIÉTAIRE les voit dans sa liste comme ses comptes perso — c'est lui qui répond du
         solde ;
       • un membre en ÉCRITURE (ou avec une part) peut les clôturer aussi : il a la même vue du
         relevé, et attendre le propriétaire fige tout le monde. La liste les lui propose donc, mais
         il peut les laisser vides — rien ne l'y oblige (un mode qui réclame un solde ne clôture
         que les comptes renseignés) ;
       • un accès en CONSULTATION ne clôture rien : il regarde, il n'engage pas le compte.
         (Le filtrage se fait à la source, dans le Pilotage, qui connaît les rôles.)
       • et surtout : UNE clôture par compte et par mois. Dès que quelqu'un l'a faite, le compte
         disparaît de la liste des autres — sans ça, chaque participant empilerait sa propre
         régularisation sur le même compte, et le solde partirait en vrille à trois personnes. */
  const closedAccountKeys = useMemo(
    () => new Set(accountClosures.map((c) => `${c.account_id}|${c.month_key}`)),
    [accountClosures],
  );
  const checkingAccounts = useMemo(
    () => allCheckingAccounts.filter((a) => !targetKeyRaw || !closedAccountKeys.has(`${a.id}|${targetKeyRaw}`)),
    [allCheckingAccounts, closedAccountKeys, targetKeyRaw],
  );
  /**
   * Comptes RETIRÉS de la liste parce qu'ils portent déjà une clôture pour ce mois — on le DIT.
   *
   * Ce message ne concernait que les comptes JOINTS. Un compte PERSO écarté par la même règle
   * disparaissait donc en silence : il suffisait qu'une ligne `account_closures` survive à une
   * réouverture (cf. migration 192) pour qu'un compte courant s'évapore de l'écran de clôture, sans
   * la moindre explication — et on ne pouvait plus vérifier son solde. Tout compte écarté est
   * nommé : c'est la seule façon de distinguer « déjà fait » de « l'app a perdu mon compte ».
   */
  const alreadyClosed = useMemo(
    () => allCheckingAccounts.filter((a) => targetKeyRaw && closedAccountKeys.has(`${a.id}|${targetKeyRaw}`)),
    [allCheckingAccounts, closedAccountKeys, targetKeyRaw],
  );
  const hasChecking = checkingAccounts.length > 0;
  /* RIEN À VÉRIFIER : aucun compte courant à clôturer pour ce mois — soit ils ont tous déjà été
     clôturés par un autre participant (comptes joints), soit il n'y en a pas.
     L'écran continuait pourtant d'afficher le choix du mode, un aperçu « écart 0 — solde confirmé »
     et la mention « la clôture enregistre une régularisation ». Les trois étaient faux : sans
     compte, `confirm()` n'écrit AUCUNE régularisation et ne confirme aucun solde — il ne fait que
     marquer le mois comme traité. On ne propose donc plus une vérification qui n'a pas lieu. */
  const nothingToVerify = !hasChecking;
  React.useEffect(() => {
    if (nothingToVerify) setMode('direct');
  }, [nothingToVerify]);
  /* ── Devises ────────────────────────────────────────────────────────────────────────────────
     La clôture travaille COMPTE PAR COMPTE : le solde saisi, l'écart et la régularisation écrite en
     base sont tous dans la devise NATIVE du compte. Un solde de compte suisse s'affichait pourtant
     « 1 000 € » (symbole de la devise de référence), et les récapitulatifs additionnaient des CHF
     avec des € sans conversion.
       • montant rattaché à UN compte → `fmtIn(n, acc.currency)` ;
       • total tous comptes confondus → converti en devise de RÉFÉRENCE puis `fmt`. */
  const { data: closureProfile } = useProfile(user?.id);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const refCode = (closureProfile as any)?.currency_code ?? 'EUR';
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
  const fmtIn = (n: number, currency?: string | null) =>
    Math.round(n).toLocaleString('fr-FR') + ' ' + currencySymbolFor(currency ?? refCode);
  /** Ramène un montant libellé dans la devise d'un compte vers la devise de référence. */
  const toRef = (n: number, currency?: string | null) =>
    convertAmount(n, currency || refCode, refCode, rates) ?? n;

  /**
   * Ce qu'il RESTAIT sur l'enveloppe variable du mois qu'on clôture — le seul chiffre que le bilan
   * ait le droit d'annoncer, puisqu'il parle de ce mois-là.
   *
   * Dépense variable = sortie du quotidien : compte courant, non récurrente (une occurrence
   * matérialisée porte `materialized_from`), hors virement et hors projet. Même définition que le
   * « dépensé variable » du Pilotage et de l'état des lieux — trois écritures de la règle, ce
   * seraient trois totaux différents pour le même mois.
   */
  const closedMonthLeftover = (monthKey: string): number => {
    if (!(variableEnvelope > 0)) return 0;
    const ids = new Set(allCheckingAccounts.map((a) => a.id));
    let spent = 0;
    for (const t of allTx as any[]) {
      if (!ids.has(t.account_id) || t.is_draft) continue;
      if (String(t.date ?? '').slice(0, 7) !== monthKey) continue;
      if (t.linked_account_id || t.project_id) continue;
      if (t.is_recurring || t.materialized_from) continue;
      const amt = Number(t.amount) || 0;
      if (amt < 0) spent += -amt;
    }
    return Math.max(0, variableEnvelope - spent);
  };

  const resetForm = () => { setStep(1); setMode('direct'); setFlash(false); setBalances({}); setUnknownShare(null); setUnknownDate(todayISO()); setError(null); };
  const openModal = () => { setClosedLocally([]); resetForm(); setOpen(true); };
  const closeModal = () => { setOpen(false); setClosedLocally([]); resetForm(); };

  /* ── REPORT ────────────────────────────────────────────────────────────────────────────────────
     La clôture s'ouvrait d'elle-même à CHAQUE ouverture de l'app tant qu'un mois restait en
     attente. L'intention est bonne — un mois non clôturé dégrade les moyennes de tous les suivants,
     et une bannière qu'on peut ignorer ne fait pas le travail — mais sans échappatoire, quelqu'un
     qui n'a pas ses relevés sous la main se prend la même modale plusieurs fois par jour. Au mieux
     il la referme sans lire, au pire il n'ouvre plus l'app.
     On garde donc l'ouverture automatique, avec un report explicite de 24 h : l'invitation reste
     insistante (elle revient le lendemain, et la bannière ne disparaît jamais), sans se répéter
     dans la même journée. Le report est local à l'appareil et porte sur le mois concerné — un
     nouveau mois à clôturer reprend la main immédiatement.

     ⚠️ LA CLÉ EST NOMMÉE PAR UTILISATEUR. Elle était globale à l'APPAREIL (`closure_snooze_v1`) :
     sur un téléphone qui porte plusieurs comptes — le cas de tout testeur, et de tout foyer qui
     partage un appareil — « Me le rappeler demain » sur un compte faisait taire la clôture de
     TOUS les autres, pour peu qu'ils aient le même mois en attente. Le second compte voyait alors
     la bannière sans jamais voir la modale, sans rien qui l'explique. */
  const SNOOZE_KEY = user?.id ? `closure_snooze_v2:${user.id}` : null;
  const SNOOZE_MS = 24 * 60 * 60 * 1000;
  const [snoozeChecked, setSnoozeChecked] = React.useState(false);
  const [snoozedMonth, setSnoozedMonth] = React.useState<string | null>(null);
  /* Dépend de l'UTILISATEUR : changer de compte doit relire SON report, jamais garder en mémoire
     celui du précédent. On repart donc d'un état « non lu » AVANT l'await, dans le même effet —
     séparer la remise à zéro dans un second effet la ferait dépendre de l'ordre des effets. */
  React.useEffect(() => {
    setSnoozeChecked(false);
    setSnoozedMonth(null);
    if (!SNOOZE_KEY) return;                 // pas encore d'utilisateur : rien à lire
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SNOOZE_KEY);
        if (cancelled) return;
        const o = raw ? JSON.parse(raw) : null;
        // Report périmé, ou posé sur un AUTRE mois → il ne protège plus rien.
        if (o?.month && typeof o.until === 'number' && o.until > Date.now()) setSnoozedMonth(o.month);
      } catch { /* stockage indisponible : on retombe sur le comportement d'origine */ }
      if (!cancelled) setSnoozeChecked(true);
    })();
    return () => { cancelled = true; };
  }, [SNOOZE_KEY]);

  const snoozeAndClose = () => {
    const m = oldest;
    if (m && SNOOZE_KEY) {
      setSnoozedMonth(m);
      AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({ month: m, until: Date.now() + SNOOZE_MS })).catch(() => {});
    }
    closeModal();
  };

  /* La clôture est la PREMIÈRE des sollicitations : tout ce qui suit (bilan mensuel, profil,
     succès) s'appuie sur des chiffres qu'elle vient consolider. Elle prend donc la main en premier,
     et ne la rend qu'une fois fermée (cf. lib/interruptQueue).

     ⚠️ SAUF PENDANT LE PARCOURS DE DÉMARRAGE. Le guide n'est pas dans cette file — il est AVANT
     elle : tant que quelqu'un installe ses comptes, il n'a rien à clôturer, et lui demander de
     vérifier un solde de mois passé n'a aucun sens. Le cas n'est pas théorique : saisir sa première
     récurrente au 5 du mois dernier (« mon loyer ») fait immédiatement apparaître un mois en
     attente — la clôture surgissait alors par-dessus l'étape du guide en cours. */
  const guide = useGuide();
  const myTurn = useInterruptSlot(
    'closure',
    enabled && pendingMonths.length > 0 && !isImpersonating && !guide.active,
  );

  /* Ouverture automatique (arrivée dans l'app / deeplink) : une fois par montage, quand c'est notre
     tour — et seulement si le mois le plus ancien n'a pas été REPORTÉ dans les 24 h.
     On attend `snoozeChecked` : la lecture du report est asynchrone, et conclure avant sa réponse
     rouvrirait la modale précisément à celui qui vient de demander à être laissé tranquille.
     Un deeplink explicite (`?closure=1`) ou le bouton de la bannière passent outre : là,
     l'utilisateur DEMANDE la clôture. */
  const autoOpened = React.useRef(false);
  /* « Une fois par montage » se compte PAR UTILISATEUR : si l'arbre n'est pas remonté au changement
     de compte, le second héritait du « déjà ouvert » du premier et n'avait jamais sa clôture. */
  React.useEffect(() => { autoOpened.current = false; }, [user?.id]);
  React.useEffect(() => {
    if (!autoOpen || !myTurn || autoOpened.current || !snoozeChecked) return;
    if (oldest && snoozedMonth === oldest) return;
    /* Mois ROUVERT dans cette session : on ne le réclame pas. Rouvrir juillet fait justement
       revenir juillet dans les mois en attente — l'ouverture automatique se déclenchait donc dans
       la foulée du geste, et la modale de clôture surgissait par-dessus l'écran Clôture, à peine
       la réouverture terminée. Vu de l'utilisateur, c'est la réouverture qui « ouvre n'importe
       quelle fenêtre ». Il vient de dire qu'il s'en occupe : on le laisse faire. */
    if (wasReopenedThisSession(oldest)) return;
    autoOpened.current = true;
    openModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, myTurn, snoozeChecked, snoozedMonth, oldest]);

  // Ouverture à la demande depuis le bandeau « prochain geste » — sans passer par le routeur.
  React.useEffect(() => {
    openImperative = () => openModal();
    return () => { openImperative = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recalibrate = useRecalibrateReliability(user?.id);

  /* Le CALCUL de ce formulaire vit dans lib/closureForm : il décide de MONTANTS (solde de fin de
     mois reconstitué, écart constaté, répartition entre deux mois), donc il est testé — une erreur
     y écrit une régularisation fausse en base. Ici on ne fait plus que le brancher à l'état.
     Cf. docs/PLAN_REFACTOR_TESTS.md, phase D. */
  const targetKey = targetKeyRaw;
  const balanceAtEndFor = (accId: string, accBalance: number) => balanceAtEnd(allTx as any[], accId, accBalance, targetKey);
  const unknownGapOf = (acc: { id: string; balance: number }) => unknownGap(allTx as any[], acc, balances[acc.id], unknownDate);
  // Total tous comptes : chaque écart est converti en devise de référence avant la somme.
  const unknownTotalGap = () =>
    totalGap(allTx as any[], checkingAccounts, balances, unknownDate, new Date(), (gap, a) => toRef(gap, a.currency));
  const hasAnyAmount = hasAnyTypedBalance(checkingAccounts, balances);
  /** Les modes « solde réel » et « je ne sais pas » ne veulent rien dire sans montant saisi. */
  const needsAmount = mode === 'balance' || mode === 'unknown';
  const unknownSharePct = (accId: string) => closingSharePct(allTx as any[], accId, targetKey, unknownDate, unknownShare);

  /* Tant que la trace des clôtures par compte n'a pas pu être lue, on ne sait pas si un compte a
     DÉJÀ été régularisé par quelqu'un d'autre. Clôturer à l'aveugle, c'est risquer d'écrire une
     seconde régularisation sur le même compte — et un solde faux pour tout le monde. */
  const traceUnavailable = !closureTraceLoaded;

  const confirm = async () => {
    if (!monthsToClose.length) return;
    if (traceUnavailable) {
      setError("Impossible de vérifier si ces comptes ont déjà été clôturés. Réessaie dans un instant — clôturer maintenant risquerait d'appliquer deux fois la même correction.");
      return;
    }
    setBusy(true);
    try {
      const closeKey = monthsToClose[monthsToClose.length - 1];
      const monthEnd = lastDayOfMonthKey(closeKey);
      /* MARQUE D'ORIGINE (migration 179) posée sur CHAQUE écriture de la clôture : c'est elle, et
         plus le libellé, que la réouverture cherche pour défaire exactement ce qu'on écrit ici. */
      const stamp = { closure_month: closeKey };
      /** Comptes réellement clôturés dans cette passe → trace partagée `account_closures`. */
      const closedAccounts: { account_id: string; balance: number }[] = [];
      if (hasChecking) {
        for (const acc of checkingAccounts) {
          const balAtEnd = balanceAtEndFor(acc.id, acc.balance);
          if (mode === 'direct') {
            // Option A — « Je suis à jour » : ancre de VÉRIFICATION (écart 0) datée de la fin du mois.
            // Calibre la dérive vers 0 et compte comme une vérification récente.
            await addTransaction.mutateAsync({
              account_id: acc.id, category_id: null, amount: 0, date: monthEnd,
              note: 'Régularisation (à jour)', regul_target: balAtEnd, is_recurring: false, ...stamp,
            } as any);
            closedAccounts.push({ account_id: acc.id, balance: balAtEnd });
            continue;
          }
          if (mode === 'unknown') {
            /* « Je ne sais pas » : le solde donné vaut à `unknownDate` (postérieure à la fin du
               mois). L'écart est mesuré contre le solde REMONTÉ à cette date (cf. `unknownGapOf`,
               définition unique partagée avec le curseur et l'aperçu), puis réparti selon le
               curseur — c'est l'utilisateur qui tranche, pas une règle qu'il n'a pas choisie.

               CHAMP VIDE = « ce compte est à jour », comme en « Solde réel » : `unknownGap` rend
               déjà 0 quand rien n'est saisi, il n'y a donc pas d'écart à répartir. Restait à
               ÉCRIRE quelque chose — ce compte était sauté en silence. */
            const gap = unknownGapOf(acc);
            const pct = unknownSharePct(acc.id) / 100;
            /* AUCUN ÉCART (champ vide, ou solde qui tombe pile) → ancre de vérification à 0 €,
               datée de la fin du mois : exactement ce qu'écrivent la Validation directe et le mode
               « Solde réel ». Un solde saisi qui tombait juste ne laissait lui non plus aucune
               trace — le compte passait pour non vérifié alors qu'il venait de l'être. */
            if (Math.abs(gap) <= 0.005) {
              closedAccounts.push({ account_id: acc.id, balance: balAtEnd });
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: null, amount: 0, date: monthEnd,
                note: 'Régularisation (à jour)', regul_target: balAtEnd, is_recurring: false, ...stamp,
              } as any);
              continue;
            }
            closedAccounts.push({ account_id: acc.id, balance: balAtEnd + gap * pct });
            const closingPart = gap * pct;
            const currentPart = gap - closingPart;
            if (Math.abs(closingPart) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: findRegulCategoryId(categories, closingPart), amount: closingPart, date: monthEnd,
                note: 'Régularisation clôture (mois)', is_recurring: false, ...stamp,
              } as any);
            }
            if (Math.abs(currentPart) > 0.005) {
              await addTransaction.mutateAsync({
                account_id: acc.id, category_id: findRegulCategoryId(categories, currentPart), amount: currentPart, date: unknownDate,
                note: 'Régularisation clôture (mois courant)', is_recurring: false, ...stamp,
              } as any);
            }
            continue;
          }

          /* Mode « solde réel ».
             CHAMP LAISSÉ VIDE = « ce compte est à jour ». C'est la même écriture que la Validation
             directe : une ancre de vérification à 0 €, datée de la fin du mois.

             Ce compte était auparavant SAUTÉ — aucune écriture, et pas même une ligne dans
             `account_closures`. Trois conséquences, toutes invisibles :
               • rien dans le compte ne distinguait « vérifié » de « oublié » ;
               • la question « déjà comptée dans ce solde ? » (posée quand une régul existe le même
                 jour) se posait sur les comptes renseignés et PAS sur les autres — même geste de
                 clôture, deux comportements ;
               • la dernière vérification du compte n'avançait pas, donc le moteur de doute
                 continuait à compter la dérive depuis une date bien plus ancienne.
             Le placeholder du champ affiche déjà le solde calculé : ne rien saisir, c'est le
             confirmer. */
          const typed = parseTypedAmount(balances[acc.id]);
          const newBalance = typed ?? balAtEnd;
          const diff = newBalance - balAtEnd;
          closedAccounts.push({ account_id: acc.id, balance: newBalance });
          if (Math.abs(diff) <= 0.005) {
            await addTransaction.mutateAsync({
              account_id: acc.id, category_id: null, amount: 0, date: monthEnd,
              note: 'Régularisation (à jour)', regul_target: balAtEnd, is_recurring: false, ...stamp,
            } as any);
            continue;
          }
          /* SOLDE RÉEL = LE SOLDE DE FIN DE MOIS, ET LA RÉGULARISATION EST DATÉE DE CE JOUR-LÀ.
             Le champ demande explicitement « solde réel à fin <mois> » : l'écart se mesure donc
             contre le solde reconstitué à cette date, et il appartient ENTIÈREMENT à ce mois. Il
             n'y a rien à répartir.

             Ce code répartissait pourtant l'écart au prorata des jours dès que le mois clôturé
             n'était pas le dernier — c'est-à-dire qu'il traitait le montant saisi comme s'il valait
             AUJOURD'HUI, en contradiction avec l'étiquette du champ. Conséquences : la
             régularisation du mois clos était amputée d'une part arbitraire, et une seconde
             régularisation apparaissait à la date du jour, que l'utilisateur n'avait jamais
             demandée. Le mode « Je ne sais pas » existe précisément pour le cas où l'on ne connaît
             que le solde d'aujourd'hui — c'est LUI qui répartit, et sur un curseur que
             l'utilisateur contrôle.

             `regul_target` fait de cette écriture l'ANCRE du moteur de solde : le compte vaut
             désormais ce montant à la fin du mois, plus tout ce qui est arrivé après. */
          await addTransaction.mutateAsync({
            account_id: acc.id, category_id: findRegulCategoryId(categories, diff), amount: diff, date: monthEnd,
            note: 'Régularisation solde', regul_target: newBalance, is_recurring: false, ...stamp,
          } as any);
        }
      }
      /* TRACE PARTAGÉE : ce compte est clôturé pour ce mois, quel que soit celui qui l'a fait. Un
         compte joint disparaît ainsi de la liste des AUTRES participants (une clôture par compte).
         `ignoreDuplicates` : deux personnes qui valident en même temps ne se marchent pas dessus.
         Best-effort — la table peut ne pas exister si la migration 179 n'est pas déployée, et un
         échec ici ne doit pas annuler une clôture par ailleurs réussie. */
      if (supabase && closedAccounts.length) {
        try {
          await supabase.from('account_closures').upsert(
            closedAccounts.map((a) => ({ account_id: a.account_id, month_key: closeKey, closed_by: user?.id, balance: a.balance })),
            { onConflict: 'account_id,month_key', ignoreDuplicates: true },
          );
        } catch { /* trace indisponible : la clôture reste valide */ }
      }
      // Reliquat du mois RÉELLEMENT clôturé (cf. closedMonthLeftover) — c'est ce chiffre que le
      // bilan annonce ensuite, et il doit donc parler du bon mois.
      await closeMonths.mutateAsync({ monthKeys: monthsToClose, surplus: closedMonthLeftover(closeKey), status: 'confirmed' });
      // Clôture confirmée = vérification → recalibrer la dérive du user (silencieux).
      recalibrate.mutate();
      // Mois par mois : s'il reste des mois en attente, on enchaîne directement sur le suivant.
      const remaining = effectivePending.filter((m) => !monthsToClose.includes(m));
      if (!flash && remaining.length > 0) {
        // On enchaîne sur le mois suivant : le parcours repart de son début, pas au milieu d'une
        // saisie qui portait sur le mois précédent.
        setClosedLocally((prev) => [...prev, ...monthsToClose]);
        setBalances({});
        setMode('direct');
        setUnknownShare(null);
        setStep(1);
      } else {
        closeModal();
        /* PLUS RIEN À CLÔTURER → on ENCHAÎNE sur l'état des lieux du mois.
           C'était jusqu'ici laissé à l'ouverture automatique, qui dépend d'une pile de conditions
           ambiantes (période déjà « vue » dans la session, signaux jugés, données rechargées…) :
           il suffisait qu'une seule ne passe pas pour que le bilan n'arrive jamais, sans rien dire.
           Ici on SAIT qu'il doit venir — l'utilisateur vient de valider le mois — donc on le
           demande explicitement. L'ouverture automatique reste le chemin des lancements suivants.
           Le petit délai laisse la modale se refermer et les données se rafraîchir. */
        if (closeKey === addMonthKey(ym(new Date()), -1)) {
          setTimeout(() => openPulse(), 450);
        }
      }
    } catch (e) {
      /* ⚠️ NE PLUS AVALER L'ÉCHEC. C'est ce `console.warn` muet qui a rendu le bug de la policy
         UPDATE manquante (migration 162) invisible pendant des mois : les régularisations étaient
         créées, la clôture échouait, et l'écran se contentait de ne pas avancer — sans rien dire. */
      console.warn('[closure] échec clôture:', e);
      setError(e instanceof Error ? e.message : "La clôture n'a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    // Même si désactivé, on peut avoir un bilan à montrer (cas où on désactive après coup) : on l'ignore.
    return null;
  }

  /* ── LES TROIS FAÇONS DE CLÔTURER, ÉNONCÉES COMME DES PHRASES ────────────────────────────────
     C'étaient trois segments de deux mots (« Validation directe », « Solde réel », « Je ne sais
     pas ») : des étiquettes de développeur, qu'il fallait essayer pour comprendre ce qu'elles
     changeaient. Chacune dit maintenant ce que l'utilisateur AURA À FAIRE — c'est le seul critère
     qui l'aide à choisir. */
  const modeCards: { key: 'direct' | 'balance' | 'unknown'; icon: string; title: string; sub: string }[] = [
    {
      key: 'direct',
      icon: 'checkmark-circle-outline',
      title: 'Je suis à jour',
      sub: 'Tout est saisi : rien à recopier, je valide le mois tel quel.',
    },
    {
      key: 'balance',
      icon: 'wallet-outline',
      title: targetKey ? `Je connais mon solde à fin ${monthLabel(targetKey)}` : 'Je connais mon solde de fin de mois',
      sub: 'Je recopie le solde de mon relevé : l’écart est corrigé sur ce mois-là.',
    },
    {
      key: 'unknown',
      icon: 'time-outline',
      title: 'Je ne sais plus',
      sub: 'Je donne le solde que j’ai sous les yeux : on remonte le temps ensemble.',
    },
  ];

  /** Nombre d'étapes : la répartition de l'écart n'existe qu'en « je ne sais plus ». */
  const totalSteps = mode === 'unknown' ? 3 : 2;
  /** Dernière étape → le bouton clôture ; avant → il fait avancer. */
  const isLastStep = step === totalSteps;
  /** Titre de l'étape en cours (l'étape 1 n'en porte pas : son bloc de tête parle pour elle). */
  const stepTitle =
    step === 1 ? ''
    : step === 2
      ? (mode === 'direct'
          ? 'Vérifie, puis valide'
          : mode === 'balance'
            ? `Ton solde réel à fin ${targetKey ? monthLabel(targetKey) : 'ce mois'}`
            : 'Le solde que tu as sous les yeux')
      : 'À quel mois appartient l’écart ?';

  const goPrevStep = () => { setError(null); setStep((s) => (s === 3 ? 2 : 1)); };
  const goNextStep = () => {
    setError(null);
    if (step === 1) { setStep(2); return; }
    if (step === 2 && mode === 'unknown') { setStep(3); return; }
    confirm();
  };

  return (
    <>
      {/* UNE SEULE invitation à clôturer, et c'est celle-ci.
          Le bandeau flottant « prochain geste » disait exactement la même chose et ouvrait la même
          modale — mais il se SUPERPOSE au Pilotage, donc il masque les chiffres qu'on vient
          justement consulter. Celle-ci prend sa place dans le flux : elle décale le contenu au lieu
          de le recouvrir. Le cas `soft_close` est donc écarté côté NextActionBanner. */}
      <ClosureBannerCard pendingMonths={effectivePending} onPress={openModal} />

      {/* Modale de clôture */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        /* Retour physique Android : on recule d'une ÉTAPE avant de fermer — comme dans la saisie
           d'une dépense. Fermer d'un coup ferait perdre les soldes déjà recopiés. */
        onRequestClose={() => { if (step > 1) goPrevStep(); else closeModal(); }}
      >
        <KeyboardAwareOverlay style={styles.overlay} scroll={false}>
          {/* `maxHeight` porté par la FEUILLE elle-même (et non par un conteneur au-dessus) : une View
              a `flexShrink: 0` par défaut, donc une feuille enveloppée dans un parent plafonné ne se
              rétrécit PAS — elle débordait sous le bas de l'écran et emportait le bouton « Clôturer »
              avec elle (constaté sur navigateur mobile / iPhone). Même schéma que ProfileChangeModal
              et SupportThreadModal : plafond sur la feuille, SafeAreaView autour du seul pied. */}
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Clôture mensuelle</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={closeModal} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {/* Le parcours, annoncé avant d'être parcouru (composant partagé avec la saisie).
                Pas de titre à l'étape 1 : le bloc du mois juste en dessous dit déjà de quoi il
                s'agit, et deux phrases d'introduction l'une sur l'autre n'aident personne. */}
            <StepRail current={step} total={totalSteps} style={{ marginTop: 2, marginBottom: 10 }} />
            {step > 1 && <Text style={styles.stepHeading}>{stepTitle}</Text>}

            {/* Contenu défilant : le mode « je ne sais pas » ajoute une date, un champ par compte
                et un curseur — sur un petit écran, la feuille dépassait sans qu'on puisse atteindre
                le bouton. */}
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">

            {/* ══ ÉTAPE 1 — de quoi il s'agit, et comment on veut s'y prendre ══════════════════ */}
            {step === 1 && (
              <>
                <View style={styles.hero}>
                  <View style={styles.heroBadge}>
                    <Ionicons name="lock-closed" size={19} color={COLORS.emerald} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroKicker}>
                      {flash ? `${effectivePending.length} mois à clôturer, jusqu'à` : 'Mois à clôturer'}
                    </Text>
                    <Text style={styles.heroMonth}>
                      {flash ? monthLabel(effectivePending[effectivePending.length - 1] ?? oldest ?? '') : (oldest ? monthLabel(oldest) : '—')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.heroText}>
                  Clôturer, c’est dire « ce mois-là est juste ». Tes moyennes, ton budget et tes
                  recommandations repartent alors d’une base sûre. Rien n’est verrouillé : tu pourras
                  toujours y revenir.
                </Text>

                {/* Compte joint déjà clôturé par quelqu'un d'autre : on l'ANNONCE plutôt que de le faire
                    disparaître sans explication — sinon on cherche son compte dans la liste. */}
                {alreadyClosed.length > 0 && (
                  <View style={styles.jointNote}>
                    <Ionicons name="people-outline" size={15} color={COLORS.emerald} />
                    <Text style={styles.jointNoteText}>
                      {alreadyClosed.length === 1
                        ? `« ${alreadyClosed[0].name} » porte déjà une clôture pour ce mois${alreadyClosed[0].joint ? ' (faite par un autre participant)' : ''} : rien à refaire de ton côté.`
                        : `${alreadyClosed.length} comptes portent déjà une clôture pour ce mois : ${alreadyClosed.map((a) => a.name).join(', ')}.`}
                    </Text>
                  </View>
                )}

                {multiple && (
                  <>
                    <Text style={styles.sectionLabel}>Combien de mois à la fois ?</Text>
                    <SegmentedControl
                      options={[
                        { value: 'one', label: 'Mois par mois' },
                        { value: 'all', label: "Tout d'un coup" },
                      ]}
                      value={flash ? 'all' : 'one'}
                      onChange={(v) => setFlash(v === 'all')}
                      role="radio"
                      style={{ marginBottom: 4 }}
                    />
                  </>
                )}

                {/* Le choix du mode n'a de sens que s'il reste un compte à vérifier. Sans ça, deux
                    options sur trois étaient grisées et la troisième ne faisait rien de ce qu'elle
                    annonçait. */}
                {nothingToVerify ? (
                  <View style={styles.infoCard}>
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.emerald} />
                    <Text style={styles.infoText}>
                      Aucun solde à vérifier de ton côté pour ce mois : tes comptes portent déjà leur
                      clôture. Il ne reste qu’à marquer le mois comme traité.
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.sectionLabel}>Comment veux-tu t’y prendre ?</Text>
                    {modeCards.map((m) => {
                      const on = mode === m.key;
                      return (
                        <TouchableOpacity
                          key={m.key}
                          style={[styles.modeCard, on && styles.modeCardOn]}
                          onPress={() => setMode(m.key)}
                          activeOpacity={0.85}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                        >
                          <View style={[styles.modeIcon, on && styles.modeIconOn]}>
                            <Ionicons name={m.icon as any} size={18} color={on ? COLORS.onAccent : COLORS.textSecondary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.modeTitle, on && { color: COLORS.emerald }]}>{m.title}</Text>
                            <Text style={styles.modeSub}>{m.sub}</Text>
                          </View>
                          <Ionicons
                            name={on ? 'radio-button-on' : 'radio-button-off'}
                            size={19}
                            color={on ? COLORS.emerald : COLORS.cardBorder}
                          />
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </>
            )}

            {/* ══ ÉTAPE 2 — la saisie (ou la simple validation) ════════════════════════════════ */}
            {step === 2 && (mode === 'unknown' ? (
              <>
                <Text style={styles.hint}>
                  Pas besoin de retrouver ce que valait ton compte fin {targetKey ? monthLabel(targetKey) : ''} :
                  donne le solde que tu as sous les yeux, on remonte le temps à l’étape suivante.
                </Text>

                <Text style={styles.stepLabel}>Date de ce solde</Text>
                <TextInput
                  style={styles.input}
                  value={formatDateFrench(unknownDate)}
                  onChangeText={(v) => { const iso = parseDateFromFrench(v); if (iso) setUnknownDate(iso); }}
                  placeholder="jj-mm-aaaa"
                  placeholderTextColor={COLORS.textSecondary}
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.stepLabel}>
                  {checkingAccounts.length > 1 ? 'Solde de chaque compte à cette date' : 'Solde de ton compte à cette date'}
                </Text>
                {checkingAccounts.map((acc) => (
                  <View key={acc.id} style={styles.acctInputRow}>
                    {checkingAccounts.length > 1 && <Text style={styles.acctName} numberOfLines={1}>{acc.name}</Text>}
                    <TextInput
                      style={[styles.input, checkingAccounts.length > 1 && { flex: 1, marginBottom: 0 }]}
                      value={balances[acc.id] ?? ''}
                      onChangeText={(v) => setBalances((p) => ({ ...p, [acc.id]: sanitizeSignedAmountInput(v) }))}
                      keyboardType="decimal-pad"
                      placeholder={`Ex. ${Math.round(acc.balance)}`}
                      placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                ))}
                {/* Même règle qu'en « Solde réel », et dite au même endroit : un champ vide n'est
                    pas un compte oublié, c'est un compte confirmé. */}
                <Text style={styles.hint}>
                  {checkingAccounts.length > 1
                    ? 'Laisse vide les comptes déjà bons : aucun écart pour eux, ils seront simplement marqués comme vérifiés.'
                    : 'Laisse vide si le montant proposé est déjà le bon : aucun écart, il sera simplement marqué comme vérifié.'}
                </Text>
              </>
            ) : mode === 'direct' ? (
              <>
                <Text style={styles.hint}>
                  {nothingToVerify
                    ? "Il n'y a aucun solde à vérifier de ton côté pour ce mois. Valide simplement pour le marquer comme traité."
                    : 'Voici ce que Relyka a calculé pour la fin du mois. Si ça correspond à ton relevé, valide.'}
                </Text>
                {hasChecking && targetKey && (
                  <View style={styles.balanceList}>
                    {checkingAccounts.map((acc) => (
                      <View key={acc.id} style={styles.balanceBox}>
                        <Text style={styles.balanceLabel} numberOfLines={1}>{checkingAccounts.length > 1 ? acc.name : 'Solde du compte courant'} à fin {monthLabel(targetKey)}</Text>
                        <Text style={styles.balanceValue}>{fmtIn(balanceAtEndFor(acc.id, acc.balance), acc.currency)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.label}>
                  {checkingAccounts.length > 1 ? 'Solde réel de chaque compte courant' : 'Solde réel de ton compte courant'} à fin {targetKey ? monthLabel(targetKey) : ''}
                </Text>
                {checkingAccounts.map((acc) => (
                  <View key={acc.id} style={styles.acctInputRow}>
                    {checkingAccounts.length > 1 && <Text style={styles.acctName} numberOfLines={1}>{acc.name}</Text>}
                    <TextInput
                      style={[styles.input, checkingAccounts.length > 1 && { flex: 1, marginBottom: 0 }]}
                      value={balances[acc.id] ?? ''}
                      onChangeText={(v) => setBalances((p) => ({ ...p, [acc.id]: sanitizeSignedAmountInput(v) }))}
                      keyboardType="decimal-pad"
                      placeholder={`Ex. ${Math.round(balanceAtEndFor(acc.id, acc.balance))}`}
                      placeholderTextColor={COLORS.textSecondary}
                    />
                  </View>
                ))}
                {/* La règle du CHAMP VIDE est dite ici, et pas seulement appliquée : c'est la seule
                    chose non devinable de cet écran. Le placeholder montre déjà le solde calculé,
                    donc ne rien saisir revient à le confirmer — et ça s'enregistre, comme le reste. */}
                <Text style={styles.hint}>
                  Une transaction d'ajustement sera créée au {formatDateFrench(lastDayOfMonthKey(targetKey ?? ''))} pour
                  chaque compte dont tu corriges le solde.
                  {checkingAccounts.length > 1
                    ? ' Laisse vide ceux qui sont déjà bons : ils seront simplement marqués comme vérifiés.'
                    : ' Laisse vide si le montant proposé est déjà le bon : il sera simplement marqué comme vérifié.'}
                </Text>
              </>
            ))}

            {/* ══ ÉTAPE 3 — « je ne sais plus » : à quel mois appartient l'écart ? ═════════════ */}
            {step === 3 && mode === 'unknown' && (
              <>
                {/* Répartition — la position de départ est le prorata par jours, mais c'est
                    l'utilisateur qui tranche : lui seul sait si l'écart vient de juillet ou d'août.
                    Pas de Slider natif dans l'app → 5 crans, tapables. */}
                {(() => {
                  const firstAcc = checkingAccounts[0];
                  if (!firstAcc) return null;
                  const totalGap = unknownTotalGap();

                  {/* Filet : on n'arrive normalement ici qu'avec un solde saisi (le bouton de
                      l'étape précédente l'exige), mais un compte retiré entre-temps ferait
                      autrement une étape vide, sans rien qui l'explique. */}
                  if (!hasAnyAmount) {
                    return (
                      <View style={styles.splitPending}>
                        <Ionicons name="hourglass-outline" size={15} color={COLORS.textSecondary} />
                        <Text style={styles.splitPendingText}>
                          Reviens à l'étape précédente pour saisir un solde : sans lui, il n'y a pas
                          d'écart à répartir entre {targetKey ? monthLabel(targetKey) : 'ce mois'} et le mois en cours.
                        </Text>
                      </View>
                    );
                  }
                  if (Math.abs(totalGap) < 0.005) {
                    return (
                      <View style={styles.splitPending}>
                        <Ionicons name="checkmark-circle-outline" size={15} color={COLORS.emerald} />
                        <Text style={[styles.splitPendingText, { color: COLORS.emerald }]}>
                          Aucun écart : ce que tu as saisi correspond exactement à ce que Relyka avait
                          calculé. Rien à répartir.
                        </Text>
                      </View>
                    );
                  }

                  const pct = unknownSharePct(firstAcc.id);
                  return (
                    <View style={styles.splitBox}>
                      <Text style={styles.splitTitle}>
                        Écart constaté : {fmt(totalGap)}. Quelle part était en {targetKey ? monthLabel(targetKey) : 'ce mois'} ?
                      </Text>
                      <View style={styles.splitSteps}>
                        {[0, 25, 50, 75, 100].map((v) => (
                          <TouchableOpacity
                            key={v}
                            style={[styles.splitStep, Math.abs(pct - v) < 13 && styles.splitStepOn]}
                            onPress={() => setUnknownShare(v)}
                            activeOpacity={0.75}
                          >
                            <Text style={[styles.splitStepText, Math.abs(pct - v) < 13 && styles.splitStepTextOn]}>{v} %</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.splitResult}>
                        <Text style={styles.splitResultItem}>
                          {targetKey ? monthLabel(targetKey) : ''} : <Text style={styles.splitResultVal}>{fmt(totalGap * (pct / 100))}</Text>
                        </Text>
                        <Text style={styles.splitResultItem}>
                          Mois en cours : <Text style={styles.splitResultVal}>{fmt(totalGap * (1 - pct / 100))}</Text>
                        </Text>
                      </View>
                      {unknownShare == null && (
                        <Text style={styles.splitHint}>Proposition calculée au prorata des jours — corrige-la si tu sais mieux.</Text>
                      )}
                    </View>
                  );
                })()}
              </>
            )}

            {/* ── CE QUE ÇA FAIT À TON SOLDE D'AUJOURD'HUI ─────────────────────────────────────
                La question que se pose vraiment l'utilisateur après avoir validé, et à laquelle
                rien ne répondait : « mon compte affiche-t-il autre chose maintenant ? »

                La réponse dépend d'un point non évident : une régularisation est une ANCRE. Elle
                dit « à cette date, le compte valait exactement ça », et le solde d'aujourd'hui se
                déduit de la PLUS RÉCENTE d'entre elles. Corriger le 31 juillet alors qu'on a déjà
                confirmé son solde le 5 août ne peut donc rien déplacer — l'écart est déjà compris
                dans la vérification du 5. C'est juste, mais totalement invisible : on validait, le
                solde ne bougeait pas d'un centime, et on en concluait que la clôture était cassée.
                On l'annonce donc AVANT, chiffre à l'appui. */}
            {(() => {
              // Jamais à l'étape du CHOIX : rien n'est encore saisi, il n'y a donc rien à annoncer.
              if (step === 1 || !targetKey || mode === 'direct') return null;
              const monthEnd = lastDayOfMonthKey(targetKey);
              const blocked = checkingAccounts
                .filter((acc) => {
                  const raw = balances[acc.id];
                  if (raw == null || raw.trim() === '') return false;
                  return !!laterVerification(allTx as any[], acc.id, mode === 'unknown' ? unknownDate : monthEnd);
                })
                .map((acc) => ({
                  name: acc.name,
                  at: laterVerification(allTx as any[], acc.id, mode === 'unknown' ? unknownDate : monthEnd)!.date,
                }));
              if (blocked.length === 0) return null;
              return (
                <View style={styles.laterNote}>
                  <Ionicons name="time-outline" size={15} color={COLORS.blue} />
                  <Text style={styles.laterNoteText}>
                    {blocked.length === 1
                      ? `Tu as déjà vérifié « ${blocked[0].name} » le ${formatDateFrench(blocked[0].at)} : cette correction range le passé, mais ton solde d'aujourd'hui ne bougera pas — l'écart est déjà compris dans cette vérification-là.`
                      : `Tu as déjà vérifié ${blocked.length} de ces comptes après la période clôturée : la correction range le passé, mais tes soldes d'aujourd'hui ne bougeront pas.`}
                  </Text>
                </View>
              );
            })()}

            {/* ── Aperçu AVANT validation : impact exact par mois (bloc structuré, pas de surprise) ── */}
            {(() => {
              if (!targetKey) return null;
              /* Il annonce ce que fera le bouton : il n'a donc sa place qu'à l'étape qui le porte.
                 En « je ne sais plus », c'est l'étape 3 — avant la répartition, la moitié des
                 montants annoncés n'existe pas encore. */
              if (!isLastStep) return null;
              /* Aucun compte à vérifier → on n'annonce ni écart, ni solde confirmé : il n'y a
                 rien à confirmer. Le mois est simplement marqué comme traité, et le badge
                 « mois fermé » de la ligne suffit à le dire. */
              if (nothingToVerify) {
                return (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewTitle}>Si tu valides :</Text>
                    <View style={styles.previewRow}>
                      <Text style={styles.previewMonth}>{monthLabel(targetKey)}</Text>
                      <Text style={[styles.previewValue, { color: COLORS.textSecondary }]}>aucune écriture</Text>
                      <View style={styles.previewBadge}>
                        <Ionicons name="checkmark" size={10} color={COLORS.emerald} />
                        <Text style={styles.previewBadgeText}>mois fermé</Text>
                      </View>
                    </View>
                  </View>
                );
              }
              type Row = { label: string; regul: number; closed?: boolean };
              const rows: Row[] = [];
              if (mode === 'direct') {
                rows.push({ label: monthLabel(targetKey), regul: 0, closed: true });
              } else if (mode === 'unknown') {
                /* ⚠️ Le mode « je ne sais pas » a sa PROPRE arithmétique : l'écart se mesure contre
                   le solde à `unknownDate`, et se répartit selon le curseur choisi plus haut.
                   L'aperçu appliquait ici la formule du mode « solde réel » (écart contre la FIN DU
                   MOIS, réparti au prorata des jours) : il annonçait donc un montant différent de
                   celui affiché quelques lignes plus haut — parfois de signe opposé. Deux réponses
                   contradictoires à la même question, dans la même fenêtre. */
                if (!hasAnyAmount) return null;
                /* Réparti COMPTE PAR COMPTE, comme le fera `confirm()`. Tant que le curseur n'a pas
                   été touché, chaque compte reçoit son propre prorata (il dépend de sa dernière
                   vérification) : appliquer le pourcentage du premier compte à la somme donnerait un
                   aperçu faux dès qu'il y a deux comptes aux historiques différents. */
                let closingTotal = 0, currentTotal = 0;
                for (const acc of checkingAccounts) {
                  const gap = unknownGapOf(acc);
                  if (Math.abs(gap) <= 0.005) continue;
                  const part = gap * (unknownSharePct(acc.id) / 100);
                  closingTotal += part;
                  currentTotal += gap - part;
                }
                rows.push({ label: monthLabel(targetKey), regul: closingTotal, closed: true });
                if (Math.abs(currentTotal) > 0.005) rows.push({ label: monthLabel(ym(new Date())), regul: currentTotal });
              } else {
                /* Mode « solde réel » : le montant saisi EST celui de la fin du mois, donc l'écart
                   appartient entièrement à ce mois — aucune ligne sur le mois courant. L'aperçu
                   reproduisait ici la répartition au prorata que `confirm()` appliquait aux mois
                   anciens ; les deux ont été retirés ensemble (cf. le commentaire de `confirm`). */
                let closingTotal = 0, any = false;
                for (const acc of checkingAccounts) {
                  const raw = balances[acc.id];
                  if (raw == null || raw.trim() === '') continue;
                  const nb = parseFloat(raw.replace(',', '.'));
                  if (Number.isNaN(nb)) continue;
                  any = true;
                  // Écart de CE compte, dans SA devise → ramené en référence avant d'être cumulé.
                  closingTotal += toRef(nb - balanceAtEndFor(acc.id, acc.balance), acc.currency);
                }
                if (!any) return null;
                rows.push({ label: monthLabel(targetKey), regul: closingTotal, closed: true });
              }
              return (
                <View style={styles.previewBox}>
                  <Text style={styles.previewTitle}>Si tu valides :</Text>
                  {rows.map((r) => (
                    <View key={r.label} style={styles.previewRow}>
                      <Text style={styles.previewMonth}>{r.label}</Text>
                      <Text style={[styles.previewValue, { color: Math.abs(r.regul) < 0.005 ? COLORS.emerald : r.regul < 0 ? COLORS.danger : COLORS.green }]}>
                        {Math.abs(r.regul) < 0.005 ? 'écart 0 — solde confirmé' : `régularisation : ${r.regul > 0 ? '+' : '−'}${fmt(Math.abs(r.regul))}`}
                      </Text>
                      {r.closed && (
                        <View style={styles.previewBadge}>
                          <Ionicons name="checkmark" size={10} color={COLORS.emerald} />
                          <Text style={styles.previewBadgeText}>mois fermé</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              );
            })()}

            {/* Ce que la clôture écrit en base — dit à l'étape qui l'exécute, pas trois écrans avant. */}
            {isLastStep && (
              <View style={styles.lockNote}>
                <Ionicons name="information-circle-outline" size={15} color={COLORS.textSecondary} />
                <Text style={styles.lockNoteText}>
                  {nothingToVerify
                    ? "Aucune écriture ne sera enregistrée : ce mois est déjà vérifié sur tes comptes. Rien n'est verrouillé, tu pourras toujours corriger plus tard."
                    : "La clôture enregistre une régularisation datée pour fiabiliser tes calculs. Rien n'est verrouillé : tu pourras toujours corriger plus tard."}
                </Text>
              </View>
            )}

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color={COLORS.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            </ScrollView>
            {/* Le bouton reste HORS du défilement : il doit être atteignable sans dérouler.
                SafeAreaView NATIF (edges bottom) : il mesure les insets de SA fenêtre — celle du
                Modal — donc le bouton reste au-dessus de la barre de navigation du téléphone. */}
            <SafeAreaView edges={['bottom']}>
              {/* Un mode qui réclame un montant et n'en a pas ne clôture RIEN : `confirm()` saute
                  chaque compte vide et se contente de fermer le mois, sans la moindre vérification.
                  L'utilisateur croyait avoir donné son solde. On bloque donc le bouton, et on dit
                  ce qui manque plutôt que de laisser valider un geste creux.
                  Le blocage porte sur l'étape de SAISIE : à l'étape du choix, il n'y a encore rien
                  à saisir — un bouton grisé d'entrée de jeu n'aurait rien voulu dire. */}
              {step >= 2 && needsAmount && !hasAnyAmount && (
                <Text style={styles.confirmHint}>
                  Saisis d'abord {checkingAccounts.length > 1 ? 'au moins un solde' : 'ton solde'} ci-dessus.
                </Text>
              )}
              <View style={styles.footerRow}>
                {step > 1 && (
                  <AppButton
                    label="Précédent"
                    variant="secondary"
                    size="lg"
                    icon="chevron-back"
                    onPress={goPrevStep}
                    disabled={busy}
                    style={{ flexShrink: 0 }}
                  />
                )}
                <AppButton
                  label={isLastStep ? `Clôturer${flash ? ' tout' : ''}` : 'Continuer'}
                  size="lg"
                  full
                  icon={isLastStep ? 'lock-closed' : 'arrow-forward'}
                  iconRight={!isLastStep}
                  loading={busy}
                  disabled={busy || (step >= 2 && needsAmount && !hasAnyAmount)}
                  onPress={goNextStep}
                />
              </View>
              {/* Échappatoire assumée : clôturer demande d'avoir ses relevés sous les yeux, ce qui
                  n'est pas toujours le cas au moment où l'app s'ouvre. Sans elle, la seule sortie
                  était la croix — qui ne mémorise rien et ramène la modale à l'ouverture suivante.
                  Elle reste à l'étape 1 : c'est là qu'on décide si c'est le moment, pas au milieu
                  d'une saisie déjà commencée. */}
              {step === 1 && (
                <TouchableOpacity
                  style={styles.laterBtn}
                  onPress={snoozeAndClose}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Me le rappeler demain"
                >
                  <Text style={styles.laterText}>Me le rappeler demain</Text>
                </TouchableOpacity>
              )}
            </SafeAreaView>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.yellow + '1A', borderWidth: 1, borderColor: c.yellow + '55',
      borderRadius: 14, padding: 14, marginHorizontal: 8, marginBottom: 10,
    },
    bannerTitle: { fontSize: 14, fontWeight: '800', color: c.text },
    bannerText: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    // paddingBottom réduit : c'est le SafeAreaView du pied qui ajoute désormais la hauteur réelle de
    // la barre système. Cumuler les deux repoussait le bouton hors de l'écran sur les petits mobiles.
    sheet: {
      ...sheetWidth, maxHeight: '92%',
      backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderColor: c.cardBorder, padding: 22, paddingBottom: 16, gap: 6,
    },
    /* Le défilement absorbe TOUT le rétrécissement : `flexGrow: 0` (ne pousse pas le pied vers le bas
       quand le contenu est court) + `flexShrink: 1` (cède la place au pied quand il est long). Sans
       ça, la ScrollView web garde sa hauteur de contenu et chasse le bouton hors du cadre. */
    scroll: { flexGrow: 0, flexShrink: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    title: { fontSize: 19, fontWeight: '800', color: c.text },

    /* ── Le parcours ────────────────────────────────────────────────────────────────────────────
       Une seule question par étape, annoncée par un titre : c'est lui qui remplace les trois
       encadrés d'explication que l'écran empilait avant de poser quoi que ce soit. */
    stepHeading: { fontSize: 16.5, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 12 },

    // Étape 1 — le mois concerné, mis en avant comme le sujet de la conversation.
    hero: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.emerald + '12', borderWidth: 1, borderColor: c.emerald + '33',
      borderRadius: 16, padding: 14,
    },
    heroBadge: {
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.emerald + '22', borderWidth: 1, borderColor: c.emerald + '44',
    },
    heroKicker: { fontSize: 11.5, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
    heroMonth: { fontSize: 21, fontWeight: '800', color: c.emerald, textTransform: 'capitalize', marginTop: 1 },
    heroText: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginTop: 10 },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },

    /* Le choix du mode : trois CARTES, une phrase chacune. C'étaient trois segments de deux mots
       qu'il fallait essayer pour comprendre ce qu'ils changeaient. */
    modeCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 13,
    },
    modeCardOn: { borderColor: c.emerald, backgroundColor: c.emerald + '10' },
    modeIcon: {
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    },
    modeIconOn: { backgroundColor: c.emerald, borderColor: c.emerald },
    modeTitle: { fontSize: 14.5, fontWeight: '800', color: c.text },
    modeSub: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 2 },
    // « Rien à vérifier » : un état, pas un choix — il ne prend donc pas la forme d'une carte cliquable.
    infoCard: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16,
      backgroundColor: c.emerald + '12', borderWidth: 1, borderColor: c.emerald + '33',
      borderRadius: 14, padding: 13,
    },
    infoText: { flex: 1, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
    // Pied : « Précédent » ne prend que sa largeur, l'action principale occupe le reste.
    footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
    balanceList: { marginTop: 8, gap: 6 },
    balanceBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, paddingVertical: 12, paddingHorizontal: 14 },
    balanceLabel: { fontSize: 13, color: c.textSecondary, flex: 1, marginRight: 8 },
    balanceValue: { fontSize: 17, fontWeight: '800', color: c.text },
    acctInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    acctName: { fontSize: 13, fontWeight: '600', color: c.text, width: 110 },
    // Comptes joints : ce qu'un autre participant a déjà fait — dit, jamais escamoté.
    jointNote: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4, marginBottom: 4,
      backgroundColor: c.emerald + '12', borderWidth: 1, borderColor: c.emerald + '3A',
      borderRadius: 12, padding: 11,
    },
    jointNoteText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    // « Tu as déjà vérifié ce compte plus tard » : ce qui explique un solde qui ne bouge pas.
    laterNote: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12,
      backgroundColor: c.blue + '12', borderWidth: 1, borderColor: c.blue + '3A',
      borderRadius: 12, padding: 11,
    },
    laterNoteText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17 },

    /* (Le récapitulatif « 1. la date  2. le montant  3. la répartition » a disparu : le fil
       d'étapes le dit mieux, en haut de la feuille, et pour les trois modes.) */
    stepLabel: { fontSize: 13, fontWeight: '800', color: c.text, marginTop: 16, marginBottom: 6 },
    /* Étape de répartition sans écart à répartir : visible, mais inactive. */
    splitPending: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed',
      borderColor: c.cardBorder, backgroundColor: c.card, marginBottom: 10,
    },
    splitPendingText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17 },

    // Mode « je ne sais pas » : répartition de l'écart entre le mois clôturé et le mois en cours.
    splitBox: {
      marginTop: 4, marginBottom: 10, gap: 8, padding: 12,
      borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    },
    splitTitle: { fontSize: 12.5, color: c.text, fontWeight: '700', lineHeight: 18 },
    splitSteps: { flexDirection: 'row', gap: 6 },
    splitStep: {
      flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10,
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
    },
    splitStepOn: { borderColor: c.emerald, backgroundColor: c.emerald + '20' },
    splitStepText: { fontSize: 11.5, fontWeight: '700', color: c.textSecondary },
    splitStepTextOn: { color: c.emerald },
    splitResult: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
    splitResultItem: { fontSize: 12, color: c.textSecondary },
    splitResultVal: { fontWeight: '800', color: c.text },
    splitHint: { fontSize: 11, color: c.textSecondary, fontStyle: 'italic' },
    /* (Les segments maison ont laissé la place à `components/ui/SegmentedControl` pour le choix
       « mois par mois / tout d'un coup », et à des cartes pour le choix du mode.) */
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontWeight: '700', color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    hint: { fontSize: 12, color: c.textSecondary, marginTop: 10, lineHeight: 17 },
    previewBox: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.emerald + '44', padding: 12, marginTop: 14, gap: 8 },
    previewTitle: { fontSize: 12.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    previewMonth: { fontSize: 13.5, fontWeight: '800', color: c.text, textTransform: 'capitalize', minWidth: 74 },
    previewValue: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
    previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.emerald + '18', borderWidth: 1, borderColor: c.emerald + '55', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
    previewBadgeText: { fontSize: 10, fontWeight: '800', color: c.emerald },
    lockNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderRadius: 10, padding: 10, marginTop: 16 },
    lockNoteText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 16 },
    errorBox: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10,
      borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12',
      borderRadius: 12, padding: 11,
    },
    errorText: { flex: 1, fontSize: 12.5, color: c.danger, lineHeight: 17 },
    confirmHint: { fontSize: 11.5, color: c.textSecondary, textAlign: 'center', marginTop: 12, fontStyle: 'italic' },
    // (Les boutons du pied sont des `AppButton` — un seul bouton dans toute l'app.)
    // Volontairement discret : c'est une sortie, pas une action concurrente de la clôture.
    laterBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 2 },
    laterText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  });
}
