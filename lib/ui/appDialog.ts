/**
 * Dialogue in-app global (§7) — remplace TOUTES les pop-ups du navigateur.
 *  - `Alert.alert(...)` est rerouté vers ce système (voir AppDialogHost) → aucun appel à modifier.
 *  - `appConfirm()` / `appAlert()` remplacent les `window.confirm` / `window.alert` synchrones
 *    (qui ne peuvent pas être interceptés sans changer leur appel).
 * Un seul dialogue à la fois ; suffisant pour des confirmations.
 */
export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';
/** `onPress` reçoit la valeur du champ de saisie si le dialogue en comporte un (cf. appPrompt). */
export interface DialogButton { text: string; style?: DialogButtonStyle; onPress?: (inputValue?: string) => void }
export interface DialogInput {
  defaultValue?: string; placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad'; suffix?: string;
}
/**
 * Choix ILLUSTRÉ : une carte pleine largeur qui montre la CONSÉQUENCE de l'option (le solde obtenu)
 * au lieu de la décrire. Sur les décisions où l'on hésite — « cette opération est-elle déjà dans ce
 * solde ? » — voir les deux résultats côte à côte tranche en une seconde, là où deux boutons
 * « Oui / Non » obligent à reconstituer le calcul de tête.
 */
export interface DialogOption {
  icon?: string;
  label: string;
  /** Une ligne d'explication, courte. */
  hint?: string;
  /** Résultat mis en avant (ex. « Solde : 1 482 € »). */
  result?: string;
  /** Légende du résultat (ex. « inchangé » / « au 28-07-2026 »). */
  resultHint?: string;
  tone?: 'accent' | 'neutral' | 'danger';
  onPress: () => void;
}

export interface DialogRequest {
  title?: string; message?: string; buttons: DialogButton[]; input?: DialogInput;
  /** Si fourni, remplace la rangée de boutons par des cartes de choix illustrées. */
  options?: DialogOption[];
  /**
   * Le dialogue peut-il être quitté SANS répondre (tap sur le fond, retour Android) ? Défaut : oui.
   *
   * ⚠️ `false` pour toute question dont la réponse CHANGE ce qui va être écrit en base. Fermer sans
   * choisir y retombait sur le bouton 'cancel' caché, donc sur une valeur par défaut silencieuse :
   * l'écriture partait quand même, avec une réponse que l'utilisateur n'avait jamais donnée et
   * qu'aucun écran ne lui montrait ensuite (cf. « Déjà comptée dans ce solde ? »).
   */
  dismissible?: boolean;
}

let controller: ((req: DialogRequest) => void) | null = null;

/** Enregistre l'hôte de rendu (appelé par AppDialogHost). */
export function registerDialogHost(fn: ((req: DialogRequest) => void) | null) {
  controller = fn;
}

/** Confirmation in-app (remplace `if (window.confirm(...)) …`). Résout `true` si confirmé. */
export function appConfirm(opts: {
  title?: string; message?: string; confirmText?: string; cancelText?: string; destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const req: DialogRequest = {
      title: opts.title,
      message: opts.message,
      buttons: [
        { text: opts.cancelText ?? 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        { text: opts.confirmText ?? 'Confirmer', style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
    };
    if (controller) controller(req); else resolve(false);
  });
}

/**
 * Saisie in-app (remplace `window.prompt(...)`). Résout la valeur saisie si confirmé, `null` sinon.
 * Le champ est pré-rempli avec `defaultValue` (modifiable par l'utilisateur).
 */
export function appPrompt(opts: {
  title?: string; message?: string; defaultValue?: string; placeholder?: string;
  confirmText?: string; cancelText?: string; keyboardType?: 'default' | 'decimal-pad'; suffix?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const req: DialogRequest = {
      title: opts.title,
      message: opts.message,
      input: { defaultValue: opts.defaultValue, placeholder: opts.placeholder, keyboardType: opts.keyboardType, suffix: opts.suffix },
      buttons: [
        { text: opts.cancelText ?? 'Annuler', style: 'cancel', onPress: () => resolve(null) },
        { text: opts.confirmText ?? 'OK', style: 'default', onPress: (v?: string) => resolve(v ?? '') },
      ],
    };
    if (controller) controller(req); else resolve(null);
  });
}

/**
 * Choix entre deux options ILLUSTRÉES (cf. DialogOption). Résout l'index choisi, ou −1 si le
 * dialogue n'a pas pu être posé.
 *
 * ⚠️ ON NE PEUT PAS PASSER À CÔTÉ. Ces cartes ne servent pas à confirmer, elles servent à TRANCHER :
 * chacune décrit un enregistrement différent, et il n'existe pas de « bonne » valeur par défaut.
 * Le tap sur le fond retombait pourtant sur le bouton 'cancel' de repli — l'opération partait avec
 * la réponse « non », muette, alors que l'utilisateur croyait avoir annulé. Le dialogue est donc
 * `dismissible: false` : la seule sortie est une des cartes.
 */
export function appChoice(opts: {
  title?: string; message?: string; options: Omit<DialogOption, 'onPress'>[];
}): Promise<number> {
  return new Promise((resolve) => {
    const req: DialogRequest = {
      title: opts.title,
      message: opts.message,
      options: opts.options.map((o, i) => ({ ...o, onPress: () => resolve(i) })),
      /* Repli si l'hôte ne sait pas rendre les options (jamais atteint tant qu'il y en a) : il faut
         alors une sortie VISIBLE, sinon la promesse resterait pendante à jamais. */
      buttons: [{ text: 'Annuler', style: 'cancel', onPress: () => resolve(-1) }],
      dismissible: false,
    };
    if (controller) controller(req); else resolve(-1);
  });
}

/** Notification in-app (remplace `window.alert(...)`). */
export function appAlert(opts: { title?: string; message?: string; okText?: string }): Promise<void> {
  return new Promise((resolve) => {
    const req: DialogRequest = {
      title: opts.title,
      message: opts.message,
      buttons: [{ text: opts.okText ?? 'OK', style: 'default', onPress: () => resolve() }],
    };
    if (controller) controller(req); else resolve();
  });
}

/** Adaptateur compatible `Alert.alert(title, message, buttons, options)` → dialogue in-app. */
export function alertCompat(title?: string, message?: string, buttons?: DialogButton[]) {
  const btns: DialogButton[] = buttons && buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' }];
  const req: DialogRequest = { title, message, buttons: btns };
  if (controller) controller(req);
}
