import type {TraceVisSettings} from '../trace-graph/trace-settings';

/** Default wait threshold for SUBMIT local dependencies to be treated as warning-level waits. */
export const DEFAULT_SUBMIT_MIN_WAIT_TIME_MS = 10;

/** Compatibility alias for the default SUBMIT local-dependency warning threshold. */
export const SUBMIT_MIN_WAIT_TIME_MS = DEFAULT_SUBMIT_MIN_WAIT_TIME_MS;

type FilterableLocalDependency = {
  /** Dependency keywords consulted by the local-dependency visibility filter. */
  keywords: ReadonlySet<string>;
  /** Wait duration consulted by the warning-mode filter. */
  waitTimeMs: number;
};

/** Returns whether one local dependency row should be visible for the selected mode. */
export function shouldShowLocalDependencyByModeFields(
  mode: TraceVisSettings['localDependencyMode'],
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

/** Returns whether one local dependency row should be visible for the selected mode. */
export function shouldShowLocalDependencyByMode(params: {
  /** Dependency keywords read from the dependency row. */
  readonly keywords: ReadonlySet<string>;
  /** Dependency wait duration read from the dependency row. */
  readonly waitTimeMs: number;
  /** Local dependency visibility mode from trace settings. */
  readonly mode: TraceVisSettings['localDependencyMode'];
  /** Warning cutoff for SUBMIT dependencies. */
  readonly submitMinWaitTimeMs?: number;
}): boolean {
  return shouldShowLocalDependencyByModeFields(
    params.mode,
    params.keywords.has('SUBMIT'),
    params.waitTimeMs,
    params.submitMinWaitTimeMs
  );
}

/** Filters object-shaped local dependencies for compatibility callers. */
export function filterLocalDependenciesByMode<T extends FilterableLocalDependency>(
  dependencies: readonly T[],
  mode: TraceVisSettings['localDependencyMode'],
  submitMinWaitTimeMs = DEFAULT_SUBMIT_MIN_WAIT_TIME_MS
): T[] {
  return dependencies.filter(dependency =>
    shouldShowLocalDependencyByMode({
      keywords: dependency.keywords,
      waitTimeMs: dependency.waitTimeMs,
      mode,
      submitMinWaitTimeMs
    })
  );
}
