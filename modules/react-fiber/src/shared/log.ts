import {ConsoleTransport, LogLayer} from 'loglayer';

/**
 * Centralized logger for deckgl-fiber internal operations
 *
 * Provides structured logging with automatic object serialization and
 * consistent prefixing. Logging is disabled by default and controlled
 * via the `debug` prop on the Deckgl component.
 */
export const log = new LogLayer({
  // Dynamically controlled via prop on Deckgl React component
  enabled: false,

  prefix: '[deckgl-fiber]',

  transport: new ConsoleTransport({
    appendObjectData: true,
    logger: console
  })
});
