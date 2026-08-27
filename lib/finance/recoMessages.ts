/**
 * recoMessages — tout ce que l'app a à dire sur le Relyka et ses recommandations, en listes prêtes
 * à dérouler.
 *
 * POURQUOI : ces phrases étaient réparties sur les slides d'un carrousel de cartes (message du
 * Relyka + garde-fou sur la 1ʳᵉ, description + encadré contextuel sur chaque reco). Le tableau de
 * bord n'affiche plus ce carrousel : sans ces listes, l'utilisateur n'aurait que des montants nus,
 * sans jamais savoir pourquoi.
 *
 * DEUX listes distinctes, parce qu'elles s'affichent à deux endroits :
 *  • `buildRelykaMessages` → sous le chiffre principal (ce qui commente tout l'écran) ;
 *  • `buildRecoMessages`   → sous les quatre décisions (ce qui commente un montant précis).
 * Source unique : l'aperçu admin des recos (RecommendationCard) compose le même garde-fou.
 */
import type { SmartRecommendation, RecoType } from './recommendationEngine';
import { getRecoContextText, type RecoFinancials } from './recoContext';
import { CURRENCY_SYMBOL } from './currency';
import { unverifiedSincePhrase } from './confidenceEngine';

export interface RecoMessage {
  key: string;
  /** À quoi le message se rapporte (« Ton Relyka », « Épargner »…). */
  label: string;
  /** Couleur d'accent — celle de la décision concernée (l'ambre pour un avertissement). */
  color: string;
  text: string;
  icon: string;
  /** `info` = ce que ça représente ; `tip` = projection / contexte chiffré ; `warn` = mise en garde. */
  tone: 'info' | 'tip' | 'warn';
  /** Type de reco concerné, quand il y en a un (permet d'ouvrir la bonne carte). */
  recoType?: RecoType;
}

/* Le symbole vient de `CURRENCY_SYMBOL` (devise de référence du profil), jamais d'un « € » écrit
   en dur : l'app propose une centaine de devises, et ces messages s'affichaient encore en euros
   à côté de montants libellés en $, £ ou CHF. */
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

/**
 * Compose LE message du garde-fou marge × projection.
 *  • épargne ET invest plafonnés → UN SEUL message combiné (« investir X et épargner Y de plus… ») ;
 *  • un seul des deux → message avec le total possible entre parenthèses ;
 *  • tout conserver → message tout prêt (reco.guardNote), quel qu'en soit le motif : solde déjà sous
 *    la marge, trajectoire en danger, point bas des 6 mois, ou Relyka trop petit pour être découpé.
 *    Les quatre le portent désormais — trois d'entre eux rendaient une carte « Conserver » muette.
 * Le verbe est DANS le message (pas de préfixe « Investir — »).
 *
 * ⚠️ Ce message DÉFILE comme les autres, et c'est voulu : le carrousel est le format de tout ce qui
 * commente le Relyka. Le sortir du lot (épinglage, libellé propre) attirait l'œil bien au-delà de ce
 * qu'il apporte, et cassait la sobriété de la carte.
 */
export function composeGuardMessage(recos: SmartRecommendation[]): string | null {
  const tail = 'mais ton solde repasserait sous ta marge de sécurité d\'ici 6 mois.';
  const inv = recos.find((r) => r.type === 'invest')?.guard;
  const sav = recos.find((r) => r.type === 'save')?.guard;

  if (inv && sav) {
    return `Tu pourrais investir ${eur(inv.addMore)} et épargner ${eur(sav.addMore)} de plus ce mois-ci, ${tail}`;
  }
  if (inv) {
    return `Tu pourrais investir ${eur(inv.addMore)} de plus ce mois-ci (soit ${eur(inv.total)} au total), ${tail}`;
  }
  if (sav) {
    return `Tu pourrais épargner ${eur(sav.addMore)} de plus ce mois-ci (soit ${eur(sav.total)} au total), ${tail}`;
  }
  // Cas « tout conserver » : message autonome (majuscule initiale).
  const keepNote = recos.find((r) => r.guardNote)?.guardNote;
  return keepNote ? keepNote.charAt(0).toUpperCase() + keepNote.slice(1) : null;
}

/**
 * Ce que l'app dit d'un solde non vérifié — et sur quel ton.
 *
 * `neutral` = un CONSTAT, pas une consigne : la fourchette est expliquée, aucun geste n'est réclamé.
 */
