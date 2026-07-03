// Moteur d'état — détermine LA prochaine action utile pour le user à l'ouverture de l'app.
// Une seule action à la fois (la plus prioritaire). Consommé par le bandeau « prochain geste ».
// Ne remplace pas le guide « Pour bien démarrer » : il le complète pour le quotidien.

export type AppActionType =
  | 'setup'          // un réglage de base manque (solde / revenu / charges fixes)
  | 'shared_mode'    // un compte partagé sans mode (question à poser une fois)
  | 'soft_close'     // un mois précédent en attente de clôture
  | 'check_balance'  // confiance basse → inviter à vérifier le solde
  | 'joint_low'      // mode Contribution : compte commun bientôt à découvert
  | 'ok';            // rien à signaler (état positif discret)

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
}

export interface AppStateInputs {
  hasBalance: boolean;
  hasIncome: boolean;
  hasFixed: boolean;
  /** Mois le plus ancien en attente de clôture (YYYY-MM) ou null. */
  pendingClosureMonth: string | null;
  /** Un compte partagé sans mode défini (à qualifier une fois), ou null. */
  sharedModePrompt: { accountId: string; name: string } | null;
  confidenceLow: boolean;
  daysSinceVerification: number;
  /** Compte commun (Contribution) bientôt à découvert, ou null. */
  jointLow: { accountId: string; name: string } | null;
  /** Texte du reste dispo pour l'état positif (ex. « ~220 € »). */
  relykaText?: string;
  /** Fonctionnalité clôture active (sinon on n'affiche pas soft_close). */
  closureEnabled?: boolean;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long' });
}

/** Retourne LA prochaine action prioritaire. */
export function getCurrentAction(i: AppStateInputs): AppAction {
  // 1) Réglages de base manquants (le plus structurant).
  if (!i.hasBalance) {
    return {
      type: 'setup', title: 'Renseignez votre solde',
      reason: 'vos chiffres deviennent fiables dès le départ', eta: '~30 s',
      deeplink: '/(tabs)/comptes', dismissKey: 'setup:balance',
    };
  }
  if (!i.hasIncome) {
    return {
      type: 'setup', title: 'Ajoutez votre revenu principal',
      reason: "l'app anticipe alors vos rentrées d'argent", eta: '~30 s',
      deeplink: '/(tabs)/transactions/add?type=income', dismissKey: 'setup:income',
    };
  }
  if (!i.hasFixed) {
    return {
      type: 'setup', title: 'Ajoutez vos charges fixes',
      reason: 'loyer, abonnements… pour un budget réaliste', eta: '~1 min',
      deeplink: '/(tabs)/transactions/add?type=expense', dismissKey: 'setup:fixed',
    };
  }

  // 2) Compte partagé à qualifier (une fois, différable).
  if (i.sharedModePrompt) {
    return {
      type: 'shared_mode', title: 'Comment utilisez-vous ce compte commun ?',
      reason: `« ${i.sharedModePrompt.name} » — pour des chiffres justes`, eta: '~15 s',
      deeplink: `/(tabs)/comptes/edit/${i.sharedModePrompt.accountId}`,
      dismissKey: `shared_mode:${i.sharedModePrompt.accountId}`,
    };
  }

  // 3) Clôture d'un mois précédent.
  if (i.closureEnabled && i.pendingClosureMonth) {
    return {
      type: 'soft_close', title: `Clôturer ${monthLabel(i.pendingClosureMonth)}`,
      reason: 'figez le passé pour fiabiliser vos calculs', eta: '~30 s',
      deeplink: '/(tabs)/pilotage', dismissKey: `soft_close:${i.pendingClosureMonth}`,
    };
  }

  // 4) Confiance basse → vérifier le solde.
  if (i.confidenceLow) {
    return {
      type: 'check_balance', title: 'Mettez à jour votre solde',
      reason: `non vérifié depuis ${i.daysSinceVerification} j — vos chiffres redeviennent fiables`,
      eta: '~30 s', deeplink: '/(tabs)/comptes', dismissKey: 'check_balance',
    };
  }

  // 5) Surveillance du compte commun (Contribution).
  if (i.jointLow) {
    return {
      type: 'joint_low', title: 'Compte commun bientôt à découvert',
      reason: `« ${i.jointLow.name} » : pensez à une contribution`, eta: '~30 s',
      deeplink: `/(tabs)/comptes/${i.jointLow.accountId}`,
      dismissKey: `joint_low:${i.jointLow.accountId}`,
    };
  }

  // 6) Rien à signaler → état positif discret.
  return {
    type: 'ok', title: 'Tout est à jour',
    reason: i.relykaText ? `il vous reste ${i.relykaText} ce mois` : 'vos chiffres sont fiables',
    dismissKey: 'ok', positive: true,
  };
}
