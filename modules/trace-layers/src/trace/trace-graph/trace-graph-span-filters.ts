import {
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE
} from './trace-graph-types';

import type {TraceSpanFilterMask} from './trace-graph-types';

const SPAN_FILTER_SEPARATORS = /[,;\r\n]+/;

/** Stores compiled matchers for one normalized span-filter list. */
export type CompiledTraceSpanFilterPlan = {
  /** Cheap literal-prefix matchers applied before regex checks. */
  literalPrefixes: readonly string[];
  /** Explicit `/.../` regex matchers kept for advanced filters. */
  regexMatchers: readonly RegExp[];
};

/**
 * Normalizes raw span-filter input into one stable, trimmed list of filter strings.
 */
export function normalizeTraceSpanFilters(
  spanFilters: readonly string[] | undefined
): readonly string[] {
  return (spanFilters ?? [])
    .flatMap(spanFilter => spanFilter.split(SPAN_FILTER_SEPARATORS))
    .map(candidate => candidate.trim())
    .filter(Boolean)
    .map(candidate => candidate);
}

/**
 * Compiles normalized span filters into literal-prefix and explicit-regex matchers.
 */
export function buildCompiledTraceSpanFilterPlan(
  spanFilters: readonly string[]
): CompiledTraceSpanFilterPlan {
  const literalPrefixes: string[] = [];
  const regexMatchers: RegExp[] = [];

  for (const candidate of spanFilters) {
    const explicitRegex = parseExplicitTraceSpanFilterRegex(candidate);
    if (explicitRegex) {
      regexMatchers.push(explicitRegex);
      continue;
    }
    literalPrefixes.push(candidate);
  }

  return {
    literalPrefixes,
    regexMatchers
  };
}

/**
 * Returns the span-name filter provenance mask for one span name.
 */
export function getTraceSpanNameFilterMatchMask(params: {
  /** Span name checked against the compiled filter plan. */
  spanName: string;
  /** Compiled matcher plan built from the current normalized filter list. */
  filterPlan: Readonly<CompiledTraceSpanFilterPlan>;
}): TraceSpanFilterMask {
  if (
    params.filterPlan.literalPrefixes.length === 0 &&
    params.filterPlan.regexMatchers.length === 0
  ) {
    return TRACE_SPAN_FILTER_MASK_NONE;
  }
  return matchesCompiledTraceSpanFilterValue(params.spanName, params.filterPlan)
    ? TRACE_SPAN_FILTER_MASK_REGEXP
    : TRACE_SPAN_FILTER_MASK_NONE;
}

/**
 * Returns the source-column filename filter provenance mask for one source value.
 */
export function getTraceSpanSourceFilterMatchMask(params: {
  /** Optional source metadata checked against the compiled filter plan. */
  source?: string | null;
  /** Compiled matcher plan built from the current normalized filter list. */
  filterPlan: Readonly<CompiledTraceSpanFilterPlan>;
}): TraceSpanFilterMask {
  if (
    params.filterPlan.literalPrefixes.length === 0 &&
    params.filterPlan.regexMatchers.length === 0
  ) {
    return TRACE_SPAN_FILTER_MASK_NONE;
  }
  return typeof params.source === 'string' &&
    params.source.length > 0 &&
    matchesCompiledTraceSpanFilterValue(params.source, params.filterPlan)
    ? TRACE_SPAN_FILTER_MASK_SOURCE
    : TRACE_SPAN_FILTER_MASK_NONE;
}

/**
 * Returns whether two normalized span-filter lists are identical.
 */
export function areSpanFilterListsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return left.length === right.length && left.every((filter, index) => filter === right[index]);
}

/**
 * Parses one user-entered filter as an explicit `/.../flags` regex when possible.
 */
function parseExplicitTraceSpanFilterRegex(candidate: string): RegExp | null {
  if (!candidate.startsWith('/')) {
    return null;
  }

  const closingSlashIndex = candidate.lastIndexOf('/');
  if (closingSlashIndex <= 0) {
    return null;
  }

  const patternSource = candidate.slice(1, closingSlashIndex);
  const flags = candidate.slice(closingSlashIndex + 1);
  try {
    return new RegExp(patternSource, flags);
  } catch {
    return null;
  }
}

/**
 * Returns whether one candidate string matches any compiled span-filter matcher.
 */
function matchesCompiledTraceSpanFilterValue(
  candidate: string,
  filterPlan: Readonly<CompiledTraceSpanFilterPlan>
): boolean {
  for (const literalPrefix of filterPlan.literalPrefixes) {
    if (candidate.startsWith(literalPrefix)) {
      return true;
    }
  }

  for (const regexMatcher of filterPlan.regexMatchers) {
    regexMatcher.lastIndex = 0;
    if (regexMatcher.test(candidate)) {
      return true;
    }
  }

  return false;
}
