import * as arrow from 'apache-arrow';

/** Options used when materializing Apache Arrow table rows as JSON objects. */
export interface TableToJSONOptions {
  /** If true, don't convert bigint values to number (may lose precision). Default: false */
  preserveBigInts?: boolean;
}

/**
 * Convert an Arrow Table to an array of plain JSON row objects
 * with optional bigint→number coercion.
 */
export function arrowTableToJSON<T extends Record<string, unknown> = Record<string, unknown>>(
  table: arrow.Table,
  options: TableToJSONOptions = {}
): T[] {
  const result: T[] = [];

  for (let i = 0; i < table.numRows; i++) {
    const arrowRow = table.get(i)!;
    const rowObj = materializeToJSON(arrowRow, options) as T;
    result.push(rowObj);
  }
  return result;
}

/**
 * Recursively walks a value. If it encounters an object with a `toJSON()` method,
 * it calls it, then continues walking the returned value.
 *
 * - Non-objects are returned as-is.
 * - Arrays are mapped element-wise.
 * - Plain objects are shallow-copied with values recursively processed.
 * - Cycles are handled via a WeakSet; if a cycle is detected, the original object
 *   is returned to avoid infinite recursion.
 */
export function materializeToJSON(
  value: unknown,
  options: TableToJSONOptions,
  _seen?: WeakSet<object>
): unknown {
  if (value == null) return value; // null / undefined
  const t = typeof value;

  if (!options.preserveBigInts && t === 'bigint') {
    return Number(value);
  }

  if (t !== 'object') return value; // string/number/bigint/boolean/symbol/function

  const seen = _seen ?? new WeakSet<object>();
  const obj = value as Record<string, unknown>;

  // Cycle guard
  if (seen.has(obj)) return obj;
  seen.add(obj);

  // If the object itself exposes toJSON(), prefer that first
  const maybeToJSON = (obj as any)?.toJSON;
  if (typeof maybeToJSON === 'function') {
    try {
      const next = maybeToJSON.call(obj);
      return materializeToJSON(next, options, seen);
    } catch {
      // If toJSON throws, fall through and attempt structural walk
    }
  }

  // Arrays
  if (Array.isArray(obj)) {
    const out = new Array(obj.length);
    for (let i = 0; i < obj.length; i++) {
      out[i] = materializeToJSON(obj[i], options, seen);
    }
    return out;
  }

  // Plain objects
  if (isPlainObject(obj)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = materializeToJSON(v, options, seen);
    }
    return out;
  }

  // Non-plain objects without toJSON (e.g., Map/Set/TypedArray/Date subclasses)
  // Return as-is; callers can add special cases if needed.
  return obj;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (Object.prototype.toString.call(x) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}
