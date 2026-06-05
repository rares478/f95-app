/**
 * In-app dialogs — replaces `window.alert`, `confirm`, `prompt` and Tauri
 * `message`/`confirm`/`ask` for user-facing text. File/folder pickers still
 * use `@tauri-apps/plugin-dialog` (`open`).
 *
 * Rendered by `AppDialogProvider`; call sites import `dialog` from here.
 */

export type DialogKind = 'info' | 'success' | 'warning' | 'error';

export interface AlertOptions {
  title?: string;
  kind?: DialogKind;
  okLabel?: string;
}

export interface ConfirmOptions {
  title?: string;
  kind?: DialogKind;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface PromptOptions {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export type DialogRequest =
  | {
      type: 'alert';
      message: string;
      options?: AlertOptions;
      resolve: () => void;
    }
  | {
      type: 'confirm';
      message: string;
      options?: ConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      type: 'prompt';
      message: string;
      options?: PromptOptions;
      resolve: (value: string | null) => void;
    };

let enqueue: ((req: DialogRequest) => void) | null = null;

export function registerDialogHost(handler: (req: DialogRequest) => void): () => void {
  enqueue = handler;
  return () => {
    if (enqueue === handler) enqueue = null;
  };
}

function show(req: DialogRequest): void {
  if (!enqueue) {
    console.warn('[dialog] host not mounted — falling back to console', req);
    if (req.type === 'alert') {
      console.info(req.message);
      req.resolve();
    } else if (req.type === 'confirm') {
      req.resolve(false);
    } else {
      req.resolve(null);
    }
    return;
  }
  enqueue(req);
}

export function alert(message: string, options?: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    show({ type: 'alert', message, options, resolve });
  });
}

export function confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    show({ type: 'confirm', message, options, resolve });
  });
}

/** Same as `confirm` — replaces Tauri `ask`. */
export function ask(message: string, options?: ConfirmOptions): Promise<boolean> {
  return confirm(message, options);
}

export function prompt(message: string, options?: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    show({ type: 'prompt', message, options, resolve });
  });
}

export const dialog = { alert, confirm, ask, prompt };
