/**
 * usePilotageViewModel — le CÂBLAGE des calculs dérivés du Pilotage.
 *
 * Les calculs eux-mêmes sont purs et vivent dans `lib/pilotageView` (testables sans React) ; ce
 * hook ne fait que les mémoïser et les brancher aux requêtes. La séparation est volontaire : la
 * mémoïsation est une affaire de performance, le calcul une affaire d'exactitude — on ne teste pas
 * les deux de la même façon.
 *
 * La liste d'entrées est longue, et c'est le résultat recherché : ces dépendances existaient déjà,
 * mais implicitement, capturées par fermeture au milieu de 400 lignes de composant. Les nommer est
 * la seule façon de voir ce dont le tableau de bord dépend réellement.
 *
 * Cf. docs/PLAN_REFACTOR_TESTS.md, phase C2.
 */
import React from 'react';
import { floorToTen, type RatesMap } from '../../lib/finance/currency';
import { computeRecommendations, type SmartRecommendation } from '../../lib/finance/recommendationEngine';
import { buildRecoOptions } from '../../lib/finance/recoInputs';
import { buildRecoMessages, buildRelykaMessages, composeGuardMessage } from '../../lib/finance/recoMessages';
import { unverifiedSincePhrase } from '../../lib/finance/confidenceEngine';
import { deriveRelykaConfidence } from './useReliability';
import type { AppColors } from '../../theme/palette';
import type { PilotageData } from '../../lib/finance/pilotageEngine';
import type { FinancialProfileId } from '../../types/database';
import type { WelcomeStep } from '../../components/pilotage/PilotageWelcome';
import {
  monthReservationsTotal,
  computeRelykaBreakdown,
  buildRelykaBaseMessage,
  computeSuiviDetail,
  computeRecurUpcoming,
  computeSetupState,
  pickMainCheckingId,
  relykaTone,
  type RelykaBreakdown,
  type SuiviDetail,
} from '../../lib/finance/pilotageView';

export interface PilotageViewModelInput {
  pilotageData: PilotageData | null | undefined;
  /** Comptes du périmètre COMPLET (soldes, devises) — pour les liens et les conversions. */
  accounts: any[];
  /** Comptes filtrés par le périmètre quotidien — ce que comptent les modaux de suivi. */
  accountsForSuivi: any[];
  /** Transactions transformées par le périmètre — même filtre que le moteur. */
  txForSuivi: any[];
  /** Transactions personnelles brutes — servent au seul constat « compte encore vide ». */
  txPerso: any[];
  reservations: Array<{ created_at?: string | null; montant: number | string }>;
  preSavings: { epargne: { total_cumule: number }; invest: { total_cumule: number } } | null | undefined;
  profile: any;
  rates: RatesMap;
  reliabilityCfg: any;
  financialProfile: { profile_id?: string } | null | undefined;
  recoThresholds: any;
  customTiers: any;
  colors: AppColors;
  /** Lectures des comptes ET des opérations ABOUTIES — cf. `baseDataReady` dans l'écran. */
  baseDataReady: boolean;
  /** `userGuide.is` — l'étape en cours du parcours de démarrage. */
  guideIs: (step: string) => boolean;
}

export interface PilotageViewModel extends RelykaBreakdown {
  preEpargneTotal: number;
  preInvestTotal: number;
  reservationsTotal: number;
  mainCheckingId: string | undefined;
  hasRecurringTx: boolean;
  noAccountsYet: boolean;
  hasAnyTx: boolean;
  setupIncomplete: boolean;
  setupHint: string;
  firstName: string | null;
  welcomeStep: WelcomeStep | null;
  welcomeRoute: string;
  relConf: ReturnType<typeof deriveRelykaConfidence> | null;
  recoList: SmartRecommendation[];
  relykaBase: { text: string; isGeneric: boolean };
  /** Couleur du chiffre principal (cf. `relykaTone`) — l'écran la consomme, il ne la recalcule pas. */
  relykaColor: string;
  recoFinancials: { currentChecking: number; projectedEndChecking: number | undefined } | undefined;
  recoMessages: ReturnType<typeof buildRecoMessages>;
  relykaMessages: ReturnType<typeof buildRelykaMessages>;
  suiviDetail: SuiviDetail;
  recurUpcoming: { amount: number; count: number; list: any[] };
}

