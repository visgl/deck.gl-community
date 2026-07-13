const TRACE_SPAN_PLAIN_TEXT_QUERY = Symbol('trace-span-plain-text-query');
const TRACE_SPAN_EXACT_EXTERNAL_ID_QUERY = Symbol('trace-span-exact-external-id-query');

/**
 * Builds one span-name matcher shared by interactive Omnibox search and deep-link defaults.
 *
 * Plain text queries use case-insensitive substring matching. Slash-delimited queries such as
 * `/all_.*reduce/i` are treated as regular expressions; invalid expressions do not match.
 */
export function createTraceSpanNameSearchPredicate(
  query: string
): ((searchText: string) => boolean) | null {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return null;
  }

  if (normalizedQuery.startsWith('/')) {
    const regex = parseTraceSpanNameRegexQuery(normalizedQuery);
    if (!regex) {
      return () => false;
    }
    return tagTraceSpanNameSearchPredicate(searchText => {
      regex.lastIndex = 0;
      return regex.test(searchText);
    }, null);
  }

  const normalizedTextQuery = normalizedQuery.toLowerCase();
  return tagTraceSpanNameSearchPredicate(
    searchText => normalizeTraceSpanPlainSearchText(searchText).includes(normalizedTextQuery),
    normalizedTextQuery
  );
}

/**
 * Builds one Omnibox span matcher that preserves name search while carrying an exact external id.
 *
 * The callable matcher keeps the existing name/source/keyword substring and regexp behavior.
 * Trace search implementations read the attached raw query separately so external_span_id
 * matches remain case-sensitive equality checks instead of entering partial text search.
 */
export function createTraceSpanOmniBoxSearchPredicate(
  query: string
): ((searchText: string) => boolean) | null {
  const normalizedQuery = query.trim();
  const predicate = createTraceSpanNameSearchPredicate(normalizedQuery);
  if (!predicate) {
    return null;
  }

  Object.defineProperty(predicate, TRACE_SPAN_EXACT_EXTERNAL_ID_QUERY, {
    value: normalizedQuery
  });
  return predicate;
}

/** Returns the lowercase plain-text query attached by the shared span-search predicate factory. */
export function getTraceSpanPlainTextQuery(
  predicate: (searchText: string) => boolean
): string | null {
  const plainTextQuery = (
    predicate as {
      readonly [TRACE_SPAN_PLAIN_TEXT_QUERY]?: unknown;
    }
  )[TRACE_SPAN_PLAIN_TEXT_QUERY];
  return typeof plainTextQuery === 'string' ? plainTextQuery : null;
}

/** Returns the case-sensitive external id query attached by the Omnibox predicate factory. */
export function getTraceSpanExactExternalIdQuery(
  predicate: (searchText: string) => boolean
): string | null {
  const externalIdQuery = (
    predicate as {
      readonly [TRACE_SPAN_EXACT_EXTERNAL_ID_QUERY]?: unknown;
    }
  )[TRACE_SPAN_EXACT_EXTERNAL_ID_QUERY];
  return typeof externalIdQuery === 'string' ? externalIdQuery : null;
}

/** Parses slash-delimited span-name regex queries while defaulting to case-insensitive search. */
function parseTraceSpanNameRegexQuery(query: string): RegExp | null {
  const closingSlashIndex = query.lastIndexOf('/');
  if (closingSlashIndex <= 0) {
    return null;
  }

  const pattern = query.slice(1, closingSlashIndex);
  const requestedFlags = query.slice(closingSlashIndex + 1);
  const flags = addMissingTraceSpanRegexFlags(requestedFlags, 'im');
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** Adds default regex flags without duplicating caller-provided flags. */
function addMissingTraceSpanRegexFlags(flags: string, defaults: string): string {
  let nextFlags = flags;
  for (const defaultFlag of defaults) {
    if (!nextFlags.includes(defaultFlag)) {
      nextFlags += defaultFlag;
    }
  }
  return nextFlags;
}

/** Normalizes field-delimited search text for plain substring queries. */
function normalizeTraceSpanPlainSearchText(searchText: string): string {
  return searchText.toLowerCase().replace(/\s+/g, ' ');
}

/** Attaches non-enumerable lowercase plain-text metadata for field-wise search fast paths. */
function tagTraceSpanNameSearchPredicate(
  predicate: (searchText: string) => boolean,
  plainTextQuery: string | null
): (searchText: string) => boolean {
  Object.defineProperty(predicate, TRACE_SPAN_PLAIN_TEXT_QUERY, {
    value: plainTextQuery
  });
  return predicate;
}
