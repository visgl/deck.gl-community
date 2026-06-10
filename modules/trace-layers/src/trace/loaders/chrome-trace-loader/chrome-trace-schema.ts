import {z, ZodError} from 'zod';

/**
 * All the phase letters that Chrome Trace uses
 * @see https://www.chromium.org/developers/the-trace-event-protocol)
 */
// prettier-ignore
const chromeTraceEventPhase = z.enum([
  'B',
  'E',
  'X', // duration + complete
  'I',
  'i', // instants
  'C', // counters
  'b',
  'e',
  'n', // async
  's',
  't',
  'f', // flows
  'M', // <-- metadata (process_name, thread_name)
  // (Optional extras some exporters use)
  'N',
  'O',
  'P',
  'D',
  'S',
  'T',
  'R',
  'F',
  'v',
  'd'
]);

const IdLike = z.union([z.string(), z.number()]);
const Id2Schema = z
  .object({
    local: IdLike.optional(),
    global: IdLike.optional()
  })
  .partial();

// A single trace event
const chromeTraceEventSchema = z
  .object({
    name: z.string(),
    ph: chromeTraceEventPhase,
    ts: z.number().optional(), // timestamp (µs)
    pid: z.union([z.number(), z.string()]), // process id
    tid: z.union([z.number(), z.string()]), // thread id
    cat: z.string().optional(), // category
    dur: z.number().optional(), // duration (for "X" complete events)
    tdur: z.number().optional(), // thread-local duration
    tts: z.number().optional(), // thread-local timestamp
    id: IdLike.optional(), // async event id
    bind_id: IdLike.optional(),
    id2: Id2Schema.optional(),
    s: z.enum(['g', 'p', 't']).optional(), // async scope (global/process/thread)
    scope: z.enum(['g', 'p', 't']).optional(), // flow event scope
    args: z.record(z.string(), z.any()).optional() // arbitrary payload
    // any other fields (e.g. 'bind_id', 'stack', 'bp', 'durEnd', etc.)
  })
  // Uunknown keys don’t cause errors.
  .passthrough();

// The top‐level trace file
export const ChromechromeTraceFileSchema = z
  .object({
    traceEvents: z.array(chromeTraceEventSchema),
    displayTimeUnit: z.string().optional(),
    systemchromeTraceEvents: z.any().optional(),
    metadata: z.record(z.string(), z.any()).optional()
    // you can add other top-level keys here if you need them
  })
  // Unknown top-level keys don’t cause errors.
  .passthrough();

/** Type for the entire contents of a Chrome trace file */
export type ChromeTraceFileSchema = z.infer<typeof ChromechromeTraceFileSchema>;
export type ChromeTraceEventPhase = z.infer<typeof chromeTraceEventPhase>;
export type ChromeTraceEventSchema = z.infer<typeof chromeTraceEventSchema>;
export type ChromeTraceValidationOptions = {
  maxLength?: number;
};

const DEFAULT_MAX_LENGTH = 1000;

/** Checks if a parsed JSON file might be a Chrome Trace file */
export function maybeChromeTraceFile(data: unknown): data is ChromeTraceFileSchema {
  return (data as ChromeTraceFileSchema).traceEvents !== undefined;
}

export function validateChromeTraceFile(
  pathData: unknown,
  options: ChromeTraceValidationOptions = {}
): ChromeTraceFileSchema {
  const {maxLength = DEFAULT_MAX_LENGTH} = options;
  try {
    if (!pathData || typeof pathData !== 'object') {
      return ChromechromeTraceFileSchema.parse(pathData);
    }

    const traceEvents = (pathData as {traceEvents?: unknown}).traceEvents;
    const slicedTraceEvents = Array.isArray(traceEvents)
      ? traceEvents.slice(0, maxLength)
      : traceEvents;

    ChromechromeTraceFileSchema.parse({
      ...(pathData as Record<string, unknown>),
      traceEvents: slicedTraceEvents
    });

    return pathData as ChromeTraceFileSchema;
  } catch (e) {
    if (e instanceof ZodError) {
      const message = e.issues.map(issue => `${issue.message}: ${issue.path.join('.')}`).join('\n');
      throw new Error(message);
    }
    throw e;
  }
}
