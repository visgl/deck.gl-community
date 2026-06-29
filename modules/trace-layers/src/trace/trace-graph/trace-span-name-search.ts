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
    return searchText => {
      regex.lastIndex = 0;
      return regex.test(searchText);
    };
  }

  const normalizedTextQuery = normalizedQuery.toLowerCase();
  return searchText => normalizeTraceSpanPlainSearchText(searchText).includes(normalizedTextQuery);
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
