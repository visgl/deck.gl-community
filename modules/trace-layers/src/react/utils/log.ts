import {Log} from '@probe.gl/log';

/** A log object for more sophisticated logging and profiling */
export const log: Log = new Log({id: 'tracevis'});

const tracevisGlobal = globalThis as typeof globalThis & {
  tracevis?: {log: Log};
};
tracevisGlobal.tracevis ||= {log}; // Make it available globally for debugging
