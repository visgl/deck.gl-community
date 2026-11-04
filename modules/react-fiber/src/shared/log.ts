import {log as deckLog} from '@deck.gl/core';

/**
 * deck.gl log level at which reconciler trace messages are printed.
 *
 * Matches deck.gl's most detailed built-in level. Enable the trace with
 * `log.setLevel(4)` (`import {log} from '@deck.gl/core'`) or `deck.log.setLevel(4)` in the
 * browser console.
 */
export const RECONCILER_LOG_LEVEL = 4;

const LOG_PREFIX = '[react-fiber]';

/** Internal logger interface used by the reconciler for trace output. */
export interface ReconcilerLog {
  /** Prints a trace message when the deck.gl log level is at least `RECONCILER_LOG_LEVEL`. */
  debug: (message: string) => void;
  /** Attaches structured data to the next `debug` message. */
  withMetadata: (metadata: unknown) => {debug: (message: string) => void};
}

function logDebug(message: string, ...args: unknown[]): void {
  deckLog.log(RECONCILER_LOG_LEVEL, `${LOG_PREFIX} ${message}`, ...args)();
}

/**
 * Logger for deckgl-fiber internal operations.
 *
 * Writes through deck.gl's probe.gl `log`, so reconciler trace output follows deck.gl's
 * log level instead of a component prop.
 */
export const log: ReconcilerLog = {
  debug: message => logDebug(message),
  withMetadata: metadata => ({debug: message => logDebug(message, metadata)})
};
