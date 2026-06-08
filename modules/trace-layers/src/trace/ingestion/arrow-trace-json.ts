const RAW_BIGINT_TOKEN_PREFIX = '__trace_graph_arrow_bigint__:';
const RAW_BIGINT_TOKEN_PATTERN = new RegExp(`^${RAW_BIGINT_TOKEN_PREFIX}(-?\\d+)$`);

/**
 * Serialize a trace-graph payload into JSON while preserving bigint values as tagged strings.
 */
export function serializeArrowTraceJson(value: unknown): string {
  return JSON.stringify(toJsonSafeValue(value));
}

/**
 * Deserialize a trace-graph payload written by {@link serializeArrowTraceJson}.
 */
export function deserializeArrowTraceJson<T>(value: string | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }
  return restoreJsonSafeValue(JSON.parse(value)) as T;
}

function toJsonSafeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return `${RAW_BIGINT_TOKEN_PREFIX}${value.toString()}`;
  }
  if (Array.isArray(value)) {
    return value.map(entry => toJsonSafeValue(entry));
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, entryValue]) => [String(key), toJsonSafeValue(entryValue)])
    );
  }
  if (value instanceof Set) {
    return Array.from(value, entry => toJsonSafeValue(entry));
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return value;
    }
    return Array.from(value as unknown as Iterable<unknown>, entry => toJsonSafeValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        toJsonSafeValue(entryValue)
      ])
    );
  }
  return value;
}

function restoreJsonSafeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const bigintMatch = value.match(RAW_BIGINT_TOKEN_PATTERN);
    return bigintMatch ? BigInt(bigintMatch[1]!) : value;
  }
  if (Array.isArray(value)) {
    return value.map(entry => restoreJsonSafeValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        restoreJsonSafeValue(entryValue)
      ])
    );
  }
  return value;
}
