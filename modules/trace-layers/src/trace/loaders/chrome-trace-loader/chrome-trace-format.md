# Chrome Trace Format

This document explains how the Chrome trace format maps into `trace-graph`'s Chrome trace parser helpers, with a focus on why the format is optimized for streaming writes during tracing and what assembly is required before visualization, especially for spans (duration events) and dependencies (flows).

## Overview

A Chrome trace is a sequence of events emitted while the system runs. Producers (browsers, apps, services) append events continuously, often from multiple threads/processes. The format is deliberately append-friendly:

- Each event is a small JSON object that can be written as soon as it occurs (no need to hold global state).
- Event streams from many threads/processes can be merged later.
- Duration and dependency semantics are encoded across multiple records (e.g., “begin” and “end” events), so no single record needs to carry the full picture.

Implication for visualization: The raw stream is not directly “timeline-ready.” Events must be assembled (paired, stitched, grouped) into higher-level structures:

- Spans (durations): pair B (begin) with E (end), and convert X (complete) into spans.
- Flows (dependencies): connect s (start), t (step), f (end) using a shared flow id.
- Counters & instants: can be consumed directly (after normalization).

`parseChromeTrace(...)` and the Chrome trace Arrow helpers parse the raw JSON and provide normalized events or Arrow tables; most UIs still perform a final assembly step to create timeline bars and dependency links.

## File Structure & Units

A trace file typically looks like:

```json
{
  "traceEvents": [
    {
      "ph": "B",
      "name": "Task",
      "pid": 1,
      "tid": 11,
      "ts": 123456789,
      "cat": "scheduler",
      "args": { "detail": "…" }
    },
    { "ph": "E", "name": "Task", "pid": 1, "tid": 11, "ts": 123457789 },
    { "ph": "i", "name": "Mark", "pid": 1, "tid": 11, "ts": 123456900, "s": "t" },
    { "ph": "C", "name": "CPU", "pid": 1, "tid": 11, "ts": 123456950, "args": { "value": 42 } },
    {
      "ph": "s",
      "name": "Flow",
      "pid": 1,
      "tid": 11,
      "ts": 123456960,
      "id": "abc",
      "args": { "bind_id": "abc" }
    },
    {
      "ph": "f",
      "name": "Flow",
      "pid": 2,
      "tid": 7,
      "ts": 123457100,
      "id": "abc",
      "args": { "bind_id": "abc" }
    }
  ],
  "metadata": { "source": "…" }
}
```

Time units: ts and dur are in microseconds (µs). Many UIs convert to milliseconds for display.

Event Phases (what you’ll see)
| Phase (ph) | Meaning | Assembly Needed |
|------------|-----------------------------|--------------------------|
| B | Begin duration | ✅ Pair with E |
| E | End duration | ✅ Pair with B |
| X | Complete duration (ts + dur)| ✅ Convert to span |
| i | Instant | ❌ (normalize only) |
| C | Counter (time-series sample)| ❌ (normalize only) |
| s | Flow start | ✅ Link s→t→f |
| t | Flow step | ✅ Link s→t→f |
| f | Flow end | ✅ Link s→t→f |

There are additional phases (object events, async events, etc.), but the above are the most common for timelines and dependencies.

Why the Format Is Streaming-Optimized

No global coordination required at write-time. A B event can be written immediately at the start, and the E event is written when the work completes—potentially far later, on another thread, or in another process.

Producer-friendly buffering. Writers can flush events frequently (or line-by-line) without needing to rewrite prior data.

Resilient to truncation. If tracing stops abruptly, you may have unmatched B events or unfinished flows, but the file is still readable.

Trade-off: Readers must assemble related events to restore durations and dependencies.

## Assembly Requirements

### Spans (durations)

There are two encodings:

- B/E pair:

  - B at start time ts_b
  - E at end time ts_e
  - Span = [ts_b, ts_e]

- X (complete):
  - One record with ts and dur
  - Span = [ts, ts + dur]

#### Algorithm (per pid:tid):

- Maintain a stack.
- On B: push {name, ts, cat, args}.
- On E: pop the latest open B and emit a span [ts_B, ts_E].
- On X: emit a span [ts, ts + dur] directly.
- If the trace is truncated, you may have unclosed Bs; decide whether to drop or mark incomplete.

#### Nesting & Overlaps:

Stacks allow multiple, nested Bs (including same-name). Do not key only by name.

### Flows (dependencies)

Flows connect logically related events across time, threads, or processes. They are emitted as:

- `s` — flow start
- `t` — optional intermediate step(s)
- `f` — flow end

These are linked by a shared flow identifier (commonly id and/or args.bind_id). In practice, UIs use the id/bind-id to draw arrows from producer to consumer.

#### Algorithm:

Group by flowId = event.id ?? event.args?.bind_id.

Sort by timestamp per flowId.

Build edges: s → t1 → t2 → … → f.

Each edge becomes a visual arrow from the earlier event to the later event (possibly crossing threads/processes).

### Instants & Counters

Instants (i): normalize timestamps; map scope (g|p|t) if present. No pairing.

Counters (C): each record is a sample; args carries series values (e.g., {"value": 42, "rss": 1234}). Build a timeseries per (pid, tid, name).

Example: Streaming Chunks → Assembled Timeline

Producer writes (in time order, possibly interleaved):

