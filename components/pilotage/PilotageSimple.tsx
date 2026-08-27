/**
 * LE TABLEAU DE BORD. Unique mise en page depuis le retrait de la « vue complète ».
 *
 * Il répond à trois questions et propose un geste, puis s'arrête :
 *   1. combien il me reste          → le Relyka, en grand, ouvrable sur son détail, avec sa
 *                                     fourchette et ses messages (un à la fois) ;
 *   2. qu'est-ce que j'en fais      → les décisions actives, avec leur action et le pourquoi de
 *                                     chaque montant (carrousel de messages) ;
 *   3. où j'en suis                 → les chiffres du mois, chacun ouvrant son détail existant ;
 *   + mettre à jour mon solde.
 *
 * Ce que l'ancienne vue complète affichait en plus a été ABANDONNÉ volontairement : graphe en
 * colonnes, curseurs « dont récurrentes / variables », bandeaux de cumuls, pilule du mois, boutons
 * « Ignorer » / « Cumuler » des recos. Les modaux de détail, eux, n'ont pas bougé : chaque ligne
 * d'ici ouvre exactement le même que la vue complète ouvrait (ils vivent dans l'écran hôte).
 *
 * Composant de PRÉSENTATION PURE : il ne calcule rien, ne lit aucune donnée. Tout arrive en props,
 * déjà calculé par le Pilotage — le tableau de bord ne peut donc pas diverger du moteur d'un euro.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useResponsive } from '../../hooks/theme/useResponsive';
import { semanticText } from '../../theme/palette';
import { CURRENCY_SYMBOL, floorToTen } from '../../lib/finance/currency';
import { verifiedAgoPhrase } from '../../lib/finance/confidenceEngine';
import { onbGlow } from '../../lib/engagement/onbHighlight';
import InfoDot from '../ui/InfoDot';
import RecoMessagesCarousel from './RecoMessagesCarousel';
import type { SmartRecommendation, RecoType } from '../../lib/finance/recommendationEngine';
import type { RecoMessage } from '../../lib/finance/recoMessages';
import type { GlossaryTerm } from '../../lib/ui/glossary';

const TERM: Record<RecoType, GlossaryTerm> = {
  save: 'epargner', invest: 'investir', enjoy: 'confort', keep: 'conserver',
};

/**
 * Geste proposé par décision, en deux mots : les tuiles font une demi-largeur.
 * « Confort » n'en a pas — c'est de l'argent libre, il n'y a rien à faire.
 */
const ACTION_LABEL: Partial<Record<RecoType, string>> = {
  save: 'Virer',
  invest: 'Virer',
  keep: 'Réserver',
};