export interface UnverifiedMessage { text: string; neutral: boolean }

/* ── « FIN DE MOIS : TON RELYKA EST MOINS PRÉCIS » A ÉTÉ RETIRÉ ──────────────────────────────────
 *
 * Cette phrase était servie à quelqu'un qui SAISIT — et elle lui disait le contraire de ce que le
 * moteur fait. Le doute croît bien avec les jours écoulés depuis la dernière vérification, mais il
 * est effacé en face par le taux d'honoration de l'enveloppe (cf. `observedRelief`) : à mesure que
 * le mois avance ET que les dépenses sont notées, ce qui « a pu échapper » se réduit. Quelqu'un qui
 * note tout voit donc son Relyka devenir PLUS sûr en fin de mois, pas moins — c'est même le cas que
 * le moteur verrouille en test (« fin de mois suivie au jour le jour »).
 *
 * Annoncer une imprécision de fin de mois revenait donc à décrire le comportement de l'app à
 * quelqu'un qui observe l'inverse sur son écran. Le seuil de « fin de période » qui pilotait cette
 * variante est parti avec elle.
 */

/**
 * La phrase « solde non vérifié », à partir du seul résultat de confiance.
 *
 * Extraite du tableau de bord pour être PARTAGÉE avec le simulateur d'administration : recopiée
 * là-bas, elle aurait fini par annoncer un geste que l'app ne propose plus — c'est précisément ce
 * qu'on reproche aux aperçus qui réimplémentent la production.
 *
 * `null` hors confiance BASSE : en moyenne, le badge de la carte suffit (pas de doublon).
 * L'ancienneté employée est la RÉELLE (`rawDaysSinceVerification`), jamais celle du calcul qui
 * sature à 21 jours — et « jamais vérifié » a sa propre phrase : on n'invente pas une ancienneté.
 *
 * ── UNE INJONCTION N'EST JUSTE QUE SI LE GESTE MANQUE ────────────────────────────────────────────
 * « Mets ton solde à jour ou saisis tes dépenses » était servi à TOUT LE MONDE en confiance basse —
 * y compris le 27 du mois à quelqu'un qui saisit au fil de l'eau. Or à cette date, le doute grandit
 * de lui-même : il croît avec les jours écoulés depuis la dernière vérification. Le geste réclamé
 * n'y changerait presque rien, et il est réclamé au pire moment.
 *
 * On distingue donc les deux causes, sur un signal que le moteur calcule déjà (`entriesKeptUp`) :
 *   • rien n'est suivi → on nomme le manque, et le geste qui le comble ;
 *   • quelque chose est suivi → un CONSTAT. Le doute demeure (la fourchette aussi), on dit
 *     seulement D'OÙ il vient — et rien de plus.
 *
 * ── ON PARLE DE SAISIE, PAS DE VÉRIFICATION ─────────────────────────────────────────────────────
 * Ces phrases renvoyaient toutes au SOLDE : « non vérifié », « pas confirmé », « mets-le à jour ».
 * C'est-à-dire un geste qui se fait dans l'appli de sa banque, pas ici — la corvée, précisément.
 * Or ce n'est pas le seul remède, ni le plus simple : NOTER UNE DÉPENSE resserre déjà la fourchette
 * (cf. `activityDampening` et le taux d'honoration de l'enveloppe dans confidenceEngine), au point
 * de pouvoir ramener le Relyka à « À jour » sans jamais ouvrir sa banque. Les messages parlent donc
 * de ce qu'on peut faire ICI, et restent vagues sur le reste ; les boutons « Mettre à jour », eux,
 * demeurent pour qui veut le faire.
 *
 * ── ET ON NE DIT PAS « FOURCHETTE » ─────────────────────────────────────────────────────────────
 * C'est le mot de l'ingénieur, pas celui du lecteur : il décrit le SYMPTÔME (deux bornes affichées)
 * au lieu de l'enjeu. Ce que l'utilisateur veut, c'est un Relyka plus juste — et c'est exactement ce
 * que la saisie lui donne. On parle donc du résultat, jamais de la mécanique d'affichage.
 *
 * ⚠️ ON NE COMMENTE JAMAIS LE COMPORTEMENT DE L'UTILISATEUR. « Tu suis bien tes dépenses » a été
 * retiré : l'app ne sait pas ce qu'il a dépensé sans le saisir, donc elle ne peut pas savoir s'il
 * saisit bien. Elle constate des saisies, pas leur exhaustivité — et féliciter sur cette base, c'est
 * affirmer précisément ce qu'on ignore.
 */
