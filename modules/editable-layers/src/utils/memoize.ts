// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// port from @deck.gl/core
function isEqual(a: any, b: any) {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a)) {
    // Special treatment for arrays: compare 1-level deep
    // This is to support equality of matrix/coordinate props
    const len = a.length;
    if (!b || b.length !== len) {
      return false;
    }

    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Speed up consecutive function calls by caching the result of calls with identical input
 * https://en.wikipedia.org/wiki/Memoization
 * @param {function} compute - the function to be memoized
 */
export function memoize<T, R>(compute: (args: T) => R): (args: T) => R {
  let cachedArgs: T | null = null;
  let cachedResult: R | null = null;

  return (args: T) => {
    //  check for null args on first run
    if (!cachedArgs) {
      cachedResult = compute(args);
      cachedArgs = args;
      return cachedResult;
    }
    for (const key in args) {
      if (!isEqual(args[key], cachedArgs[key])) {
        cachedResult = compute(args);
        cachedArgs = args;
        break;
      }
    }
    return cachedResult;
  };
}
