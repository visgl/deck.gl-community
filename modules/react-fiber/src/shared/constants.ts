/**
 * Reference to the global scope object (window in browsers, self in workers)
 *
 * Provides cross-environment access to the global object using the same
 * pattern as React's internal implementation. Prioritizes `self` over
 * `window` to support Web Workers.
 *
 * NOTE: vendored from React
 */
export const globalScope =
  (typeof self !== 'undefined' && self) || (typeof window !== 'undefined' && window);