export function unverifiedRelykaMessage(conf: {
  level: 'high' | 'medium' | 'low';
  neverVerified: boolean;
  rawDaysSinceVerification: number | null;
  /** cf. ConfidenceResult — absent (anciens appelants / tests) = comportement d'avant. */
  entriesKeptUp?: boolean;
  /** Jours depuis la dernière saisie (cf. ConfidenceResult). `null` = aucune sur la fenêtre. */
  daysSinceLastEntry?: number | null;
}): UnverifiedMessage | null {
  if (conf.level !== 'low') return null;
  /* Aucun point de départ constaté : c'est le SEUL cas où noter des dépenses n'y peut rien (le
     moteur refuse d'ailleurs d'en tenir compte, cf. `neverVerified`). On nomme donc la donnée qui
     manque — sans en faire un reproche, le bouton est juste à côté. */
  if (conf.neverVerified || conf.rawDaysSinceVerification == null) {
    return {
      text: 'Le solde de tes comptes n\'a pas encore été renseigné : ton Relyka reste une estimation.',
      neutral: false,
    };
  }
  /* Des nouvelles récentes : on ne réclame rien, on dit simplement ce que le geste apporte.
     Une seule phrase — la variante « fin de mois » a été retirée, elle contredisait le moteur. */
  if (conf.entriesKeptUp) {
    return { text: 'Chaque dépense que tu notes rend ton Relyka plus juste.', neutral: true };
  }
  /* Plus rien depuis un moment. Ce cas EST le silence — `entriesKeptUp` ne vaut faux que si la
     dernière saisie remonte à plus de `QUIET_ENTRY_DAYS`, ou qu'il n'y en a aucune : il n'y a donc
     plus de variante « saisies éparses » à distinguer. On date le silence quand on le peut. */
  const since = conf.daysSinceLastEntry == null
    ? 'depuis un moment'
    : unverifiedSincePhrase(conf.daysSinceLastEntry);
  return {
    text: `Aucune dépense saisie ${since} : note-les pour un Relyka plus juste.`,
    neutral: false,
  };
}

/**
 * Les messages du BLOC PRINCIPAL « Ton Relyka » : ce qui commente le chiffre lui-même.
 * Séparés de ceux des décisions — ils vivent à un autre endroit de l'écran et ne doivent pas se
 * mélanger à des explications d'épargne ou d'investissement.
 */
