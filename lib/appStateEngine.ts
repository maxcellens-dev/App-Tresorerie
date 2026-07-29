// Moteur d'état — détermine LA prochaine action utile pour le user à l'ouverture de l'app.
// Une seule action à la fois (la plus prioritaire). Consommé par le bandeau « prochain geste ».
// Ne remplace pas le guide « Pour bien démarrer » : il le complète pour le quotidien.
import { unverifiedSincePhrase } from './confidenceEngine';

export type AppActionType =
  | 'setup'          // un réglage de base manque (solde / revenu / charges fixes)
  | 'shared_mode'    // un compte partagé sans mode (question à poser une fois)
  | 'app_lock'       // proposition unique d'activer le verrouillage biométrique
  | 'soft_close'     // un mois précédent en attente de clôture
  | 'check_balance'  // confiance basse → inviter à vérifier le solde
  | 'joint_low';     // mode Contribution : compte commun bientôt à découvert

export interface AppAction {
  type: AppActionType;
  title: string;
  reason: string;
  eta?: string;
  /** Route expo-router à ouvrir au tap (pré-remplie si possible). */
  deeplink?: string;
  /** Clé de dismiss (inclut le contexte pour ne pas re-cacher une action différente). */
  dismissKey: string;
  /** true pour l'état positif (affichage réduit/discret). */
  positive?: boolean;
  /** Le tap déclenche une action DANS l'app (pas une navigation) → chevron affiché quand même. */
  interactive?: boolean;
}

export interface AppStateInputs {
  hasBalance: boolean;
  hasIncome: boolean;
  hasFixed: boolean;
  /** Mois le plus ancien en attente de clôture (YYYY-MM) ou null. */
  pendingClosureMonth: string | null;
  /** Un compte partagé sans mode défini (à qualifier une fois), ou null. */
  sharedModePrompt: { accountId: string; name: string } | null;
  /** Proposer le verrouillage biométrique (une seule fois, cf. useAppLockPrompt). */
  offerAppLock?: boolean;
  confidenceLow: boolean;
  daysSinceVerification: number;
  /** Compte commun (Contribution) bientôt à découvert, ou null. */
  jointLow: { accountId: string; name: string } | null;
  /** Texte du reste dispo pour l'état positif (ex. « ~220 € »). */
  relykaText?: string;
  /** Fonctionnalité clôture active (sinon on n'affiche pas soft_close). */
  closureEnabled?: boolean;
  /** Compte courant principal → deeplinks « solde » PRÉ-REMPLIS (modal Nouveau Solde ouvert). */
  mainCheckingId?: string | null;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long' });
}

/**
 * Retourne LA prochaine action prioritaire, ou `null` quand il n'y a RIEN à faire.
 *
 * Il y avait ici un 6ᵉ cas « Tout est à jour » : un bandeau positif qui n'appelait aucun geste.
 * Ne rien avoir à dire ne justifie pas de prendre le haut de l'écran — le badge « À jour » posé
 * juste à côté du Relyka porte déjà cette information, là où on regarde le chiffre.
 * Ton : TUTOIEMENT partout (cohérent avec l'app).
 */
export function getCurrentAction(i: AppStateInputs): AppAction | null {
  // Deeplink solde : directement le modal « Nouveau Solde » du compte principal si connu.
  const balanceLink = i.mainCheckingId ? `/(tabs)/comptes/${i.mainCheckingId}?verify=1` : '/(tabs)/comptes';

  // 0) Proposition UNIQUE du verrouillage biométrique, dès que la présentation du Pilotage est lue.
  //    EN TÊTE volontairement : elle n'est proposée QU'UNE FOIS et ne revient jamais (drapeau local à
  //    l'appareil) — placée plus bas, un utilisateur ayant en permanence un autre signal (réglage
  //    manquant, confiance basse, clôture en attente) ne la verrait tout simplement jamais. Elle
  //    disparaît dès qu'elle est acceptée ou fermée, donc elle ne retarde les autres que d'une fois.
  if (i.offerAppLock) {
    return {
      type: 'app_lock', title: "Verrouille l'accès à Relyka",
      reason: 'Face ID / empreinte au lancement — appuie pour activer,\nou retrouve-le plus tard dans Paramètres',
      eta: '(~10 s)', dismissKey: 'app_lock', interactive: true,
    };
  }

  // 1) Réglages de base manquants (le plus structurant).
  if (!i.hasBalance) {
    return {
      type: 'setup', title: 'Renseigne ton solde',
      reason: 'tes chiffres seront fiables dès le départ', eta: '(~30 s)',
      deeplink: balanceLink, dismissKey: 'setup:balance',
    };
  }
  if (!i.hasIncome) {
    return {
      type: 'setup', title: 'Ajoute ton revenu principal',
      reason: "l'app anticipera tes rentrées d'argent", eta: '(~30 s)',
      deeplink: '/(tabs)/transactions/add?type=income', dismissKey: 'setup:income',
    };
  }
  if (!i.hasFixed) {
    return {
      type: 'setup', title: 'Ajoute tes charges fixes',
      reason: 'loyer, abonnements… pour un budget réaliste', eta: '(~1 min)',
      deeplink: '/(tabs)/transactions/add?type=expense', dismissKey: 'setup:fixed',
    };
  }

  // 2) Compte partagé à qualifier (une fois, différable).
  if (i.sharedModePrompt) {
    return {
      type: 'shared_mode', title: 'Comment utilises-tu ce compte commun ?',
      reason: `« ${i.sharedModePrompt.name} » — pour des chiffres justes`, eta: '(~15 s)',
      deeplink: `/(tabs)/comptes/edit/${i.sharedModePrompt.accountId}`,
      dismissKey: `shared_mode:${i.sharedModePrompt.accountId}`,
    };
  }

  // 3) Clôture d'un mois précédent.
  if (i.closureEnabled && i.pendingClosureMonth) {
    return {
      type: 'soft_close', title: `Clôture ton mois de ${monthLabel(i.pendingClosureMonth)}`,
      reason: 'fige le passé pour fiabiliser tes calculs', eta: '(~30 s)',
      deeplink: '/(tabs)/pilotage?closure=1', dismissKey: `soft_close:${i.pendingClosureMonth}`,
    };
  }

  // 4) Confiance BASSE → les montants affichés sont des ESTIMATIONS (données probablement plus à
  //    jour). En confiance MOYENNE, seul le bandeau ambre de la carte Relyka le signale (pas de
  //    doublon overlay) — et l'état positif est supprimé côté hook.
  if (i.confidenceLow) {
    return {
      type: 'check_balance', title: 'Vérifie ton solde',
      reason: `tes montants sont des estimations - \ntes données ne sont sans doute plus à jour (solde non vérifié ${unverifiedSincePhrase(i.daysSinceVerification)})`,
      eta: '(~30 s)', deeplink: balanceLink, dismissKey: 'check_balance',
    };
  }

  // 5) Surveillance du compte commun (Contribution).
  if (i.jointLow) {
    return {
      type: 'joint_low', title: 'Compte commun bientôt à découvert',
      reason: `« ${i.jointLow.name} » : pense à faire une contribution`, eta: '(~30 s)',
      deeplink: `/(tabs)/comptes/${i.jointLow.accountId}`,
      dismissKey: `joint_low:${i.jointLow.accountId}`,
    };
  }

  // 6) Rien à signaler → AUCUN bandeau.
  return null;
}