export interface PilotageSimpleProps {
  /** Montant du Relyka, déjà arrondi par l'écran hôte. */
  relykaAmount: number;
  relykaColor: string;
  confidenceLevel: 'high' | 'medium' | 'low';
  /**
   * Ancienneté RÉELLE de la dernière vérification (`rawDaysSinceVerification`), pas celle du calcul
   * — cette dernière est plafonnée (21 j par défaut) et faisait dire « vérifié il y a un moment » à
   * quelqu'un qui n'avait rien vérifié depuis huit mois.
   */
  daysSinceVerification: number | null;
  /** Aucune vérification connue : on ne peut alors PAS écrire « Vérifié … ». */
  neverVerified?: boolean;
  /**
   * L'utilisateur SUIT ses dépenses (cf. `entriesKeptUp`, confidenceEngine) — le doute vient du
   * point de départ jamais reconfirmé, pas de saisies manquantes.
   *
   * Le badge reste « Estimation » (c'en est une, et la fourchette juste dessous le dit), mais il
   * cesse d'être AMBRE : l'ambre signale un manque à combler, et il n'y en a pas. Servi à quelqu'un
   * qui note tout, il transforme un état de fait en reproche quotidien.
   */
  confidenceNeutral?: boolean;
  /** Recommandations visibles du mois (le moteur en produit 0 à 4). */
  recommendations: SmartRecommendation[];
  /** La répartition est-elle réglée à la main ? (cf. lib/recoMode — le mode RÉELLEMENT appliqué). */
  recoModeManual?: boolean;
  /** Ouvre le réglage de la répartition. Absent = bouton masqué. */
  onOpenRecoMode?: () => void;
  /** Le POURQUOI de chaque décision (description + projection), en une liste défilante sous les
   *  quatre tuiles. Cf. lib/recoMessages. */
  recoMessages?: RecoMessage[];
  /** Réservations/cumuls > reste disponible. ALERTE, pas un message : elle ne défile pas avec les
   *  autres, elle reste affichée tant que la situation dure. */
  overspending?: boolean;
  /** Chiffres du mois. */
  checkingBalance: number;
  spentThisMonth: number;
  variableRemaining: number;
  /** Dépenses variables du mois DÉJÀ SAISIES pour les jours à venir : elles ne sont plus dans
   *  l'estimation (elles pèsent déjà sur le Relyka via le point bas) mais elles vont bien sortir. */
  variablePlanned?: number;
  /** Récurrentes du mois pas encore passées : elles vont sortir du compte comme les variables. */
  recurringUpcoming: number;
  recurringUpcomingCount: number;
  safetyMargin: number;
  /** La marge a-t-elle été RENSEIGNÉE ? (0 € choisi ≠ marge jamais définie) */
  marginSet?: boolean;
  /** Message sous le Relyka — remplace TOUT le reste quand il n'y a pas encore assez de données
   *  pour un calcul : tant que le chiffre ne veut rien dire, on explique ce qui manque. */
  heroHint?: string;
  /** Ce qui commente le CHIFFRE PRINCIPAL (message pédagogique, garde-fou, solde à vérifier),
   *  déroulé un message à la fois — même principe que sous les décisions. Cf. lib/recoMessages. */
  relykaMessages?: RecoMessage[];
  /** Fourchette du Relyka quand la confiance n'est pas haute. Le GRAND CHIFFRE reste le Relyka :
   *  la fourchette se lit en dessous, jamais à sa place (règle commune avec RelykaColumns). */
  relykaRange?: { low: number; high: number; isRange: boolean };
  /** Ancres du guide utilisateur (facultatives). */
  heroRef?: React.RefObject<any>;
  recoRef?: React.RefObject<any>;
  monthRef?: React.RefObject<any>;
  variableLineRef?: React.RefObject<any>;
  marginLineRef?: React.RefObject<any>;
  /** Mises en évidence du guide « Pour bien démarrer » (arrivée via ?onb=<clé>). */
  recoHighlight?: boolean;
  reservedHighlight?: boolean;
  /** Ce qui a été mis à l'abri ce mois : réservé (dont cumuls), épargné, investi. */
  reservedTotal: number;
  savedTotal: number;
  investedTotal: number;
  /** Ouvertures des modaux de détail de l'écran hôte (aucun n'est dupliqué ici). */
  onOpenRelyka: () => void;
  onOpenDetail: (key: 'checking' | 'spent' | 'planned' | 'savings' | 'invest') => void;
  onOpenMargin: () => void;
  /** Détail du « Réservé » — c'est de là qu'on LIBÈRE ce qui a été mis de côté. */
  onOpenReserved: () => void;
  onUpdateBalance: () => void;
  /** Actions des recommandations (virement pré-rempli, réservation). */
  onEpargner: (reco: SmartRecommendation) => void;
  onInvestir: (reco: SmartRecommendation) => void;
  onReserver: (reco: SmartRecommendation) => void;
}

