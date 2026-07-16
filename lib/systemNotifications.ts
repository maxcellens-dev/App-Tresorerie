// Catalogue des NOTIFICATIONS SYSTÈME introduites par le package Fiabilité / Périmètre.
// Déclenchées côté client par le moteur d'état (appStateEngine), documentées et activables en admin
// (app_config.system_notifications : { [id]: { enabled } }). N'altère pas les notifications push admin.

export interface SystemNotificationDef {
  id: string;
  title: string;
  /** Corps d'exemple (le contenu réel peut être contextualisé). */
  bodyExample: string;
  /** Condition de déclenchement, en clair. */
  condition: string;
  /** Fréquence maximale (garde-fou anti-spam). */
  maxFrequency: string;
  /** Activée par défaut ? */
  defaultEnabled: boolean;
}

// NB : le push hebdo du Point (`pulse_weekly`) n'est PLUS une notification système : il est géré
// comme une NOTIFICATION PLANIFIÉE récurrente « Hebdo » (admin Notifications → Planifier, envoyée
// par send-scheduled-notifications). Une seule commande — l'ancien toggle d'ici ne pilotait rien.
export const SYSTEM_NOTIFICATIONS: SystemNotificationDef[] = [
  {
    id: 'soft_close_reminder',
    title: 'Clôturer ton mois',
    bodyExample: 'Ton mois de juin est prêt à être clôturé — 30 s pour fiabiliser tes chiffres.',
    condition: 'Un mois précédent est en attente de clôture (statut ni confirmed ni estimated).',
    maxFrequency: '1 par mois et par mois-à-clôturer',
    defaultEnabled: true,
  },
  {
    id: 'confidence_low',
    title: 'Tes chiffres sont à vérifier',
    bodyExample: 'Solde non vérifié depuis un moment — tes montants sont affichés en fourchette. Vérifie en 30 s.',
    condition: "Le niveau de confiance est « bas » (doute > seuil) alors qu'aucune vérification récente.",
    maxFrequency: '1 par semaine',
    defaultEnabled: true,
  },
  {
    id: 'joint_low_balance',
    title: 'Compte commun bientôt à découvert',
    bodyExample: 'Selon les prélèvements prévus, ton compte commun passe sous 0 avant ta prochaine contribution.',
    condition: 'Mode Contribution : le solde prévisionnel du joint passe < 0 avant la prochaine contribution attendue.',
    maxFrequency: '1 par semaine et par compte',
    defaultEnabled: true,
  },
  {
    id: 'shared_mode_prompt',
    title: 'Comment utilises-tu ce compte commun ?',
    bodyExample: 'Dis-nous si ton compte commun sert aux charges ou au quotidien — pour des chiffres justes.',
    condition: 'Un compte partagé existant n’a pas encore de mode (shared_mode NULL).',
    maxFrequency: '1 par compte (différable)',
    defaultEnabled: true,
  },
];

export type SystemNotificationsConfig = Record<string, { enabled: boolean }>;

/** État d'activation résolu (défauts + overrides admin). */
export function isSystemNotificationEnabled(
  id: string,
  config: SystemNotificationsConfig | null | undefined,
): boolean {
  const def = SYSTEM_NOTIFICATIONS.find((n) => n.id === id);
  const override = config?.[id];
  if (override && typeof override.enabled === 'boolean') return override.enabled;
  return def?.defaultEnabled ?? false;
}
