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
export interface DialogRequest { title?: string; message?: string; buttons: DialogButton[]; input?: DialogInput }

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
