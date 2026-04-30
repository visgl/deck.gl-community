/**
 * URL query value passed into descriptor deserializers.
 */
export type URLParameterValue = string | readonly string[] | null;

/**
 * Describes a persisted deep-link URL parameter and how to map between state and URL shape.
 */
export type URLParameter<TState = unknown> = {
  /** Canonical query parameter name for deep links. */
  name: string;
  /** Human-readable explanation shown in URL parameter docs panels. */
  description: string;
  /** Legacy alias names accepted as read-only inputs for this canonical key. */
  legacyNames?: readonly string[];
  /**
   * Serializes the app state for a deep-link URL query value.
   * Return a string for scalar parameters, an array for multi-value parameters,
   * or undefined when not emitted.
   */
  serialize(state: TState): string | readonly string[] | undefined;
  /**
   * Deserializes a deep-link value into mutable state.
   * Callers provide values from canonical keys first, then legacy keys in
   * descriptor order.
   */
  deserialize(value: URLParameterValue, state: TState): void;
};

/**
 * Raw URL-like values accepted by URL parameter parsing helpers.
 */
export type RawUrlParametersInput =
  | string
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | null | undefined>>;

type ParsedUrlValues = Record<string, readonly string[]>;

/**
 * Options for parsing URL parameter descriptors.
 */
export type ParseUrlParametersIntoStateOptions = {
  /** Optional callback while parsing each resolved parameter. */
  onParsedParameter?: (name: string, value: URLParameterValue, usedKey: string) => void;
};

/**
 * Canonical and legacy query parameter names recognized by a URL parameter descriptor list.
 */
export function getRecognizedUrlParameterKeys(
  parameters: readonly URLParameter[]
): readonly string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const parameter of parameters) {
    if (!seen.has(parameter.name)) {
      seen.add(parameter.name);
      keys.push(parameter.name);
    }

    for (const legacyName of parameter.legacyNames ?? []) {
      if (!seen.has(legacyName)) {
        seen.add(legacyName);
        keys.push(legacyName);
      }
    }
  }

  return keys;
}

/**
 * Serializes a URL-parameter descriptor list into a canonical map suitable for URL writes.
 */
export function serializeUrlParameters<TState>(
  state: TState,
  parameters: readonly URLParameter<TState>[]
): Record<string, string | readonly string[]> {
  const params: Record<string, string | readonly string[]> = {};
  for (const parameter of parameters) {
    const value = parameter.serialize(state);
    if (value === undefined) {
      continue;
    }
    params[parameter.name] = value;
  }
  return params;
}

/**
 * Serializes URL search params while preserving short-form bare keys for empty values.
 */
export function serializeUrlSearchParams(searchParams: URLSearchParams): string {
  return searchParams.toString().replace(/=(&|$)/g, '$1');
}

/**
 * Parses a search string or parsed map into state using canonical/legacy descriptor rules.
 *
 * Returns the resolved canonical value for each descriptor that had a key in the input.
 * Canonical keys take precedence; legacy keys are tried in the descriptor order they are declared.
 */
export function parseUrlParametersIntoState<TState>(
  state: TState,
  parameters: readonly URLParameter<TState>[],
  paramsOrSearch: RawUrlParametersInput,
  options?: ParseUrlParametersIntoStateOptions
): Record<string, URLParameterValue> {
  const values = buildRawUrlValues(paramsOrSearch);
  const parsed: Record<string, URLParameterValue> = {};

  for (const parameter of parameters) {
    let usedKey = parameter.name;
    let value = resolveUrlValue(values, parameter.name);

    if (value === undefined) {
      for (const legacyName of parameter.legacyNames ?? []) {
        value = resolveUrlValue(values, legacyName);
        if (value !== undefined) {
          usedKey = legacyName;
          break;
        }
      }
    }

    if (value === undefined) {
      continue;
    }

    parameter.deserialize(value, state);
    parsed[parameter.name] = value;
    options?.onParsedParameter?.(parameter.name, value, usedKey);
  }

  return parsed;
}

/**
 * Normalizes `paramsOrSearch` into canonical-name value buckets from URL inputs.
 */
function buildRawUrlValues(paramsOrSearch: RawUrlParametersInput): ParsedUrlValues {
  const values: ParsedUrlValues = {};

  if (typeof paramsOrSearch === 'string') {
    const query = new URLSearchParams(
      paramsOrSearch.startsWith('?') ? paramsOrSearch.slice(1) : paramsOrSearch
    );
    for (const [name, value] of query.entries()) {
      const existing = values[name];
      values[name] = existing === undefined ? [value] : [...existing, value];
    }
    return values;
  }

  if (paramsOrSearch instanceof URLSearchParams) {
    for (const [name, value] of paramsOrSearch.entries()) {
      const existing = values[name];
      values[name] = existing === undefined ? [value] : [...existing, value];
    }
    return values;
  }

  for (const [name, rawValue] of Object.entries(paramsOrSearch)) {
    if (rawValue == null) {
      continue;
    }
    const normalizedValue = Array.isArray(rawValue)
      ? rawValue
      : ([String(rawValue)] as readonly string[]);
    values[name] = [...normalizedValue];
  }

  return values;
}

function resolveUrlValue(values: ParsedUrlValues, key: string): URLParameterValue | undefined {
  const value = values[key];
  if (value === undefined) {
    return undefined;
  }
  if (value.length === 1) {
    return value[0] ?? '';
  }
  return value;
}
