/** Dispose an imperative embed after the current React commit has completed. */
export function deferImperativeCleanup(cleanup) {
  if (typeof cleanup !== 'function') {
    return;
  }

  queueMicrotask(cleanup);
}