```ts
{"ph":"B","name":"Render","pid":1,"tid":11,"ts":1000}
{"ph":"i","name":"Input","pid":1,"tid":11,"ts":1200,"s":"t"}
{"ph":"t","name":"Flow","pid":1,"tid":11,"ts":1300,"id":"req-9"}
{"ph":"E","name":"Render","pid":1,"tid":11,"ts":2000}
{"ph":"f","name":"Flow","pid":1,"tid":13,"ts":2100,"id":"req-9"}
{"ph":"X","name":"Composite","pid":1,"tid":13,"ts":2200,"dur":500}
```

Visualization-ready after assembly:

- Span: Render on 1:11 → [1000, 2000]
- Instant: Input on 1:11 @ 1200
- Flow: req-9 arrow(s) from 1:11@1300 to 1:13@2100
- Span: Composite on 1:13 → [2200, 2700]

### Assembly Sketch (TypeScript)

```ts
type Begin = { name: string; ts: number; cat?: string; args?: any };
type Span = {
  name: string;
  start: number;
  end: number;
  pid: number;
  tid: number;
  cat?: string;
  args?: any;
};
type FlowEdge = {
  id: string;
  from: { pid: number; tid: number; ts: number };
  to: { pid: number; tid: number; ts: number };
};

function assemble(traceEvents: any[]) {
  // group by thread
  const byThread = new Map<string, any[]>();
  for (const e of traceEvents) {
    const key = `${e.pid}:${e.tid}`;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key)!.push(e);
  }

  // sort within threads (defensive)
  for (const list of byThread.values()) list.sort((a, b) => a.ts - b.ts);

  const spans: Span[] = [];
  const flows: FlowEdge[] = [];

  // 1) spans
  for (const [key, events] of byThread) {
    const [pid, tid] = key.split(':').map(Number);
    const stack: Begin[] = [];
    for (const e of events) {
      switch (e.ph) {
        case 'B':
          stack.push({ name: e.name, ts: e.ts, cat: e.cat, args: e.args });
          break;
        case 'E': {
          const b = stack.pop();
          if (b)
            spans.push({
              name: b.name,
              start: b.ts,
              end: e.ts,
              pid,
              tid,
              cat: b.cat,
              args: b.args,
            });
          break;
        }
        case 'X':
          if (typeof e.dur === 'number') {
            spans.push({
              name: e.name,
              start: e.ts,
              end: e.ts + e.dur,
              pid,
              tid,
              cat: e.cat,
              args: e.args,
            });
          }
          break;
      }
    }
    // leftover B's are unclosed: drop or mark incomplete per policy
  }

  // 2) flows
  const flowBuckets = new Map<string, any[]>();
  for (const e of traceEvents) {
    if (e.ph === 's' || e.ph === 't' || e.ph === 'f') {
      const id = e.id ?? e.args?.bind_id;
      if (!id) continue;
      if (!flowBuckets.has(id)) flowBuckets.set(id, []);
      flowBuckets.get(id)!.push(e);
    }
  }
  for (const [id, list] of flowBuckets) {
    list.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i],
        b = list[i + 1];
      flows.push({
        id: String(id),
        from: { pid: a.pid, tid: a.tid, ts: a.ts },
        to: { pid: b.pid, tid: b.tid, ts: b.ts },
      });
    }
  }

  return { spans, flows };
}
```

Convert ts/dur from µs to ms for UI display if needed.

### Handling Truncation & Incompletes

Because the format is streaming:

You may see unmatched B (no E) if tracing stopped. Options:

Drop them (recommended for accuracy), or

Emit with end = start and mark as incomplete (if your UI supports it).

You may see flows without f or only an f (unmatched). Safest approach is to only draw edges between consecutive observed steps.

### Performance Tips

One pass per thread, stack-based pairing is O(N) and cache-friendly.

Avoid name-based matching; use a real stack to handle nesting and same-name spans.

Chunked loading: when reading very large traces, assemble per chunk but keep per-thread stack state between chunks to support long-lived spans.

Flow buffers: keep a bounded map of recent flow IDs; if memory is tight, purge long-idle flows (at the cost of losing very long edges).

### Best Practices & Gotchas

Prefer X for short operations on the producer side—it’s cheaper to write and cheaper to assemble.

Use stable flow IDs (id or args.bind_id) across threads if you want cross-thread arrows.

Do not assume E has dur; it usually does not. X is the form that carries dur.

Sort defensively before assembly:\*\* some producers flush slightly out-of-order records.

Normalize categories & colors at read-time if your UI uses palettes.

Output Shapes (suggested)

For visualization layers (deck.gl, etc.), it’s convenient to produce:

```ts
type TimelineSpan = {
  pid: number;
  tid: number;
  name: string;
  startMs: number; // ts / 1000
  endMs: number; // tsEnd / 1000
  cat?: string;
  color?: [number, number, number, number];
  data?: Record<string, unknown>;
};

type FlowEdge = {
  id: string;
  from: { pid: number; tid: number; atMs: number };
  to: { pid: number; tid: number; atMs: number };
  data?: Record<string, unknown>;
};
```

These feed nicely into bar/arc layers or custom timeline components.

### Validation

If you maintain a schema layer (e.g., zod/TS types), validate shape only; do not try to enforce pairing at parse-time. Keep assembly separate so you can run it incrementally and tolerate partial streams.

## Summary

- The Chrome trace format is write-optimized for streaming: producers emit small, append-only records with minimal coordination.
- For visualization, you must assemble:
  - Spans by pairing B/E and converting X,
  - Flows by chaining s/t/f via a shared ID,
  - Normalize instants and counters.
  - Handle truncation, out-of-order events, and nesting robustly.

The Chrome trace parser helpers give you the raw events; perform the assembly step to build clean, accurate timelines and dependency graphs.