export function buildRelykaMessages(input: {
  /** Ce qu'EST le chiffre. Voir `baseIsGeneric`. */
  baseMessage?: string;
  /**
   * Le message de base est-il la phrase PASSE-PARTOUT (« voici ce qu'il devrait te rester…
   * utilise-le librement ») ? Elle ne vaut que si elle est SEULE : dès qu'un autre message a
   * quelque chose de concret à dire, elle occupe un tour de carrousel pour ne rien apprendre.
   * Les variantes non génériques (budget dépassé, plus de marge, tout est déjà rangé) restent
   * TOUJOURS affichées, en tête : elles qualifient le montant.
   */
  baseIsGeneric?: boolean;
  /** Point bas de trésorerie : jusqu'à quand le Relyka est contraint, et ce qui le fera remonter. */
  troughMessage?: string | null;
  /** Rentrée d'argent inférée de l'historique plutôt que saisie en récurrente. */
  incomeGuessedMessage?: string | null;
  /** Garde-fou marge × projection (cf. composeGuardMessage). */
  guardMessage?: string | null;
  /** Solde non vérifié depuis longtemps : la phrase que portait le bandeau ambre des recos. */
  unverifiedMessage?: UnverifiedMessage | string | null;
  relykaColor: string;
  warnColor: string;
}): RecoMessage[] {
  const {
    baseMessage, baseIsGeneric, troughMessage, incomeGuessedMessage,
    guardMessage, unverifiedMessage, relykaColor, warnColor,
  } = input;

  const base: RecoMessage | null = baseMessage?.trim()
    ? { key: 'relyka:main', label: 'Ton Relyka', color: relykaColor, text: baseMessage.trim(), icon: 'sparkles', tone: 'info' }
    : null;

  // Tout ce qui a quelque chose de CONCRET à dire. Mises en garde d'abord : c'est ce qu'on veut
  // voir en premier si on ne lit qu'un message.
  const substantive: RecoMessage[] = [];
  if (guardMessage?.trim()) {
    substantive.push({ key: 'relyka:guard', label: 'À savoir', color: warnColor, text: guardMessage.trim(), icon: 'alert-circle', tone: 'warn' });
  }
  const unverified: UnverifiedMessage | null = typeof unverifiedMessage === 'string'
    ? (unverifiedMessage.trim() ? { text: unverifiedMessage.trim(), neutral: false } : null)
    : (unverifiedMessage?.text?.trim() ? { text: unverifiedMessage.text.trim(), neutral: unverifiedMessage.neutral } : null);
  if (unverified) {
    /* Un CONSTAT ne se présente pas comme une alerte : ni ambre, ni bouclier. Le doute est le même —
       c'est ce qu'on en dit qui change, et le ton fait la moitié du message.
       « À compléter » plutôt que « À vérifier » : ce qui manque, ce sont des saisies, et vérifier
       son solde renvoie vers l'appli de sa banque (cf. unverifiedRelykaMessage). */
    substantive.push(unverified.neutral
      ? { key: 'relyka:unverified', label: 'Bon à savoir', color: relykaColor, text: unverified.text, icon: 'information-circle-outline', tone: 'info' }
      : { key: 'relyka:unverified', label: 'À compléter', color: warnColor, text: unverified.text, icon: 'create-outline', tone: 'warn' });
  }
  if (troughMessage?.trim()) {
    substantive.push({ key: 'relyka:trough', label: 'Point bas', color: relykaColor, text: troughMessage.trim(), icon: 'trending-down-outline', tone: 'tip' });
  }
  if (incomeGuessedMessage?.trim()) {
    substantive.push({ key: 'relyka:income', label: 'Ta rentrée d’argent', color: warnColor, text: incomeGuessedMessage.trim(), icon: 'help-circle-outline', tone: 'warn' });
  }

  if (!base) return substantive;
  // Non générique = il qualifie le montant → en tête, toujours.
  if (!baseIsGeneric) return [base, ...substantive];
  // Générique = seulement s'il n'y a rien d'autre à dire.
  return substantive.length > 0 ? substantive : [base];
}

/**
 * Les messages des RECOMMANDATIONS : pour chaque décision, ce que le geste engage (cf.
 * lib/recoContext), gardés collés — on ne fait pas défiler deux explications d'épargne entre deux
 * phrases sur l'investissement.
 *
 * ⚠️ Ce qui relève du Relyka lui-même passe par `buildRelykaMessages`, pas par ici.
 */
export function buildRecoMessages(input: {
  recommendations: SmartRecommendation[];
  /** Données de projection : sans elles, l'encadré contextuel n'est pas calculable. */
  financials?: RecoFinancials;
}): RecoMessage[] {
  const { recommendations, financials } = input;
  const visible = recommendations.filter((r) => r.amount > 0);
  const out: RecoMessage[] = [];

  for (const r of visible) {
    /* UN SEUL message par décision.
       Deux messages, c'était une redondance : la description reprend surtout le MONTANT, déjà lu en
       gros sur la tuile juste au-dessus (« Épargner — 400 € » puis « Tu peux placer 400 € ce
       mois-ci… »). On garde donc le message de CONTEXTE, qui seul dit ce que le geste ENGAGE (mois
       en cours, ou virement mensuel quand il est tenable) — et on lui met en préambule l'état
       factuel quand il y en a un (le niveau du matelas, côté épargne).
       Pas de contexte calculable (Confort) → la description reprend sa place, plutôt que de laisser
       la décision muette. */
    const ctx = financials
      ? getRecoContextText(r.type, r.actionAmount ?? r.amount, financials, r.recurringFit)
      : null;

    if (ctx) {
      const note = r.stateNote?.trim();
      out.push({
        key: `${r.type}:ctx`, label: r.shortTitle, color: r.color,
        // Retour à la ligne entre l'état et la projection : deux idées, deux respirations.
        text: note ? `${note}\n${ctx}` : ctx,
        icon: 'trending-up-outline', tone: 'tip', recoType: r.type,
      });
    } else if (r.description?.trim()) {
      out.push({
        key: `${r.type}:desc`, label: r.shortTitle, color: r.color,
        text: r.description.trim(), icon: r.icon, tone: 'info', recoType: r.type,
      });
    }
  }

  return out;
}
