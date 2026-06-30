/**
 * Token type produced by numeric-aware sorting helpers.
 */
export type NumericSortToken = number | string;

/**
 * Split a string into tokens on spaces, dashes, or underscores and coerce numeric
 * tokens into numbers to enable natural sorting.
 */
export function buildNumericSortTokens(value: string): NumericSortToken[] {
  return value
    .split(/[\s_-]+/u)
    .filter(part => part.length > 0)
    .map(part => (/^\d+$/u.test(part) ? Number(part) : part));
}

/**
 * Compare two strings using numeric-aware tokenization for natural ordering.
 */
export function compareNumericSortStrings(a: string, b: string): number {
  const tokensA = buildNumericSortTokens(a);
  const tokensB = buildNumericSortTokens(b);
  const maxTokens = Math.max(tokensA.length, tokensB.length);

  for (let index = 0; index < maxTokens; index += 1) {
    const tokenA = tokensA[index];
    const tokenB = tokensB[index];

    if (tokenA === undefined) return tokenB === undefined ? 0 : -1;
    if (tokenB === undefined) return 1;

    if (typeof tokenA === 'number' && typeof tokenB === 'number') {
      if (tokenA !== tokenB) return tokenA - tokenB;
      continue;
    }

    if (typeof tokenA === 'string' && typeof tokenB === 'string') {
      const comparison = tokenA.localeCompare(tokenB, undefined, {sensitivity: 'base'});
      if (comparison !== 0) return comparison;
      continue;
    }

    return typeof tokenA === 'number' ? -1 : 1;
  }

  return a.localeCompare(b, undefined, {sensitivity: 'base'});
}