export function usePilotageViewModel(input: PilotageViewModelInput): PilotageViewModel {
  const {
    pilotageData, accounts, accountsForSuivi, txForSuivi, txPerso, reservations, preSavings,
    profile, rates, reliabilityCfg, financialProfile, recoThresholds, customTiers, colors,
    baseDataReady, guideIs,
  } = input;

  const preEpargneTotal = preSavings?.epargne.total_cumule ?? 0;
  const preInvestTotal = preSavings?.invest.total_cumule ?? 0;

  const reservationsTotal = React.useMemo(() => monthReservationsTotal(reservations), [reservations]);

  const mainCheckingId = React.useMemo(() => pickMainCheckingId(accounts), [accounts]);

  const breakdown = React.useMemo(
    () => computeRelykaBreakdown(pilotageData, { reservationsTotal, preEpargneTotal, preInvestTotal }),
    [pilotageData, reservationsTotal, preEpargneTotal, preInvestTotal],
  );

  const setup = React.useMemo(
    () => computeSetupState(accounts, txPerso, breakdown.relykaAffiche),
    [accounts, txPerso, breakdown.relykaAffiche],
  );

  const firstName = ((profile as any)?.full_name ?? '').trim().split(/\s+/)[0] || null;

  /* ── PENDANT L'INSTALLATION, PAS DE TABLEAU DE BORD ────────────────────────────────────────────
     Le Relyka n'est pas calculable tant qu'il manque les comptes ou les flux du mois : le montrer
     à 0 € avec ses quatre recommandations vides ferait croire que l'app ne sert à rien, au moment
     précis où il faut au contraire dire quoi faire ensuite. On remplace donc TOUT le contenu par
     l'accueil, dont le bouton porte la prochaine action.
     Deux façons d'y entrer, et c'est voulu : le PARCOURS de démarrage (guide.inSetup, qui suit ses
     propres étapes), et le simple constat « aucun compte / aucune opération » — qui vaut aussi pour
     un compte ancien vidé de ses données, lequel n'est plus dans le parcours. */
  const welcomeStep: WelcomeStep | null =
    guideIs('accounts') ? 'accounts'
    : guideIs('accounts_checking') ? 'checking'
    : guideIs('accounts_savings') ? 'savings'
    : guideIs('tx_recurring') ? 'recurring'
    // Constat « aucun compte / aucune opération » : ne vaut que sur des lectures ABOUTIES
    // (cf. baseDataReady) — sinon l'accueil s'affiche pendant le chargement d'un compte installé.
    : !baseDataReady ? null
    : setup.noAccountsYet ? 'accounts'
    : !setup.hasAnyTx ? 'recurring'
    : null;
  /** Où le bouton de l'accueil emmène : là où l'étape se joue réellement. */
  const welcomeRoute = welcomeStep === 'recurring' ? '/(tabs)/transactions' : '/(tabs)/comptes';

  // ── Confiance (fourchettes) : une seule fonction de doute, alimentée par le VRAI Relyka. ──
  const relConf = React.useMemo(
    () => (reliabilityCfg && pilotageData ? deriveRelykaConfidence(pilotageData, breakdown.resteDisponible, reliabilityCfg) : null),
    [reliabilityCfg, pilotageData, breakdown.resteDisponible],
  );

  /* ── Budget de recommandation (§P7) ──
     Options du moteur construites par lib/recoInputs (budget brut reconstitué, alreadyAllocated,
     cascade, garde-fou projection, plafond Relyka) — PARTAGÉES avec le Pouls (capacité de la carte
     « Investissement du mois ») : les deux écrans racontent la même histoire.
     MÉMOÏSÉ (perf) : ces deux blocs faisaient tourner le moteur de recos À CHAQUE re-rendu de
     l'écran (le plus lourd de l'app) — y compris au rattrapage post-gel du changement d'onglet. */
  const recoOptions = React.useMemo(() => (
    pilotageData
      ? buildRecoOptions(pilotageData, {
          reservationsTotal,
          preEpargneTotal,
          preInvestTotal,
          prudenceLevel: ((profile as any)?.prudence_level ?? null) as number | null,
          financialProfileId: financialProfile?.profile_id as FinancialProfileId | undefined,
          thresholds: recoThresholds,
          customTierAllocations: customTiers,
        })
      : null
  ), [pilotageData, reservationsTotal, preEpargneTotal, preInvestTotal, profile, financialProfile, recoThresholds, customTiers]);

  // Garde-fou : aucune reco ne peut dépasser le reste réellement disponible (Ton Relyka).
  // Plafond passé AU MOTEUR (maxAmount) et non appliqué après coup : sinon la description et les
  // conseils interpolent le montant d'avant-plafond (ex. « Conserve 600 € » avec un titre à 270 €).
  const recoList = React.useMemo(() => {
    if (!pilotageData || !recoOptions) return [];
    // Couleur d'affichage par type de reco — alignée sur les couleurs sémantiques du thème
    // (clair/sombre) plutôt que sur les teintes fixes de l'engine, qui restaient trop claires
    // en mode clair (ex. épargne #34d399 au lieu du vert défini #059669).
    const recoColorByType: Record<string, string> = {
      save:   colors.green,
      invest: colors.violet,
      enjoy:  colors.orange,
      keep:   colors.blue,
    };
    return computeRecommendations(pilotageData, {
      ...recoOptions,
      /* Montant « actionnable » (textes + CTA). Le doute est DIRECTIONNEL :
          • épargner / investir SORTENT l'argent du compte (irréversible) → borne basse « minimum
            sûr », mais planchée (relConf.actionable) pour ne jamais proposer 0 € ;
          • « Conserver » ne sort rien du compte : en cas de doute il faut en garder PLUS, pas moins
            → montant plein. Proposer la borne basse revenait à conseiller de mettre moins de côté
            justement parce qu'on est moins sûr de soi. */
      actionAmountFor: (amount, type) => {
        if (type === 'keep') return { value: amount, isRange: false };
        const r = relConf?.actionable(amount);
        return r?.isRange
          ? { value: Math.max(0, floorToTen(r.low)), isRange: true }
          : { value: amount, isRange: false };
      },
    }).map((r) => ({
      ...r,
      color: recoColorByType[r.type] ?? r.color,
    }));
  }, [pilotageData, recoOptions, relConf, colors]);

  const relykaBase = React.useMemo(
    () => buildRelykaBaseMessage(breakdown, !!relConf?.relykaRange.isRange),
    [breakdown.relykaAffiche, breakdown.relykaAlloueVolontairement, breakdown.misDeCoteTotal, breakdown.variableEnvelopeRemaining, relConf],
  );

  /* Couleur du chiffre principal — décidée par `relykaTone` (lib/pilotageView) et EXPOSÉE, pour que
     l'écran s'en serve au lieu de réécrire la même règle dans son JSX. */
  const relykaColor = React.useMemo(() => {
    const tone = relykaTone(breakdown);
    return tone === 'positive' ? colors.emerald
      : tone === 'allocated' ? colors.blue
      : tone === 'negative' ? colors.danger
      : colors.orange;
  }, [breakdown.relykaAffiche, breakdown.relykaAlloueVolontairement, breakdown.resteDisponibleBrut, colors]);

  /** Données de projection alimentant l'encadré contextuel des recos (les deux vues). */
  const recoFinancials = pilotageData
    ? { currentChecking: pilotageData.current_checking_balance, projectedEndChecking: pilotageData.projection_balances_6m?.[0] }
    : undefined;

  /* Les messages des DÉCISIONS (description + projection de chaque reco), à plat : ils défilent
     sous les quatre tuiles, au lieu de n'afficher que des montants nus. */
  const recoMessages = React.useMemo(() => buildRecoMessages({
    recommendations: recoList,
    financials: recoFinancials,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [recoList, pilotageData]);

  /* Les messages du CHIFFRE PRINCIPAL, déroulés sous le montant : garde-fou marge × projection,
     consigne « solde non vérifié » (que portait le bandeau ambre), point bas de trésorerie, revenu
     deviné — et la phrase de base seulement si elle a quelque chose à apporter (cf. isGeneric).
     Ils ne se mélangent pas aux décisions : ils commentent tout l'écran, pas une tuile. */
  const relykaMessages = React.useMemo(() => buildRelykaMessages({
    baseMessage: relykaBase.text,
    baseIsGeneric: relykaBase.isGeneric,
    troughMessage: breakdown.troughExplain,
    incomeGuessedMessage: breakdown.incomeIsGuessed
      ? 'Ta rentrée d\'argent principale est estimée à partir de ton historique : enregistre-la en récurrente pour un Relyka plus juste.'
      : null,
    guardMessage: composeGuardMessage(recoList.filter((r) => r.amount > 0)),
    unverifiedMessage: relConf?.result.level === 'low'
      ? `Solde non vérifié ${unverifiedSincePhrase(relConf.result.daysSinceVerification)} — fais une régul ou saisis tes dépenses pour l'actualiser.`
      : null,
    relykaColor,
    warnColor: colors.orange,
  }), [relykaBase, breakdown.troughExplain, breakdown.incomeIsGuessed, recoList, relConf, relykaColor, colors]);

  const suiviDetail = React.useMemo(
    () => computeSuiviDetail(txForSuivi, accountsForSuivi),
    [txForSuivi, accountsForSuivi],
  );

  const recurUpcoming = React.useMemo(
    () => computeRecurUpcoming(suiviDetail.recurrentes, accounts, profile?.currency_code ?? 'EUR', rates),
    [suiviDetail, accounts, profile?.currency_code, rates],
  );

  return {
    ...breakdown,
    preEpargneTotal,
    preInvestTotal,
    reservationsTotal,
    mainCheckingId,
    ...setup,
    firstName,
    welcomeStep,
    welcomeRoute,
    relConf,
    recoList,
    relykaBase,
    relykaColor,
    recoFinancials,
    recoMessages,
    relykaMessages,
    suiviDetail,
    recurUpcoming,
  };
}
