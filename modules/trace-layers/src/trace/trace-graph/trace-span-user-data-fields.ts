/**
 * Returns the canonical source string from ingestion-specific span user data.
 */
export function getTraceSpanUserDataSource(
  userData: Readonly<Record<string, unknown>> | null | undefined
): string | null {
  return getFirstNonEmptyTraceSpanUserDataString(userData, ['source']);
}

function getFirstNonEmptyTraceSpanUserDataString(
  userData: Readonly<Record<string, unknown>> | null | undefined,
  keys: readonly string[]
): string | null {
  if (!userData) {
    return null;
  }

  for (const key of keys) {
    const value = userData[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}
