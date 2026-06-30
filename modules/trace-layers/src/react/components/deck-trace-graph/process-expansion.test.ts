import {describe, expect, it} from 'vitest';

import {
  getCollapsedProcessIdsForBulkToggle,
  getCollapsedProcessIdsForExpandedState,
  shouldToggleAllProcessesToExpanded
} from './process-expansion';

describe('process expansion helpers', () => {
  it('collapses all processes when every process is currently expanded', () => {
    const validRankIds = new Set(['rank-a', 'rank-b']);

    expect(getCollapsedProcessIdsForBulkToggle(validRankIds, new Set())).toEqual(
      new Set(['rank-a', 'rank-b'])
    );
  });

  it('expands all processes when any process is currently collapsed', () => {
    const validRankIds = new Set(['rank-a', 'rank-b']);

    expect(getCollapsedProcessIdsForBulkToggle(validRankIds, new Set(['rank-a']))).toEqual(
      new Set()
    );
  });

  it('expands all processes from a fully collapsed state', () => {
    const validRankIds = new Set(['rank-a', 'rank-b']);

    expect(getCollapsedProcessIdsForExpandedState(validRankIds, true)).toEqual(new Set());
    expect(shouldToggleAllProcessesToExpanded(new Set(['rank-a', 'rank-b']))).toBe(true);
  });

  it('uses all valid rank ids across multiple graphs when collapsing all', () => {
    const validRankIds = new Set(['graph-1-rank-a', 'graph-1-rank-b', 'graph-2-rank-a']);

    expect(getCollapsedProcessIdsForExpandedState(validRankIds, false)).toEqual(
      new Set(['graph-1-rank-a', 'graph-1-rank-b', 'graph-2-rank-a'])
    );
  });
});
