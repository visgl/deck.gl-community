import type {TraceDependency} from '../trace-graph/trace-types';

const TRACE_DEPENDENCY_WAIT_MODE_END_TO_START = 0;
const TRACE_DEPENDENCY_WAIT_MODE_END_TO_END = 1;
const TRACE_DEPENDENCY_WAIT_MODE_START_TO_START = 2;
const TRACE_DEPENDENCY_KEYWORD_FLAG_PARENT = 1 << 0;
const TRACE_DEPENDENCY_KEYWORD_FLAG_SUBMIT = 1 << 1;

/** Compact Arrow scalar code for the closed dependency wait-mode domain. */
export type TraceDependencyWaitModeCode = 0 | 1 | 2;

/**
 * Encodes one dependency wait mode into its canonical compact Arrow scalar.
 *
 * @param waitMode Closed-domain dependency wait mode owned by the source row.
 * @returns Stable Uint8-compatible wait-mode code.
 */
export function encodeTraceDependencyWaitModeCode(
  waitMode: TraceDependency['waitMode']
): TraceDependencyWaitModeCode {
  switch (waitMode) {
    case 'end-to-start':
      return TRACE_DEPENDENCY_WAIT_MODE_END_TO_START;
    case 'end-to-end':
      return TRACE_DEPENDENCY_WAIT_MODE_END_TO_END;
    case 'start-to-start':
      return TRACE_DEPENDENCY_WAIT_MODE_START_TO_START;
  }
}

/**
 * Decodes one compact Arrow wait-mode scalar without materializing Utf8.
 *
 * @param value Unknown Arrow scalar read from the canonical wait-mode-code column.
 * @returns Decoded wait mode, or null for an invalid or missing code.
 */
export function decodeTraceDependencyWaitModeCode(
  value: unknown
): TraceDependency['waitMode'] | null {
  switch (value) {
    case TRACE_DEPENDENCY_WAIT_MODE_END_TO_START:
      return 'end-to-start';
    case TRACE_DEPENDENCY_WAIT_MODE_END_TO_END:
      return 'end-to-end';
    case TRACE_DEPENDENCY_WAIT_MODE_START_TO_START:
      return 'start-to-start';
    default:
      return null;
  }
}

/**
 * Encodes hot dependency keyword predicates into one canonical Uint8-compatible bit field.
 *
 * The full keyword list remains the detail representation for arbitrary card/filter reads. This
 * scalar carries only the two render/layout predicates that would otherwise decode a List<Utf8>
 * cell for every dependency row.
 *
 * @param keywords Source dependency keywords in canonical row order.
 * @param hasParentKeyword Optional already-normalized parent marker supplied by an ingester.
 * @returns Stable keyword predicate flags for the hot Arrow table.
 */
export function encodeTraceDependencyKeywordFlags(
  keywords: Iterable<string>,
  hasParentKeyword = false
): number {
  let flags = hasParentKeyword ? TRACE_DEPENDENCY_KEYWORD_FLAG_PARENT : 0;
  for (const keyword of keywords) {
    if (keyword.toUpperCase() === 'PARENT') {
      flags |= TRACE_DEPENDENCY_KEYWORD_FLAG_PARENT;
    }
    if (keyword === 'SUBMIT') {
      flags |= TRACE_DEPENDENCY_KEYWORD_FLAG_SUBMIT;
    }
  }
  return flags;
}

/**
 * Returns whether one compact keyword flag scalar carries the parent predicate.
 *
 * @param value Unknown Arrow scalar read from the canonical keyword-flags column.
 * @returns Whether the scalar is valid and marks a parent dependency.
 */
export function traceDependencyKeywordFlagsHasParent(value: unknown): boolean {
  const flags = normalizeTraceDependencyKeywordFlags(value);
  return flags != null && (flags & TRACE_DEPENDENCY_KEYWORD_FLAG_PARENT) !== 0;
}

/**
 * Returns whether one compact keyword flag scalar carries the submit predicate.
 *
 * @param value Unknown Arrow scalar read from the canonical keyword-flags column.
 * @returns Whether the scalar is valid and marks a submit dependency.
 */
export function traceDependencyKeywordFlagsHasSubmit(value: unknown): boolean {
  const flags = normalizeTraceDependencyKeywordFlags(value);
  return flags != null && (flags & TRACE_DEPENDENCY_KEYWORD_FLAG_SUBMIT) !== 0;
}

/** Returns one valid Uint8-compatible keyword flag scalar, or null for malformed input. */
function normalizeTraceDependencyKeywordFlags(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xff
    ? value
    : null;
}
