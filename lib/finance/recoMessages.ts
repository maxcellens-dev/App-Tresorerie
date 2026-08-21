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
 *  • trajectoire déjà sous la marge (tout conserver) → message tout prêt (reco.guardNote).
 * Le verbe est DANS le message (pas de préfixe « Investir — »).
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
  /** Solde non vérifié depuis longtemps : la consigne que portait le bandeau ambre des recos. */
  unverifiedMessage?: string | null;
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
  if (unverifiedMessage?.trim()) {
    substantive.push({ key: 'relyka:unverified', label: 'À vérifier', color: warnColor, text: unverifiedMessage.trim(), icon: 'shield-outline', tone: 'warn' });
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
