export type ToastKind = 'info' | 'warning' | 'error';

export type ToastRequest = {
  type: ToastKind;
  title?: string;
  message: string;
  key?: string;
};

export type ToastEntry = ToastRequest & {
  id: string;
  createdAtMs: number;
};

type ToastListener = (toasts: ReadonlyArray<ToastEntry>) => void;

type ToastTimer = ReturnType<typeof setTimeout>;

const DEFAULT_MAX_VISIBLE_TOASTS = 3;
const AUTO_DISMISS_BY_TYPE: Record<ToastKind, number> = {
  error: 8_000,
  info: 4_000,
  warning: 6_000
};

function createToastId(prefix = 'toast'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class ToastManager {
  #toasts: ToastEntry[] = [];
  #listeners = new Set<ToastListener>();
  #timers = new Map<string, ToastTimer>();
  #maxVisibleToasts: number;

  constructor(maxVisibleToasts = DEFAULT_MAX_VISIBLE_TOASTS) {
    this.#maxVisibleToasts = maxVisibleToasts;
  }

  toast(request: ToastRequest): string {
    const now = Date.now();
    const toast: ToastEntry = {
      id: createToastId(),
      createdAtMs: now,
      ...request
    };

    if (toast.key) {
      const duplicateKeyIndex = this.#toasts.findIndex(nextToast => nextToast.key === toast.key);
      if (duplicateKeyIndex !== -1) {
        const existingToast = this.#toasts[duplicateKeyIndex];
        toast.id = existingToast.id;
        this.#toasts.splice(duplicateKeyIndex, 1);
      }
    }

    this.#toasts.unshift(toast);
    this.#enforceCap();
    this.#scheduleAutoDismiss(toast.id, toast.type);
    this.#notify();

    return toast.id;
  }

  dismiss(toastId: string): void {
    const toastIndex = this.#toasts.findIndex(toast => toast.id === toastId);
    if (toastIndex === -1) {
      return;
    }

    this.#toasts.splice(toastIndex, 1);
    this.#clearAutoDismissTimer(toastId);
    this.#notify();
  }

  clear(): void {
    for (const toastId of this.#toasts.map(toast => toast.id)) {
      this.#clearAutoDismissTimer(toastId);
    }

    this.#toasts = [];
    this.#notify();
  }

  getToasts(): ReadonlyArray<ToastEntry> {
    return this.#toasts.slice();
  }

  subscribe(listener: ToastListener): () => void {
    this.#listeners.add(listener);
    listener(this.getToasts());

    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    const snapshots = this.getToasts();
    for (const listener of this.#listeners) {
      listener(snapshots);
    }
  }

  #scheduleAutoDismiss(toastId: string, toastType: ToastKind): void {
    const autoDismissMs = AUTO_DISMISS_BY_TYPE[toastType];
    this.#clearAutoDismissTimer(toastId);

    const timer = setTimeout(() => {
      this.dismiss(toastId);
    }, autoDismissMs);
    this.#timers.set(toastId, timer);
  }

  #clearAutoDismissTimer(toastId: string): void {
    const timer = this.#timers.get(toastId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.#timers.delete(toastId);
  }

  #enforceCap(): void {
    const toastsToRemove = this.#toasts.slice(this.#maxVisibleToasts);
    this.#toasts = this.#toasts.slice(0, this.#maxVisibleToasts);
    for (const toast of toastsToRemove) {
      this.#clearAutoDismissTimer(toast.id);
    }
  }
}

export const toastManager = new ToastManager();
