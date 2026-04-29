import {
  getRecognizedUrlParameterKeys,
  parseUrlParametersIntoState,
  serializeUrlParameters,
  serializeUrlSearchParams
} from './url-parameters';

import type {
  ParseUrlParametersIntoStateOptions,
  RawUrlParametersInput,
  URLParameter,
  URLParameterValue
} from './url-parameters';

/**
 * Options for creating URL search params from a state snapshot.
 */
export type URLManagerCreateSearchParamsOptions = {
  /** Existing params to start from before canonical parameters are written. */
  baseParams?: string | URLSearchParams;
  /** Preserve unknown parameters from `baseParams`. Defaults to false. */
  preserveUnknownParams?: boolean;
};

/**
 * Deck-independent helper for descriptor-based deep-link URL parsing and serialization.
 */
export class URLManager<TState = unknown> {
  /** URL parameter descriptors managed by this instance. */
  readonly parameters: readonly URLParameter<TState>[];

  /**
   * Creates a URL manager for one descriptor list.
   */
  constructor(parameters: readonly URLParameter<TState>[] = []) {
    this.parameters = parameters;
  }

  /**
   * Returns canonical and legacy query parameter names recognized by this manager.
   */
  getRecognizedKeys(): readonly string[] {
    return getRecognizedUrlParameterKeys(this.parameters);
  }

  /**
   * Parses query values into `state` using canonical names before legacy aliases.
   */
  parseIntoState(
    state: TState,
    paramsOrSearch: RawUrlParametersInput,
    options?: ParseUrlParametersIntoStateOptions
  ): Record<string, URLParameterValue> {
    return parseUrlParametersIntoState(state, this.parameters, paramsOrSearch, options);
  }

  /**
   * Serializes `state` into a canonical parameter map.
   */
  serialize(state: TState): Record<string, string | readonly string[]> {
    return serializeUrlParameters(state, this.parameters);
  }

  /**
   * Creates URLSearchParams from `state`, optionally preserving unknown base params.
   */
  createSearchParams(
    state: TState,
    options: URLManagerCreateSearchParamsOptions = {}
  ): URLSearchParams {
    const searchParams = createBaseSearchParams(options);
    const recognizedKeys = new Set(this.getRecognizedKeys());

    if (!options.preserveUnknownParams) {
      for (const key of Array.from(searchParams.keys())) {
        searchParams.delete(key);
      }
    } else {
      for (const key of recognizedKeys) {
        searchParams.delete(key);
      }
    }

    const serialized = this.serialize(state);
    for (const [name, value] of Object.entries(serialized)) {
      if (typeof value === 'string') {
        searchParams.set(name, value);
      } else {
        for (const item of value) {
          searchParams.append(name, item);
        }
      }
    }

    return searchParams;
  }

  /**
   * Serializes `state` into a URL query string without a leading question mark.
   */
  serializeSearchParams(state: TState, options: URLManagerCreateSearchParamsOptions = {}): string {
    return serializeUrlSearchParams(this.createSearchParams(state, options));
  }
}

function createBaseSearchParams({
  baseParams
}: URLManagerCreateSearchParamsOptions): URLSearchParams {
  if (!baseParams) {
    return new URLSearchParams();
  }
  if (typeof baseParams === 'string') {
    return new URLSearchParams(baseParams.startsWith('?') ? baseParams.slice(1) : baseParams);
  }
  return new URLSearchParams(baseParams);
}
