/**
 * Represents the structure of a Chrome Trace.
 * Traces contain processes that contains threads.
 * Threads contain spans, instant events, counters, and flows.
 */
export type ChromeTrace = {
  /** List of processes in the trace. */
  processes: ChromeTraceProcess[];
  /** Optional metadata associated with the trace. */
  metadata?: Record<string, unknown>;
};

/**
 * Represents a process in a Chrome Trace.
 * - Abstractly, a process is a group of threads that share resources and enjoy efficient inter-thread communication.
 */
export type ChromeTraceProcess = {
  /** Unique identifier for the process. */
  id: string;
  /** Label for the process (e.g., "RendererMain (Browser)"). */
  label: string;
  /** Optional category for the process. */
  category?: string;
  /** Optional RGBA color for the process. */
  color?: [number, number, number, number];
  /** List of threads associated with the process. */
  threads: ChromeTraceThread[];
};

/**
 * Represents a thread in a Chrome Trace.
 * - All events take place on a thread
 */
export type ChromeTraceThread = {
  /** Unique identifier for the thread (e.g., "123:456" or "async:<key>"). */
  id: string;
  /** Process ID to which the thread belongs. */
  pid: string;
  /** Thread ID within the process. */
  tid: string;
  /** Label for the thread (e.g., "RendererMain (Browser)"). */
  label: string;
  /** Optional category for the thread. */
  category?: string;
  /** Optional RGBA color for the thread. */
  color?: [number, number, number, number];
  /** List of spans associated with the thread. */
  spans: ChromeTraceSpan[];
  /** List of instant events associated with the thread. */
  instants: ChromeTraceInstant[];
  /** List of counters associated with the thread. */
  counters: ChromeTraceCounter[];
  /** List of flows associated with the thread. */
  flows: ChromeTraceFlow[];
};

/**
 * Represents a span in a Chrome Trace.
 * - Definition: Often referred to as Duration events, spans represent events with a clear beginning and end—i.e., something that occupies a span of time.
 * - Description: These record intervals (start to finish) of operations, such as function calls, rendering phases, or network syncs.
 * - Typical Use Case: Measuring how long operations take—e.g., "event processing took 10 ms".
 * - Terminology Note: While the Chrome trace format uses ph: "B" (begin) and ph: "E" (end) characters to denote start and end points, many tooling concepts refer to those as “duration” or “spans.” The Chrome-based Rust crate trace_events even groups these under duration, analogous to spans
 */
export type ChromeTraceSpan = {
  /** Unique identifier for the span. */
  spanId: string;
  /** Identifier for the track associated with the span. */
  trackId: string;
  /** Name of the span. */
  name: string;
  /** Start time of the span in milliseconds. */
  startTimeMs: number;
  /** End time of the span in milliseconds. */
  endTimeMs: number;
  /** Optional RGBA color for the span. */
  color?: [number, number, number, number];
  /** Optional user-defined data associated with the span. */
  userData?: Record<string, unknown>;
};

/**
 * Represents an instant event in a Chrome Trace.
 * - Definition: Instants represent discrete points in time with no duration.
 * - Description: They mark a single timestamp along the timeline, often used for logging key events like marks or checkpoints at a specific moment.
 * - Typical Use Case: Logging that something occurred at that moment—like a marker for "frame rendered" or "user input received".
 * - Implementation Insight: In trace frameworks, these are known simply as “Instant event” and are captured with a timestamp plus optional metadata (like a name or category)
 */
export type ChromeTraceInstant = {
  /** Unique identifier for the instant event. */
  id: string;
  /** Identifier for the track associated with the instant event. */
  trackId: string;
  /** Name of the instant event. */
  name: string;
  /** Time of the instant event in milliseconds. */
  atMs: number;
  /** Scope of the instant event ('g' for global, 'p' for process, 't' for thread). */
  scope: 'g' | 'p' | 't';
  /** Optional RGBA color for the instant event. */
  color?: [number, number, number, number];
  /** Optional user-defined data associated with the instant event. */
  userData?: Record<string, unknown>;
};

/**
 * Represents a counter in a Chrome Trace.
 * - Definition: Counters log numeric metrics over time—point samples that track changing values.
 * - Description: These can be integers or floats and are typically visualized as charts (often as line graphs or area charts) showing value progression.
 * - Typical Use Case: Recording memory usage, CPU load, frame rate, or any time-varying metric.
 * - Implementation Insight: In Chrome tracing, counters are emitted via macros like TRACE_COUNTER and annotated with category and units
 */
export type ChromeTraceCounter = {
  /** Unique identifier for the counter. */
  id: string;
  /** Identifier for the track associated with the counter. */
  trackId: string;
  /** Name of the counter. */
  name: string;
  /** Time of the counter in milliseconds. */
  atMs: number;
  /** Series of values for the counter. */
  series: Record<string, number>;
  /** Optional RGBA color for the counter. */
  color?: [number, number, number, number];
  /** Optional user-defined data associated with the counter. */
  userData?: Record<string, unknown>;
};

/**
 * Represents a flow in a Chrome Trace.
 * - Definition: Flows link together events (instants or spans) across threads or time to indicate a logical relationship or continuation.
 * - Description: They are visualized as arrows or connectors in trace viewers, showing the relationship or handoff between events across threads or time boundaries.
 * - Typical Use Case: Tracking a request or message as it starts on one thread and continues on another, or flows through asynchronous phases.
 * - Implementation Insight: In Chrome Traces, flow events use specific phases like ph: "s" (start), ph: "t" (step), and ph: "f" (end/follow) along with an id that ties them together
 */
export type ChromeTraceFlow = {
  /** Unique identifier for the flow. */
  id: string;
  /** Identifier for the binding associated with the flow. */
  bindId: string;
  /** Kind of the flow ('start', 'step', or 'end'). */
  kind: 'start' | 'step' | 'end';
  /** Event key associated with the flow. */
  eventKey: string;
  /** Optional identifier for the track associated with the flow. */
  trackId?: string;
  /** Time of the flow in milliseconds. */
  atMs: number;
  /** Optional name of the flow. */
  name?: string;
  /** Optional user-defined data associated with the flow. */
  userData?: Record<string, unknown>;
};
