import {Log} from '@probe.gl/log';

/** A log object for more sophisticated logging and profiling */
export const log = new Log({id: 'tracevis'});

type TracevisGlobal = typeof globalThis & {tracevis?: {log: Log}};

(globalThis as TracevisGlobal).tracevis ??= {log}; // Make it available globally for debugging
