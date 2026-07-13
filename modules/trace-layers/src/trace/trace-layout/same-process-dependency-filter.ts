import type {TraceVisSettings} from '../trace-graph/trace-settings';

/** Default wait threshold for SUBMIT same-process dependencies to be treated as warning-level waits. */
export const DEFAULT_SUBMIT_MIN_WAIT_TIME_MS = 10;

/** Compatibility alias for the default SUBMIT same-process-dependency warning threshold. */
export const SUBMIT_MIN_WAIT_TIME_MS = DEFAULT_SUBMIT_MIN_WAIT_TIME_MS;

/** Returns whether one same-process dependency row should be visible for the selected mode. */
export function shouldShowSameProcessDependencyByModeFields(
  mode: TraceVisSettings['sameProcessDependencyMode'],
  hasSubmitKeyword: boolean,
  waitTimeMs: number,
  submitMinWaitTimeMs = DEFAULT_SUBMIT_MIN_WAIT_TIME_MS
): boolean {
  if (mode === 'warnings') {
    return hasSubmitKeyword && waitTimeMs < submitMinWaitTimeMs;
  }

  if (mode === 'submit') {
    return hasSubmitKeyword;
  }

  return true;
}

/** Returns whether one same-process dependency row should be visible for the selected mode. */
export function shouldShowSameProcessDependencyByMode(params: {
  /** Dependency keywords read from the dependency row. */
  readonly keywords: ReadonlySet<string>;
  /** Dependency wait duration read from the dependency row. */
  readonly waitTimeMs: number;
  /** Same-process dependency visibility mode from trace settings. */
  readonly mode: TraceVisSettings['sameProcessDependencyMode'];
  /** Warning cutoff for SUBMIT dependencies. */
  readonly submitMinWaitTimeMs?: number;
}): boolean {
  return shouldShowSameProcessDependencyByModeFields(
    params.mode,
    params.keywords.has('SUBMIT'),
    params.waitTimeMs,
    params.submitMinWaitTimeMs
  );
}
