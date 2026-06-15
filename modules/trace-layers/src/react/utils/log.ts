import {Log} from '@probe.gl/log';

/** A log object for more sophisticated logging and profiling */
export const log = new Log({id: 'tracevis'});
// Keep library probes opt-in so consumers and tests do not emit console noise by default.
log.setLevel(-1);

globalThis.tracevis ||= {log}; // Make it available globally for debugging