export default function PilotageSimple(p: PilotageSimpleProps) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Web bureau : « Tes recommandations » et « Ce mois-ci » passent CÔTE À CÔTE. Empilées, elles
  // donnaient deux cartes de 1100 px de large et trois écrans de défilement là où tout tient d'un
  // coup d'œil. Sur mobile/tablette (`isDesktop` faux), la pile verticale est inchangée.
  const { isDesktop } = useResponsive();

  const colorOf: Record<RecoType, string> = {
    save: COLORS.green ?? COLORS.emerald,
    invest: COLORS.violet,
    enjoy: COLORS.orange,
    keep: COLORS.blue,
  };

  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;

  // Le chiffre principal est TOUJOURS le Relyka — jamais une borne de fourchette (même règle que
  // RelykaColumns). L'incertitude est portée par le badge d'état et la fourchette, en dessous.
  const bigLabel = fmt(p.relykaAmount);
  /* Taille du chiffre principal, calculée à partir de sa LONGUEUR (cf. le rendu plus bas : on ne
     peut pas compter sur `adjustsFontSizeToFit`). Les seuils correspondent aux paliers réels :
     « 1 250 € » (7) tient en 40 ; « 128 400 € » (9) et « 1 284 000 CHF » (13) ont besoin de moins. */
  const heroFontSize = bigLabel.length > 14 ? 26
    : bigLabel.length > 11 ? 30
    : bigLabel.length > 8 ? 35
    : 40;

  const visible = p.recommendations.filter((r) => r.amount > 0);

  /** Le solde courant est-il DÉJÀ passé sous la marge ? (la marge est un souhait, pas une garantie) */
  const marginBreached = p.safetyMargin > 0 && p.checkingBalance < p.safetyMargin;

  /* L'AMBRE SIGNALE UN MANQUE À COMBLER, pas une incertitude.
     Il était posé sur toute confiance BASSE — donc aussi sur quelqu'un qui saisit tout et dont le
     seul « tort » est de ne pas avoir reconfirmé son solde auprès de sa banque. Chez lui, l'ambre
     ne demandait rien de faisable : il colorait un état de fait en reproche, tous les jours. */
  const alertTone = p.confidenceLevel === 'low' && !p.confidenceNeutral;

  return (
    <View style={styles.wrap}>

      {/* ── 1. Combien il me reste ─────────────────────────────────────────── */}
      <View style={styles.hero} ref={p.heroRef} collapsable={false}>
        {/* Le guide met en avant cette carte en traçant sa bordure DANS sa propre boîte : aucune
            position n'est mesurée, donc l'encadré tombe juste sur tous les écrans. */}
        {/* ÉTAT + ACTION AU MÊME ENDROIT.
            Le geste « mettre à jour mon solde » n'a pas besoin d'un bouton permanent : le bouton +
            le porte déjà (et l'appui long y va directement). Ici, il n'apparaît QUE lorsqu'il sert
            à quelque chose — c'est-à-dire quand les chiffres ne sont plus certains — et il est
            greffé sur le badge qui vient précisément de le dire. Zéro ligne consommée quand tout
            est à jour, et plus de gros bouton qui rivalise avec le + juste à côté. */}
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>Ton Relyka</Text>
          {p.confidenceLevel === 'high' ? (
            <View style={[styles.badge, { backgroundColor: (COLORS.green ?? COLORS.emerald) + '1F', borderColor: (COLORS.green ?? COLORS.emerald) + '55' }]}>
              <Ionicons name="checkmark-circle" size={11} color={COLORS.green ?? COLORS.emerald} />
              <Text style={[styles.badgeText, { color: COLORS.green ?? COLORS.emerald }]}>À jour</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.badge,
                alertTone
                  ? { backgroundColor: COLORS.orange + '18', borderColor: COLORS.orange + '55' }
                  : { backgroundColor: COLORS.textSecondary + '18', borderColor: COLORS.textSecondary + '55' },
              ]}
              onPress={p.onUpdateBalance}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Mettre à jour mon solde"
            >
              {/* « Vérifié … » est une AFFIRMATION : on ne la sert qu'à qui a réellement vérifié
                  (une régularisation, ou le solde recopié à la création d'un compte courant).
                  Sans ce garde-fou, un compte sans aucune vérification lisait « Vérifié il y a un
                  moment » — l'app affirmait un contrôle qui n'avait jamais eu lieu. */}
              <Text
                style={[styles.badgeText, { color: alertTone ? COLORS.orange : COLORS.textSecondary }]}
                numberOfLines={1}
              >
                {p.confidenceLevel === 'low' ? 'Estimation'
                  : p.neverVerified || p.daysSinceVerification == null ? 'Solde à vérifier'
                  : `Vérifié ${verifiedAgoPhrase(p.daysSinceVerification)}`}
              </Text>
              <View style={[styles.badgeSep, { backgroundColor: (alertTone ? COLORS.orange : COLORS.textSecondary) + '55' }]} />
              <Ionicons name="refresh" size={11} color={COLORS.emerald} />
              <Text style={[styles.badgeText, { color: COLORS.emerald }]} numberOfLines={1}>Mettre à jour</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.heroAmountRow}
          onPress={p.onOpenRelyka}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Voir le détail du calcul"
        >
          {/* ⚠️ `adjustsFontSizeToFit` N'EXISTE PAS sur react-native-web (la prop est ignorée) et
              reste peu fiable sur Android — c'est déjà constaté ailleurs dans l'app (cf. la grille
              de CreditsTab et l'en-tête de welcome). S'y fier pour LE chiffre principal, c'est
              laisser « 1 234 567 CHF » se faire couper par `numberOfLines={1}` sans filet. On
              dimensionne donc nous-mêmes, à partir de la longueur réelle du texte : même rendu sur
              toutes les plateformes. La prop est conservée — quand elle marche, elle affine. */}
          <Text
            style={[styles.heroAmount, { fontSize: heroFontSize, color: p.relykaColor }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {bigLabel}
          </Text>
          <View style={[styles.heroInfo, { borderColor: p.relykaColor }]}>
            <Text style={[styles.heroInfoText, { color: p.relykaColor }]}>i</Text>
          </View>
        </TouchableOpacity>

        {/* FOURCHETTE — sous le montant, jamais à sa place.
            Le grand chiffre reste le Relyka : remplacer un Relyka de 1 266 € par « jusqu'à
            2 300 € » annonçait un nombre que son propre détail contredit, et supérieur à ce dont
            l'utilisateur dispose. Même vocabulaire que la légende de RelykaColumns
            (« minimum sûr » / « si tout est à jour »), pour ne pas inventer un troisième mot. */}
        {/* La fourchette est purement DESCENDANTE : son plafond est le Relyka lui-même (le chiffre
            au-dessus), et l'information utile est le PLANCHER — jusqu'où ça peut descendre si des
            dépenses n'ont pas été saisies.
            Plancher à 0 (le doute dépasse le Relyka) → on masque la ligne entière : « minimum sûr
            0 € · jusqu'à 1 020 € » sous un « 1 020 € » n'apprend rien et alarme pour rien. Le badge
            « Estimation » et le message « À vérifier » disent déjà ce qu'il y a à dire. */}
        {/* MÊME ARRONDI QUE LE CHIFFRE PRINCIPAL (dizaine inférieure). Le haut de la fourchette EST
            le Relyka — mais le grand chiffre était arrondi et pas la borne : on lisait « 1 010 € »
            en grand et « jusqu'à 1 012 € » juste en dessous, soit une fourchette qui dépassait de
            deux euros le montant qu'elle est censée plafonner. L'arrondi va vers le BAS des deux
            côtés : le « minimum sûr » ne peut pas être remonté par un affichage. */}
        {p.relykaRange?.isRange && floorToTen(p.relykaRange.low) > 0 && (
          <View style={styles.rangeRow}>
            <Text style={styles.rangeText}>
              minimum sûr <Text style={styles.rangeStrong}>{fmt(floorToTen(p.relykaRange.low))}</Text>
            </Text>
            <View style={styles.rangeSep} />
            <Text style={styles.rangeText}>
              jusqu’à <Text style={styles.rangeStrong}>{fmt(floorToTen(p.relykaRange.high))}</Text> si tout est à jour
            </Text>
          </View>
        )}

        {/* `heroHint` (données incomplètes) PRIME sur tout : tant que le calcul n'a pas de quoi
            tenir, on explique CE manque plutôt que de commenter un chiffre qui ne veut rien dire.
            Sinon : les messages du chiffre principal, un à la fois (garde-fou, solde à vérifier,
            explication) — même principe que sous les décisions. */}
        {p.heroHint ? (
          <Text style={styles.heroHint}>{p.heroHint}</Text>
        ) : p.relykaMessages?.length ? (
          <View style={{ width: '100%', marginTop: 2 }}>
            <RecoMessagesCarousel messages={p.relykaMessages} />
          </View>
        ) : (
          <Text style={styles.heroHint}>Ce qu’il devrait te rester ce mois-ci, une fois tout ce qui est prévu couvert.</Text>
        )}
      </View>

      {/* Bureau : les blocs 2 et 3 forment DEUX COLONNES ; mobile : la même pile qu'avant
          (le conteneur porte le même `gap` que `wrap`, l'espacement ne bouge pas d'un pixel). */}
      <View style={[styles.stack, isDesktop && styles.columns]}>

      {/* ── 2. Qu'est-ce que j'en fais ─────────────────────────────────────── */}
      <View
        style={[styles.card, isDesktop && styles.column, p.recoHighlight ? onbGlow(COLORS, true) : null]}
        ref={p.recoRef}
        collapsable={false}
      >
        {/* En-tête : le titre, et le réglage de la RÉPARTITION à droite. Il est là et pas dans les
            paramètres parce que c'est ici qu'on se pose la question — devant les quatre montants
            qu'il décide. La pastille « Manuel » n'est pas décorative : sans elle, une répartition
            posée à la main devient invisible au bout de deux semaines, et les montants affichés
            n'auraient plus d'explication. */}
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { flex: 1 }]}>Tes recommandations</Text>
          {p.recoModeManual && (
            <View style={styles.modePill}>
              <Text style={styles.modePillText}>Manuel</Text>
            </View>
          )}
          {!!p.onOpenRecoMode && (
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={p.onOpenRecoMode}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Régler la répartition de tes recommandations"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="options-outline" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Dépassement des réservations sur le reste disponible : alerte permanente, pas un
            message qui défile. */}
        {p.overspending && (
          <TouchableOpacity style={styles.overspend} activeOpacity={0.75} onPress={p.onOpenReserved}>
            <Ionicons name="warning-outline" size={15} color={COLORS.danger} />
            <Text style={styles.overspendText}>
              Tes réservations dépassent ton reste disponible. Réduis ou annule un cumul.
            </Text>
            <Ionicons name="chevron-forward" size={14} color={semanticText(COLORS.danger, COLORS)} />
          </TouchableOpacity>
        )}

        {visible.length === 0 ? (
          <Text style={styles.empty}>
            Rien à répartir ce mois-ci : ton Relyka est déjà entièrement affecté.
          </Text>
        ) : (
          /* DEUX PAR LIGNE : quatre décisions empilées en pleine largeur poussaient tout le reste
             de la page sous la ligne de flottaison. En demi-largeur, elles tiennent d'un coup
             d'œil. La tuile ENTIÈRE déclenche le geste — plus besoin d'un bouton séparé. */
          <View style={styles.grid}>
            {visible.map((reco) => {
              const color = colorOf[reco.type];
              /* ── LE BOUTON DIT CE QU'IL VA FAIRE ──────────────────────────────────────────────
                 En confiance moyenne/basse, le geste est pré-rempli avec la BORNE BASSE (on ne
                 pousse pas à sortir du compte de l'argent dont on n'est pas sûr) : la tuile
                 annonçait « Épargner 400 € » et le virement s'ouvrait à 240 €, sans que rien ne
                 l'explique — et le message juste en dessous parlait, lui, des 240 €. Deux chiffres
                 contradictoires sur le même écran. Le montant proposé passe donc SUR le bouton,
                 seulement quand il diffère du montant affiché. */
              const preFilled = Math.round(reco.actionAmount ?? reco.amount);
              const actionDiffers = preFilled > 0 && preFilled !== Math.round(reco.amount);
              const baseAction = ACTION_LABEL[reco.type];
              const action = baseAction && actionDiffers ? `${baseAction} ${fmt(preFilled)}` : baseAction;
              const onPress =
                reco.type === 'save' ? () => p.onEpargner(reco)
                : reco.type === 'invest' ? () => p.onInvestir(reco)
                : reco.type === 'keep' ? () => p.onReserver(reco)
                : undefined;
              return (
                <TouchableOpacity
                  key={reco.type}
                  style={[styles.decision, { backgroundColor: color + '12', borderColor: color + '3D' }]}
                  onPress={onPress}
                  disabled={!onPress}
                  activeOpacity={onPress ? 0.75 : 1}
                  accessibilityRole={onPress ? 'button' : undefined}
                  accessibilityLabel={action ? `${action} — ${reco.shortTitle}` : reco.shortTitle}
                >
                  <View style={styles.decisionHead}>
                    <View style={[styles.decisionIcon, { backgroundColor: color + '22' }]}>
                      <Ionicons name={reco.icon as any} size={14} color={color} />
                    </View>
                    <Text style={styles.decisionTitle} numberOfLines={1}>{reco.shortTitle}</Text>
                    <InfoDot term={TERM[reco.type]} size={12} color={color} insidePressable />
                  </View>

                  <Text style={[styles.decisionAmount, { color }]} numberOfLines={1} adjustsFontSizeToFit>
                    {fmt(reco.amount)}
                  </Text>

                  {action ? (
                    <View style={styles.decisionAction}>
                      <Text style={[styles.decisionActionText, { color }]} numberOfLines={1}>{action}</Text>
                      <Ionicons name="arrow-forward" size={12} color={color} />
                    </View>
                  ) : (
                    <Text style={styles.decisionFree} numberOfLines={1}>libre d’usage</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Le POURQUOI des montants ci-dessus — un message à la fois, les autres à un swipe.
            Sans lui, la vue simplifiée n'affichait que quatre chiffres nus : ni la mise en garde du
            garde-fou de marge, ni ce que chaque décision représente, ni sa projection. */}
        {!!p.recoMessages?.length && <RecoMessagesCarousel messages={p.recoMessages} />}
      </View>

      {/* ── 3. Où j'en suis ────────────────────────────────────────────────── */}
      <View style={[styles.card, isDesktop && styles.column]} ref={p.monthRef} collapsable={false}>
        <Text style={styles.cardTitle}>Ce mois-ci</Text>

        <TouchableOpacity style={styles.line} activeOpacity={0.7} onPress={() => p.onOpenDetail('checking')}>
          <View style={styles.lineLabelCol}>
            <Text style={styles.lineLabel}>Tu as sur tes comptes</Text>
          </View>
          <Text style={[styles.lineValue, { color: COLORS.text }]}>{fmt(p.checkingBalance)}</Text>
          <Ionicons name="chevron-forward" size={15} color={COLORS.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.line} activeOpacity={0.7} onPress={() => p.onOpenDetail('spent')}>
          <View style={styles.lineLabelCol}>
            <Text style={styles.lineLabel}>Tu as dépensé</Text>
          </View>
          <Text style={[styles.lineValue, { color: semanticText(COLORS.danger, COLORS) }]}>{fmt(p.spentThisMonth)}</Text>
          <Ionicons name="chevron-forward" size={15} color={COLORS.textSecondary} />
        </TouchableOpacity>

        {/* Formulation en miroir de la ligne du dessus : « tu as dépensé » / « tu vas encore
            dépenser ». « Encore possible » se lisait comme une autorisation, alors que c'est une
            PRÉVISION — ce que tes habitudes disent qu'il te reste à dépenser d'ici la fin du mois.
            La ligne couvre les DEUX natures de sortie à venir : les dépenses variables estimées ET
            les récurrentes du mois pas encore passées. N'en montrer qu'une donnait un total plus
            petit que la réalité — et rendait le Relyka incompréhensible. */}
        <TouchableOpacity
          style={styles.line}
          activeOpacity={0.7}
          onPress={() => p.onOpenDetail('planned')}
          ref={p.variableLineRef}
        >
          <View style={styles.lineLabelCol}>
            <View style={styles.lineLabelRow}>
              <Text style={styles.lineLabel}>Tu devrais encore dépenser</Text>
              <InfoDot term="enveloppe_variable" size={12} insidePressable />
            </View>
            <Text style={styles.lineHint}>
              {p.recurringUpcomingCount > 0
                ? `variables estimées + ${p.recurringUpcomingCount} récurrente${p.recurringUpcomingCount > 1 ? 's' : ''} à venir`
                : 'estimé d’après tes habitudes'}
            </Text>
          </View>
          {/* Les dépenses variables DÉJÀ SAISIES pour la fin du mois sont comptées ici : elles ne
              sont plus dans l'estimation (elles pèsent déjà sur le Relyka par le point bas), mais
              elles vont bel et bien sortir du compte — les omettre annonçait un total plus petit
              que la réalité. */}
          <Text style={[styles.lineValue, { color: semanticText(COLORS.yellow, COLORS) }]}>
            {fmt(Math.max(0, p.variableRemaining) + Math.max(0, p.variablePlanned ?? 0) + Math.max(0, p.recurringUpcoming))}
          </Text>
          <Ionicons name="chevron-forward" size={15} color={COLORS.textSecondary} />
        </TouchableOpacity>

        {/* « Tu veux garder au moins » et non « tu gardes toujours » : la marge est une INTENTION
            que l'utilisateur fixe, pas un fait garanti. Rien n'empêche le solde de passer dessous —
            et quand c'est le cas, on le dit au lieu d'affirmer le contraire juste à côté. */}
        <TouchableOpacity style={styles.line} activeOpacity={0.7} onPress={p.onOpenMargin} ref={p.marginLineRef}>
          <View style={styles.lineLabelCol}>
            <View style={styles.lineLabelRow}>
              <Text style={styles.lineLabel}>Tu veux garder au moins</Text>
              <InfoDot term="marge_securite" size={12} insidePressable />
            </View>
            <Text style={[styles.lineHint, marginBreached && { color: COLORS.orange }]}>
              {p.safetyMargin <= 0
                ? 'sur tes comptes courants, quoi qu’il arrive'
                : marginBreached
                ? 'tes comptes sont en dessous en ce moment'
                : 'sur tes comptes courants — c’est ta marge de sécurité'}
            </Text>
          </View>
          {/* « à définir » UNIQUEMENT si la marge n'a jamais été renseignée. 0 € est une réponse
              valable et volontaire : on affiche alors le montant, pas une invitation à décider ce
              qui a déjà été décidé. */}
          <Text style={[styles.lineValue, { color: p.safetyMargin > 0 ? semanticText(COLORS.teal, COLORS) : COLORS.textSecondary }]}>
            {p.marginSet || p.safetyMargin > 0 ? fmt(p.safetyMargin) : 'à définir'}
          </Text>
          <Ionicons name="chevron-forward" size={15} color={COLORS.textSecondary} />
        </TouchableOpacity>

        {/* MIS À L'ABRI — indispensable en vue simplifiée : sans cette ligne, l'argent réservé
            disparaissait de l'écran, et avec lui le seul chemin pour le LIBÉRER. « Réservé » ouvre
            le détail où l'on peut reprendre ce qu'on a mis de côté. */}
        <View style={styles.stash}>
          {([
            { key: 'reserved', label: 'Réservé', value: p.reservedTotal, color: COLORS.blue, icon: 'lock-closed', onPress: p.onOpenReserved },
            { key: 'saved', label: 'Épargné', value: p.savedTotal, color: COLORS.green ?? COLORS.emerald, icon: 'shield', onPress: () => p.onOpenDetail('savings') },
            { key: 'invested', label: 'Investi', value: p.investedTotal, color: COLORS.violet, icon: 'trending-up', onPress: () => p.onOpenDetail('invest') },
          ] as const).map((s) => (
            <TouchableOpacity
              key={s.key}
              // « Réservé » est une étape de la checklist « Pour bien démarrer » : elle s'entoure
              // quand on arrive par elle.
              style={[styles.stashTile, s.key === 'reserved' && p.reservedHighlight ? onbGlow(COLORS, true) : null]}
              activeOpacity={0.75}
              onPress={s.onPress}
            >
              <View style={styles.stashHead}>
                <Ionicons name={s.icon as any} size={12} color={s.value > 0 ? s.color : COLORS.textSecondary} />
                <Text style={styles.stashLabel} numberOfLines={1}>{s.label}</Text>
              </View>
              <Text
                style={[styles.stashValue, { color: s.value > 0 ? semanticText(s.color, COLORS) : COLORS.textSecondary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {fmt(s.value)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      </View>

    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    // `marginTop` négatif : l'écran hôte espace ses blocs de 24, alors que la vue simplifiée
    // respire à 14. Sans cette compensation, le premier écart (sous le bandeau de conseils)
    // était visiblement plus large que tous les suivants.
    // ⚠️ PAS de marge négative ici. Elle compensait l'espacement de l'écran hôte, mais quand le
    // bandeau de conseils est masqué (réglage utilisateur), la vue commence tout en haut de la zone
    // de défilement : le haut de la carte « Ton Relyka » passait alors HORS CHAMP et se retrouvait
    // rogné. Dix pixels d'écart en trop valent mieux qu'une carte coupée.
    wrap: { gap: 14 },

    // Conteneur des blocs 2 et 3. `stack` reproduit EXACTEMENT l'espacement de `wrap` → sur mobile,
    // l'ajout de ce conteneur est invisible. `columns` ne s'applique qu'en web bureau.
    stack: { gap: 14 },
    columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    // `minWidth: 0` : sans lui, un contenu long (montant, libellé) empêche la colonne de rétrécir
    // et fait déborder la rangée.
    column: { flex: 1, minWidth: 0 },

    hero: {
      backgroundColor: c.card, borderRadius: 22, borderWidth: 1, borderColor: c.cardBorder,
      paddingHorizontal: 18, paddingVertical: 18, gap: 6, alignItems: 'center',
    },
    /* `flexWrap` : sur un écran étroit (320 pt), « TON RELYKA » + « Vérifié il y a longtemps ·
       Mettre à jour » dépasse la largeur de la carte — le texte du badge se coupait alors en deux
       lignes À L'INTÉRIEUR de la pastille, qui devenait un pavé. Il passe désormais dessous, entier
       et centré. Sans effet dès qu'il y a la place. */
    heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, maxWidth: '100%' },
    heroLabel: {
      fontSize: 11.5, fontWeight: '800', color: c.textSecondary,
      textTransform: 'uppercase', letterSpacing: 0.9,
    },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2,
    },
    // `numberOfLines={1}` côté rendu + pas de retour à la ligne ici : la pastille reste une pastille.
    badgeText: { fontSize: 10.5, fontWeight: '800' },
    badgeSep: { width: 1, height: 10, opacity: 0.6, marginHorizontal: 1 },
    heroAmountRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 2 },
    heroAmount: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
    heroInfo: {
      width: 16, height: 16, borderRadius: 8, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center', marginTop: 4, opacity: 0.7,
    },
    heroInfoText: { fontSize: 10.5, fontWeight: '800', lineHeight: 14 },
    heroHint: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },

    // Fourchette : discrète, sous le montant. Deux bornes séparées par un point médian.
    rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6 },
    rangeText: { fontSize: 11.5, color: c.textSecondary },
    rangeStrong: { fontWeight: '800', color: c.text },
    rangeSep: { width: 3, height: 3, borderRadius: 2, backgroundColor: c.cardBorder },

    card: {
      backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder,
      padding: 16, gap: 10,
    },
    cardTitle: { fontSize: 15.5, fontWeight: '800', color: c.text },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    modePill: {
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
      backgroundColor: c.teal + '1A', borderWidth: 1, borderColor: c.teal + '40',
    },
    modePillText: { fontSize: 10.5, fontWeight: '800', color: c.teal },
    modeBtn: {
      width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
    },
    empty: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },

    overspend: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9,
      borderColor: c.danger + '55', backgroundColor: c.danger + '14',
    },
    overspendText: { flex: 1, fontSize: 12, color: c.text, lineHeight: 17 },

    // Grille 2 colonnes. `width: 48%` + space-between plutôt que `gap` : la gouttière est alors
    // portée par la mise en page elle-même, sans risque de débordement au pixel près.
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
    decision: { width: '48%', borderWidth: 1, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 11, gap: 6 },
    decisionHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    decisionIcon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    decisionTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: c.text },
    decisionAmount: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
    decisionAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    // `flexShrink` : le libellé porte parfois un montant (« Virer 1 240 € ») dans une tuile de
    // demi-largeur — sans lui, c'est la FLÈCHE qui sortait du cadre sur les petits écrans.
    decisionActionText: { fontSize: 11.5, fontWeight: '700', flexShrink: 1 },
    decisionFree: { fontSize: 11.5, color: c.textSecondary },

    line: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.cardBorder,
    },
    lineLabelCol: { flex: 1, gap: 1 },
    lineLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    lineLabel: { fontSize: 13.5, color: c.text },
    lineHint: { fontSize: 11, color: c.textSecondary, lineHeight: 15 },
    lineValue: { fontSize: 15, fontWeight: '800' },

    // Trois tuiles compactes sur une ligne : réservé / épargné / investi.
    stash: {
      flexDirection: 'row', gap: 8,
      borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 11, marginTop: 2,
    },
    stashTile: {
      flex: 1, backgroundColor: c.bg, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      paddingHorizontal: 9, paddingVertical: 9, gap: 3,
    },
    stashHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    stashLabel: { flex: 1, fontSize: 10.5, fontWeight: '700', color: c.textSecondary },
    stashValue: { fontSize: 14.5, fontWeight: '800' },

    // Le lien de bascule est le dernier élément : il doit rester dégagé du bouton « + » flottant,
    // qui vient sinon se poser dessus en bas d'écran.
    // La réserve d'espace pour le bouton « + » flottant est portée par le `paddingBottom` de la
    // zone de défilement de l'écran hôte, PAS par ce lien : ici, elle creusait un trou visible
    // entre « Voir le détail complet » et le bloc suivant (publicité).
    switch: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      paddingVertical: 4,
    },
    switchText: { fontSize: 13, fontWeight: '600', color: c.textSecondary, textDecorationLine: 'underline' },
  });
}
