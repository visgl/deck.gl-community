import {describe, expect, it} from 'vitest';

import {
  createTraceSpanNameSearchPredicate,
  createTraceSpanOmniBoxSearchPredicate,
  getTraceSpanExactExternalIdQuery
} from './trace-span-name-search';

describe('trace span search predicates', () => {
  it('carries a trimmed case-sensitive external id only for Omnibox search', () => {
    const omniBoxPredicate = createTraceSpanOmniBoxSearchPredicate('  External:Case  ');
    const spanNamePredicate = createTraceSpanNameSearchPredicate('External:Case');

    expect(omniBoxPredicate).not.toBeNull();
    expect(getTraceSpanExactExternalIdQuery(omniBoxPredicate!)).toBe('External:Case');
    expect(getTraceSpanExactExternalIdQuery(spanNamePredicate!)).toBeNull();
  });

  it('preserves existing substring and regexp text matching for Omnibox search', () => {
    const plainPredicate = createTraceSpanOmniBoxSearchPredicate('Grad_Sync');
    const regexPredicate = createTraceSpanOmniBoxSearchPredicate('/invoke$/');

    expect(plainPredicate?.('prefix grad_sync suffix')).toBe(true);
    expect(regexPredicate?.('worker invoke')).toBe(true);
    expect(regexPredicate?.('invoke worker')).toBe(false);
  });
});
