import {describe, expect, it, vi} from 'vitest';

import {buildHierarchicalTrackLayout} from './hierarchical-track-layout';

import type {HierarchicalTrackDescriptor} from './hierarchical-track-layout';

type TestTrackDescriptor = HierarchicalTrackDescriptor & {
  readonly label: string;
  readonly height: number;
  readonly width: number;
};

describe('buildHierarchicalTrackLayout', () => {
  it('computes stable root and sibling ordering for a multi-root hierarchy', () => {
    const descriptors: TestTrackDescriptor[] = [
      {id: 'root-a', kind: 'group', type: 'rank', label: 'Root A', height: 3, width: 10},
      {
        id: 'a-child-1',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root-a',
        label: 'A1',
        height: 2,
        width: 8
      },
      {
        id: 'a-child-2',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root-a',
        label: 'A2',
        height: 4,
        width: 9
      },
      {id: 'root-b', kind: 'group', type: 'rank', label: 'Root B', height: 5, width: 12},
      {
        id: 'b-child',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root-b',
        label: 'B1',
        height: 6,
        width: 11
      }
    ];

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root-b', 'root-a'],
      measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
    });

    expect(layout.rootTrackIds).toEqual(['root-b', 'root-a']);
    expect(layout.orderedTrackIds).toEqual([
      'root-b',
      'b-child',
      'root-a',
      'a-child-1',
      'a-child-2'
    ]);
    expect(layout.trackLayoutsById['root-a']?.childIds).toEqual(['a-child-1', 'a-child-2']);
    expect(layout.trackLayoutsById['root-a']?.visibleChildIds).toEqual(['a-child-1', 'a-child-2']);
    expect(layout.totalCurrentHeight).toBe(20);
    expect(layout.totalExpandedHeight).toBe(20);
    expect(layout.totalCurrentWidth).toBe(12);
    expect(layout.totalExpandedWidth).toBe(12);
  });

  it('measures each descriptor exactly once and uses callback-provided size values', () => {
    const descriptors: TestTrackDescriptor[] = [
      {id: 'root', kind: 'group', type: 'rank', label: 'Root', height: 7, width: 14},
      {
        id: 'child',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root',
        label: 'Child',
        height: 2,
        width: 6
      }
    ];
    const measureTrack = vi.fn((descriptor: TestTrackDescriptor) => ({
      height: descriptor.height,
      width: descriptor.width
    }));

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root'],
      measureTrack
    });

    expect(measureTrack).toHaveBeenCalledTimes(2);
    expect(layout.trackLayoutsById.root?.ownHeight).toBe(7);
    expect(layout.trackLayoutsById.root?.ownWidth).toBe(14);
    expect(layout.trackLayoutsById.child?.ownHeight).toBe(2);
    expect(layout.trackLayoutsById.child?.ownWidth).toBe(6);
  });

  it('preserves application type strings and object references on layout entries', () => {
    const applicationObject = {id: 123, name: 'thread-object'};
    const descriptors: Array<
      HierarchicalTrackDescriptor<typeof applicationObject> & {
        readonly height: number;
        readonly width: number;
      }
    > = [
      {id: 'root', kind: 'group', type: 'rank', height: 1, width: 2},
      {
        id: 'child',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root',
        object: applicationObject,
        height: 3,
        width: 4
      }
    ];

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root'],
      measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
    });

    expect(layout.trackLayoutsById.root?.type).toBe('rank');
    expect(layout.trackLayoutsById.child?.type).toBe('thread');
    expect(layout.trackLayoutsById.child?.object).toBe(applicationObject);
  });

  it('collapses a non-leaf track to its own header height and hides descendants from current placement', () => {
    const descriptors: TestTrackDescriptor[] = [
      {id: 'root', kind: 'group', type: 'rank', label: 'Root', height: 4, width: 10},
      {
        id: 'branch',
        kind: 'group',
        type: 'grouped-thread',
        parentId: 'root',
        label: 'Branch',
        height: 3,
        width: 8
      },
      {
        id: 'leaf',
        kind: 'leaf',
        type: 'thread',
        parentId: 'branch',
        label: 'Leaf',
        height: 2,
        width: 6
      }
    ];

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root'],
      collapsedTrackIds: new Set(['branch']),
      measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
    });

    expect(layout.trackLayoutsById.branch?.isCollapsed).toBe(true);
    expect(layout.trackLayoutsById.branch?.isVisible).toBe(true);
    expect(layout.trackLayoutsById.branch?.currentYOffset).toBe(4);
    expect(layout.trackLayoutsById.branch?.currentSubtreeHeight).toBe(3);
    expect(layout.trackLayoutsById.branch?.visibleChildIds).toEqual([]);
    expect(layout.trackLayoutsById.leaf?.isVisible).toBe(false);
    expect(layout.trackLayoutsById.leaf?.currentYOffset).toBeNull();
    expect(layout.totalCurrentHeight).toBe(7);
    expect(layout.totalExpandedHeight).toBe(9);
  });

  it('keeps descendant subtree sizes while clearing current offsets beneath a collapsed ancestor', () => {
    const descriptors: TestTrackDescriptor[] = [
      {id: 'root', kind: 'group', type: 'rank', label: 'Root', height: 1, width: 4},
      {
        id: 'branch',
        kind: 'group',
        type: 'grouped-thread',
        parentId: 'root',
        label: 'Branch',
        height: 2,
        width: 5
      },
      {
        id: 'nested',
        kind: 'group',
        type: 'subgroup',
        parentId: 'branch',
        label: 'Nested',
        height: 3,
        width: 6
      },
      {
        id: 'leaf',
        kind: 'leaf',
        type: 'thread',
        parentId: 'nested',
        label: 'Leaf',
        height: 4,
        width: 7
      }
    ];

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root'],
      collapsedTrackIds: new Set(['branch']),
      measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
    });

    expect(layout.trackLayoutsById.nested?.currentSubtreeHeight).toBe(7);
    expect(layout.trackLayoutsById.nested?.expandedSubtreeHeight).toBe(7);
    expect(layout.trackLayoutsById.nested?.currentSubtreeWidth).toBe(7);
    expect(layout.trackLayoutsById.nested?.expandedSubtreeWidth).toBe(7);
    expect(layout.trackLayoutsById.nested?.currentYOffset).toBeNull();
    expect(layout.trackLayoutsById.nested?.expandedYOffset).toBe(3);
    expect(layout.trackLayoutsById.leaf?.currentYOffset).toBeNull();
    expect(layout.trackLayoutsById.leaf?.expandedYOffset).toBe(6);
  });

  it('ignores collapse state for leaf tracks', () => {
    const descriptors: TestTrackDescriptor[] = [
      {id: 'root', kind: 'group', type: 'rank', label: 'Root', height: 2, width: 5},
      {
        id: 'leaf',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root',
        label: 'Leaf',
        height: 3,
        width: 6
      }
    ];

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root'],
      collapsedTrackIds: new Set(['leaf']),
      measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
    });

    expect(layout.trackLayoutsById.leaf?.isLeaf).toBe(true);
    expect(layout.trackLayoutsById.leaf?.isCollapsed).toBe(false);
    expect(layout.trackLayoutsById.leaf?.currentYOffset).toBe(2);
    expect(layout.totalCurrentHeight).toBe(5);
  });

  it('applies children offsets and sibling gaps to height and offset calculations', () => {
    const descriptors: TestTrackDescriptor[] = [
      {id: 'root', kind: 'group', type: 'rank', label: 'Root', height: 10, width: 4},
      {
        id: 'first',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root',
        label: 'First',
        height: 3,
        width: 5
      },
      {
        id: 'second',
        kind: 'leaf',
        type: 'thread',
        parentId: 'root',
        label: 'Second',
        height: 5,
        width: 6
      }
    ];

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root'],
      measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width}),
      getChildrenOffset: descriptor => (descriptor.id === 'root' ? 2 : 0),
      getSiblingGap: (parentDescriptor, previousChildDescriptor, nextChildDescriptor) =>
        parentDescriptor.id === 'root' &&
        previousChildDescriptor.id === 'first' &&
        nextChildDescriptor.id === 'second'
          ? 4
          : 0
    });

    expect(layout.trackLayoutsById.root?.expandedSubtreeHeight).toBe(24);
    expect(layout.trackLayoutsById.first?.currentYOffset).toBe(12);
    expect(layout.trackLayoutsById.second?.currentYOffset).toBe(19);
    expect(layout.totalCurrentHeight).toBe(24);
  });

  it('aggregates subtree width as the maximum of parent and descendant widths', () => {
    const descriptors: TestTrackDescriptor[] = [
      {id: 'root', kind: 'group', type: 'rank', label: 'Root', height: 1, width: 5},
      {
        id: 'branch',
        kind: 'group',
        type: 'grouped-thread',
        parentId: 'root',
        label: 'Branch',
        height: 1,
        width: 20
      },
      {
        id: 'leaf',
        kind: 'leaf',
        type: 'thread',
        parentId: 'branch',
        label: 'Leaf',
        height: 1,
        width: 12
      }
    ];

    const layout = buildHierarchicalTrackLayout({
      descriptors,
      rootTrackIds: ['root'],
      collapsedTrackIds: new Set(['branch']),
      measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
    });

    expect(layout.trackLayoutsById.root?.expandedSubtreeWidth).toBe(20);
    expect(layout.trackLayoutsById.root?.currentSubtreeWidth).toBe(20);
    expect(layout.trackLayoutsById.branch?.expandedSubtreeWidth).toBe(20);
    expect(layout.trackLayoutsById.branch?.currentSubtreeWidth).toBe(20);
    expect(layout.totalExpandedWidth).toBe(20);
    expect(layout.totalCurrentWidth).toBe(20);
  });

  it('rejects duplicate ids, unknown roots, missing parents, top-level non-roots, and cycles', () => {
    expect(() =>
      buildHierarchicalTrackLayout({
        descriptors: [
          {id: 'dup', kind: 'group', type: 'rank', label: 'one', height: 1, width: 1},
          {id: 'dup', kind: 'group', type: 'rank', label: 'two', height: 1, width: 1}
        ],
        rootTrackIds: ['dup'],
        measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
      })
    ).toThrow(/Duplicate track descriptor id/);

    expect(() =>
      buildHierarchicalTrackLayout({
        descriptors: [
          {id: 'root', kind: 'group', type: 'rank', label: 'root', height: 1, width: 1}
        ],
        rootTrackIds: ['missing-root'],
        measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
      })
    ).toThrow(/Unknown root track id/);

    expect(() =>
      buildHierarchicalTrackLayout({
        descriptors: [
          {id: 'root', kind: 'group', type: 'rank', label: 'root', height: 1, width: 1},
          {
            id: 'child',
            kind: 'leaf',
            type: 'thread',
            parentId: 'missing-parent',
            label: 'child',
            height: 1,
            width: 1
          }
        ],
        rootTrackIds: ['root'],
        measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
      })
    ).toThrow(/references missing parent/);

    expect(() =>
      buildHierarchicalTrackLayout({
        descriptors: [
          {id: 'root', kind: 'group', type: 'rank', label: 'root', height: 1, width: 1},
          {id: 'extra-root', kind: 'group', type: 'rank', label: 'extra', height: 1, width: 1}
        ],
        rootTrackIds: ['root'],
        measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
      })
    ).toThrow(/must be listed in rootTrackIds/);

    expect(() =>
      buildHierarchicalTrackLayout({
        descriptors: [
          {
            id: 'root',
            kind: 'group',
            type: 'rank',
            parentId: 'child',
            label: 'root',
            height: 1,
            width: 1
          },
          {
            id: 'child',
            kind: 'group',
            type: 'rank',
            parentId: 'root',
            label: 'child',
            height: 1,
            width: 1
          }
        ],
        rootTrackIds: ['root'],
        measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
      })
    ).toThrow(/must not declare parentId|not reachable from rootTrackIds|Cycle detected/);
  });

  it('rejects leaf descriptors that also own children', () => {
    expect(() =>
      buildHierarchicalTrackLayout({
        descriptors: [
          {id: 'root', kind: 'group', type: 'rank', label: 'root', height: 1, width: 1},
          {
            id: 'leaf-parent',
            kind: 'leaf',
            type: 'thread',
            parentId: 'root',
            label: 'leaf',
            height: 1,
            width: 1
          },
          {
            id: 'child',
            kind: 'leaf',
            type: 'thread',
            parentId: 'leaf-parent',
            label: 'child',
            height: 1,
            width: 1
          }
        ],
        rootTrackIds: ['root'],
        measureTrack: descriptor => ({height: descriptor.height, width: descriptor.width})
      })
    ).toThrow(/Leaf track "leaf-parent" cannot have child tracks/);
  });
});
