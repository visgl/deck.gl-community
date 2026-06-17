import {compareNumericSortStrings} from './numeric-sort';

import type {TraceThread} from '../trace-graph/trace-types';

/** Option for selecting trace threads by their display name. */
export type TraceThreadNameOption = {
  /** User-visible thread name label. */
  label: string;
  /** Thread name value used by trace settings. */
  value: string;
};

/**
 * Builds stable display-name options for settings that filter trace threads.
 */
export function buildTraceThreadNameOptions(
  threads: ReadonlyArray<Pick<TraceThread, 'name'>>
): TraceThreadNameOption[] {
  const threadNames = new Set<string>();
  for (const thread of threads) {
    const threadName = thread.name?.trim();
    if (!threadName || threadName === 'all_threads') {
      continue;
    }
    threadNames.add(threadName);
  }

  return Array.from(threadNames)
    .sort(compareNumericSortStrings)
    .map(threadName => ({
      label: threadName,
      value: threadName
    }));
}
