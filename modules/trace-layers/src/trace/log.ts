import {Log} from '@probe.gl/log';

export class HeapLog extends Log {
  /** Adds browser heap usage fields to every timing probe emitted by Tracevis. */
  override probe(logLevel: unknown, message?: unknown, ...args: unknown[]): () => void {
    return super.probe(logLevel, message, ...appendHeapUsageProbeFields(args));
  }
  snapshotHeapUsage() {
    snapshotHeapUsage();
  }
  logHeapUsage(logLevel: number, message: string, ...params: unknown[]) {
    logHeapUsage(logLevel, message, params);
  }
  makeModestObject(input: unknown): unknown {
    return makeModestObject(input);
  }
}

/** A log object for more sophisticated logging and profiling */
export const log = new HeapLog({id: 'trace-layers'});
// Keep library probes opt-in so consumers and tests do not emit console noise by default.
log.setLevel(-1);

globalThis.traceLayers ||= {log}; // Make it available globally for debugging

/**
 * Returns the current browser heap usage in a probe-friendly shape when supported.
 */
export function getHeapUsageProbeFields(): {usedJSHeapSize?: number; usedJSHeapSizeMB?: number} {
  const usedJSHeapSize = getUsedHeapBytes();
  if (usedJSHeapSize === undefined) {
    return {};
  }
  return {
    usedJSHeapSize,
    usedJSHeapSizeMB: bytesToMegabytes(usedJSHeapSize)
  };
}

/** @todo Move to probe.gl */
let lastHeapUsage = getUsedHeapBytes();

/** @todo Move to probe.gl */
function logHeapUsage(logLevel: number, message: string, ...params: unknown[]): void {
  const heapAfter = getUsedHeapBytes();
  if (lastHeapUsage === undefined || heapAfter === undefined) {
    return;
  }
  const delta = heapAfter - lastHeapUsage;
  lastHeapUsage = heapAfter;

  const percent = heapAfter / 2 ** 32;
  const color = percent > 0.7 ? 'red' : percent > 0.4 ? 'orange' : 'green';
  const style = `background:${color};color:#e0a5fa;font-weight:700;padding:2px 8px;border-radius:6px;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;letter-spacing:0.3px;`;
  const restoreStyle = '';

  log.log(
    logLevel,
    `%cHEAP ${formatBytes(heapAfter)} (delta ${formatBytes(delta)})%c ${message}`,
    style,
    restoreStyle,
    delta,
    ...params
  )();
}

function snapshotHeapUsage(): void {
  lastHeapUsage = getUsedHeapBytes();
  log.log(0, `Snapshot heap usage: ${lastHeapUsage}`)();
}

/** @todo Move to probe.gl */
function getUsedHeapBytes(): number | undefined {
  if (typeof performance === 'undefined') {
    return undefined;
  }

  const memory = (performance as Performance & {memory?: {usedJSHeapSize?: number}}).memory;
  if (!memory || typeof memory.usedJSHeapSize !== 'number') {
    return undefined;
  }

  return memory.usedJSHeapSize;
}

/** Appends heap counters to a probe argument list without mutating caller-owned payloads. */
function appendHeapUsageProbeFields(args: unknown[]): unknown[] {
  const fields = getHeapUsageProbeFields();
  if (fields.usedJSHeapSizeMB === undefined) {
    return args;
  }

  const lastArg = args.at(-1);
  if (isPlainObject(lastArg)) {
    return [...args.slice(0, -1), {...lastArg, ...fields}];
  }

  return [...args, fields];
}

/** Returns true for ordinary object payloads that are safe to shallow-copy into probe logs. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Converts a raw byte count to a one-decimal megabyte value for compact probe payloads. */
function bytesToMegabytes(bytes: number): number {
  return Number((bytes / 2 ** 20).toFixed(1));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return `${bytes}`;
  }
  const sign = Math.sign(bytes);
  const absBytes = Math.abs(bytes);

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = absBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  value *= sign;

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

const TRUNC_FLAG = '__truncated_by_probe_gl__' as const;

/**
 * Recursively truncates strings, arrays and objects to make them more modest for logging,
 * to avoid the console log retaining big memory objects
 * */
export function makeModestObject(input: unknown): unknown {
  function walk(v: unknown): {value: unknown; changed: boolean} {
    // string
    if (typeof v === 'string') {
      if (v.length > 2000) {
        return {value: v.slice(0, 2000) + '…', changed: true};
      }
      return {value: v, changed: false};
    }

    // primitive
    if (v == null || typeof v !== 'object') {
      return {value: v, changed: false};
    }

    // array
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.slice(0, 10).map((x: unknown) => {
        const r = walk(x);
        changed ||= r.changed;
        return r.value;
      });

      if (v.length > 10) {
        out.push({__omitted: v.length - 10});
        changed = true;
      }

      if (changed) {
        const outObject = out as unknown as {[TRUNC_FLAG]?: boolean};
        outObject[TRUNC_FLAG] = true;
      }
      return {value: out, changed};
    }

    // object
    const keys = Object.keys(v);
    let changed = false;
    const out: Record<string, unknown> = {};

    for (const k of keys.slice(0, 10)) {
      const vObject = v as {[key: string]: unknown};
      const r = walk(vObject[k]);
      out[k] = r.value;
      changed ||= r.changed;
    }

    if (keys.length > 10) {
      out.__omitted_keys = keys.length - 10;
      changed = true;
    }

    if (changed) out[TRUNC_FLAG] = true;
    return {value: out, changed};
  }

  const r = walk(input);

  if (r.changed && (r.value == null || typeof r.value !== 'object')) {
    return {value: r.value, [TRUNC_FLAG]: true};
  }

  return r.value;
}
