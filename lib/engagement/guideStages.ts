/**
 * MACHINE À ÉTATS du parcours de démarrage — logique PURE, sans React ni réseau.
 *
 * Elle vivait dans contexts/GuideContext, mêlée aux requêtes et aux effets : intestable, alors
 * que c'est précisément l'endroit où un utilisateur peut se retrouver bloqué, sauter une étape,
 * ou revoir un modal déjà franchi. Les tests du dépôt couvraient les moteurs financiers, pas ce
 * parcours-là — le défaut qui laissait un compte hériter de l'avancement du précédent n'aurait été
 * attrapé par aucun d'eux.
 *
 * Ici, tout est fonction pure de son entrée : `__tests__/guideStages.test.ts` peut donc dérouler
 * l'ORDRE complet des étapes, cas limites compris. Le contexte React ne fait plus que collecter
 * l'état réel (profil, comptes, transactions) et appeler ces fonctions.
 */

/** Drapeaux du parcours (dans profiles.onboarding_state — aucune migration). */
export type GuideFlag =
  | 'g2_started'        // le parcours a démarré (fige l'éligibilité : plus de dépendance aux données)
  | 'g2_intro'          // explication initiale lue (« J'ai compris »)
  | 'g2_nudge_savings'  // invitation « ajoute une épargne » passée ou honorée
  | 'g2_variable'       // estimation des dépenses variables saisie (> 0)
  | 'g2_margin'         // marge de sécurité enregistrée (0 accepté)
  | 'g2_done'           // parcours terminé
  | 'g2_profile_shown'; // conclusion « ton profil financier » montrée (une seule fois, à la fin)

/** Étape active. Une seule à la fois — et CHACUNE demande une vraie action. */
export type GuideStage =
  | 'idle'
  | 'intro'
  | 'accounts'            // aucun compte : modal à 2 choix (création rapide / créer un compte)
  | 'accounts_checking'   // des comptes, mais aucun compte courant (bloquant)
  | 'accounts_savings'    // aucune épargne (recommandé, passable)
  | 'tx_recurring'        // créer au moins une dépense/recette récurrente (bloquant)
  | 'pilotage_variable'   // « Tu devrais encore dépenser » → estimation obligatoire
  | 'pilotage_margin';    // « Tu veux garder au moins » → enregistrement obligatoire

/** Étapes pendant lesquelles le tableau de bord n'a rien à montrer (Relyka pas calculable). */
export const SETUP_STAGES: readonly GuideStage[] = ['accounts', 'accounts_checking', 'accounts_savings', 'tx_recurring'];

export interface GuideInput {
  /** Le profil est-il chargé ? Rien ne peut être conclu tant qu'il ne l'est pas. */
  hasProfile: boolean;
  isImpersonating: boolean;
  /** Drapeaux g2_* effectifs (optimistes locaux fusionnés avec l'état serveur). */
  flags: Partial<Record<GuideFlag, boolean>>;
  /** Traces des ANCIENS parcours : elles prouvent un compte déjà installé. */
  appTourDone: boolean;
  discoveryIntroSeen: boolean;
  /** Comptes ET transactions réellement LUS (une lecture en cours rend une liste vide). */
  dataReady: boolean;
  /** Lecture des comptes POSÉE (ni écriture en vol, ni relecture en cours). */
  accountsSettled: boolean;
  /** Idem pour les transactions. */
  txSettled: boolean;
  accountsCount: number;
  hasChecking: boolean;
  hasSavings: boolean;
  hasRecurring: boolean;
}

const flag = (i: GuideInput, f: GuideFlag) => Boolean(i.flags[f]);

/**
 * Le parcours est-il « en jeu » pour ce compte ?
 *
 * Se lit sur le PROFIL SEUL (jamais sur les comptes) : soit le parcours est commencé, soit il n'y
 * a aucune trace d'un ancien parcours. C'est ce qui permet de couvrir l'écran pendant que les
 * données se chargent — et, ailleurs dans l'app, de savoir qu'il ne faut pas interrompre quelqu'un
 * qui est encore en train d'installer son compte.
 */
export function isGuideInPlay(i: GuideInput): boolean {
  if (!i.hasProfile || i.isImpersonating || flag(i, 'g2_done')) return false;
  return flag(i, 'g2_started') || (!i.appTourDone && !i.discoveryIntroSeen);
}

/**
 * Un compte NEUF : aucun compte bancaire et aucune trace des anciens parcours. Les comptes
 * existants ne doivent JAMAIS voir ce guide — d'où les deux garde-fous.
 */
export function isFreshAccount(i: GuideInput): boolean {
  return i.hasProfile && !i.isImpersonating && i.dataReady
    && i.accountsCount === 0 && !i.appTourDone && !i.discoveryIntroSeen;
}

/** Le parcours doit-il piloter l'app maintenant ? */
export function isGuideActive(i: GuideInput): boolean {
  if (i.isImpersonating || flag(i, 'g2_done')) return false;
  return flag(i, 'g2_started') || isFreshAccount(i);
}

/**
 * L'étape en cours. L'ordre est celui dans lequel les données se CONDITIONNENT :
 *   comptes → ce qui rentre/sort chaque mois → dépenses variables → marge de sécurité.
 *
 * `idle` couvre deux situations distinctes qu'il ne faut pas confondre : « plus rien à faire »
 * et « on ne sait pas encore » (lecture non aboutie). Dans les deux cas, on n'affiche AUCUN modal —
 * conclure « aucun compte » sur une liste simplement en cours de lecture renverrait l'utilisateur
 * créer un compte qu'il possède déjà.
 */
export function computeGuideStage(i: GuideInput): GuideStage {
  if (!isGuideActive(i)) return 'idle';
  if (!flag(i, 'g2_intro')) return 'intro';
  if (!i.dataReady) return 'idle';
  if (i.accountsCount === 0) return i.accountsSettled ? 'accounts' : 'idle';
  if (!i.hasChecking) return 'accounts_checking';
  if (!i.hasSavings && !flag(i, 'g2_nudge_savings')) return 'accounts_savings';
  if (!i.hasRecurring) return i.txSettled ? 'tx_recurring' : 'idle';
  if (!flag(i, 'g2_variable')) return 'pilotage_variable';
  if (!flag(i, 'g2_margin')) return 'pilotage_margin';
  return 'idle';
}

/** L'installation est-elle trop peu avancée pour que le tableau de bord ait un sens ? */
export function isInSetup(i: GuideInput): boolean {
  return isGuideActive(i) && SETUP_STAGES.includes(computeGuideStage(i));
}

/**
 * Le parcours est fini mais sa CONCLUSION (le profil financier) reste à montrer.
 * Seul moment où on le présente — pas pendant l'installation, où il bouge à chaque saisie.
 */
export function isTourJustFinished(i: GuideInput): boolean {
  return i.hasProfile && !i.isImpersonating && flag(i, 'g2_done') && !flag(i, 'g2_profile_shown');
}
