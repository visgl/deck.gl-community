import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toastManager } from './toast-manager';

import type { ToastKind, ToastRequest } from './toast-manager';

function addToast({
  type,
  message,
  key,
}: {
  type: ToastKind;
  message: string;
  key?: string;
}): string {
  const request: ToastRequest = { type, message, key };
  return toastManager.toast(request);
}

beforeEach(() => {
  toastManager.clear();
});

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
  toastManager.clear();
});

describe('ToastManager', () => {
  it('adds toasts, returns IDs, and supports dismiss/clear', () => {
    const firstId = addToast({ type: 'info', message: 'Saved' });
    const secondId = addToast({ type: 'warning', message: 'Retried' });

    expect(firstId).toBeTypeOf('string');
    expect(secondId).toBeTypeOf('string');
    expect(toastManager.getToasts()).toHaveLength(2);

    toastManager.dismiss(secondId);
    expect(toastManager.getToasts()).toHaveLength(1);
    expect(toastManager.getToasts().find((toast) => toast.id === secondId)).toBeUndefined();

    toastManager.clear();
    expect(toastManager.getToasts()).toHaveLength(0);
  });

  it('replaces existing toasts when key matches', () => {
    const id = addToast({ type: 'info', message: 'first', key: 'build' });
    const replacementId = addToast({ type: 'error', message: 'second', key: 'build' });

    expect(replacementId).toBe(id);

    const toasts = toastManager.getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      id,
      key: 'build',
      type: 'error',
      message: 'second',
    });
  });

  it('caps visible toasts at 3', () => {
    const ids: string[] = [];
    ids.push(addToast({ type: 'info', message: '1' }));
    ids.push(addToast({ type: 'info', message: '2' }));
    ids.push(addToast({ type: 'info', message: '3' }));
    ids.push(addToast({ type: 'info', message: '4' }));

    expect(toastManager.getToasts()).toHaveLength(3);
    expect(toastManager.getToasts().map((toast) => toast.id)).toEqual([ids[3], ids[2], ids[1]]);
  });

  it('auto dismisses according to toast kind durations', () => {
    vi.useFakeTimers();

    const infoId = addToast({ type: 'info', message: 'info' });
    const warningId = addToast({ type: 'warning', message: 'warning' });
    const errorId = addToast({ type: 'error', message: 'error' });

    expect(toastManager.getToasts().map((toast) => toast.id)).toEqual([errorId, warningId, infoId]);

    vi.advanceTimersByTime(4_000);
    expect(toastManager.getToasts().map((toast) => toast.id)).toEqual([errorId, warningId]);

    vi.advanceTimersByTime(2_000);
    expect(toastManager.getToasts().map((toast) => toast.id)).toEqual([errorId]);

    vi.advanceTimersByTime(2_000);
    expect(toastManager.getToasts()).toHaveLength(0);
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = toastManager.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    toastManager.toast({ type: 'info', message: 'a' });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    toastManager.toast({ type: 'warning', message: 'b' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
