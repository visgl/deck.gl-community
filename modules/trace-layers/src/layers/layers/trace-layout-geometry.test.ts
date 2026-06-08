import {describe, expect, it, vi} from 'vitest';

import {
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef
} from '../../trace/index';
import {
  buildTraceLayoutCrossDependencyGeometryChunksForTest,
  buildTraceLayoutLocalDependencyGeometryChunksForTest,
  buildTraceLayoutSpanGeometryChunksForTest
} from '../../trace/trace-graph/trace-graph-test-utils';
import {
  getTraceLayoutBlockGeometry,
  getTraceLayoutCrossDependencyGeometry,
  getTraceLayoutLocalDependencyGeometry,
  getTraceLayoutSelectedLocalDependencyGeometry
} from './trace-layout-geometry';

import type {
  TraceCrossProcessDependency,
  TraceLayout,
  TraceLocalDependency
} from '../../trace/index';

function expectGeometryValues(actual: Float32Array | undefined, expected: Readonly<Float32Array>) {
  expect(actual).toBeDefined();
  expect(Array.from(actual!)).toEqual(Array.from(expected));
}

describe('trace-layout-geometry', () => {
  it('resolves local dependency geometry through the current visible ref from TraceGraph', () => {
    const staleDependencyRef = encodeVisibleLocalDependencyRef(1);
    const currentVisibleDependencyRef = encodeVisibleLocalDependencyRef(0);
    const sourceDependencyRef = encodeLocalDependencyRef(encodeLocalSpanRef(0, 0));
    const expectedGeometry = new Float32Array([1, 2, 3, 4]);
    const traceLayout = {
      traceGraph: {
        getVisibleDependencyRefForDependency: vi.fn(() => currentVisibleDependencyRef),
        getDependencySourceRefByRef: vi.fn(() => sourceDependencyRef)
      },
      localDependencyGeometryChunks: buildTraceLayoutLocalDependencyGeometryChunksForTest([
        [sourceDependencyRef, expectedGeometry]
      ])
    } as unknown as TraceLayout;
    const dependency = {
      type: 'trace-local-dependency',
      dependencyId: 'local-dependency' as TraceLocalDependency['dependencyId'],
      dependencyRef: staleDependencyRef
    } as TraceLocalDependency;

    expectGeometryValues(
      getTraceLayoutLocalDependencyGeometry({traceLayout, dependency}),
      expectedGeometry
    );
  });

  it('resolves cross dependency geometry through the current visible ref from TraceGraph', () => {
    const staleDependencyRef = encodeVisibleCrossDependencyRef(1);
    const currentVisibleDependencyRef = encodeVisibleCrossDependencyRef(0);
    const sourceDependencyRef = encodeCrossDependencyRef(0);
    const expectedGeometry = new Float32Array([4, 3, 2, 1]);
    const traceLayout = {
      traceGraph: {
        getVisibleDependencyRefForDependency: vi.fn(() => currentVisibleDependencyRef),
        getDependencySourceRefByRef: vi.fn(() => sourceDependencyRef)
      },
      crossDependencyGeometryChunks: buildTraceLayoutCrossDependencyGeometryChunksForTest([
        [sourceDependencyRef, expectedGeometry]
      ])
    } as unknown as TraceLayout;
    const dependency = {
      type: 'trace-cross-process-dependency',
      dependencyId: 'cross-dependency' as TraceCrossProcessDependency['dependencyId'],
      dependencyRef: staleDependencyRef
    } as TraceCrossProcessDependency;

    expectGeometryValues(
      getTraceLayoutCrossDependencyGeometry({traceLayout, dependency}),
      expectedGeometry
    );
  });

  it('resolves visible-only local dependency geometry from the synthetic chunk range', () => {
    const dependencyRef = encodeVisibleLocalDependencyRef(7);
    const expectedGeometry = new Float32Array([9, 8, 7, 6]);
    const traceLayout = {
      traceGraph: {
        getProcessRefs: vi.fn(() => [0])
      },
      localDependencyGeometryChunks: buildTraceLayoutLocalDependencyGeometryChunksForTest([
        [encodeLocalDependencyRef(encodeLocalSpanRef(1, 7)), expectedGeometry]
      ])
    } as unknown as TraceLayout;

    expectGeometryValues(
      getTraceLayoutLocalDependencyGeometry({
        traceLayout,
        dependency: {dependencyRef}
      }),
      expectedGeometry
    );
  });

  it('resolves span geometry only through the canonical span ref', () => {
    const spanRef = encodeSpanRef(0, 7);
    const exactGeometry = new Float32Array([1, 2, 3, 4]);
    const traceLayout = {
      spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([[spanRef, exactGeometry]])
    } as unknown as TraceLayout;

    expectGeometryValues(
      getTraceLayoutBlockGeometry({
        traceLayout,
        block: {spanRef}
      }),
      exactGeometry
    );
  });

  it('does not fall back to span-id geometry when the exact span ref is unavailable', () => {
    const traceLayout = {
      spanGeometryChunks: []
    } as unknown as TraceLayout;

    expect(
      getTraceLayoutBlockGeometry({
        traceLayout,
        block: {spanRef: undefined}
      })
    ).toBeUndefined();
  });

  it('derives selected local dependency geometry from endpoint spans when dependency geometry is skipped', () => {
    const dependencyRef = encodeVisibleLocalDependencyRef(2);
    const startSpanRef = encodeSpanRef(0, 3);
    const endSpanRef = encodeSpanRef(0, 4);
    const traceLayout = {
      traceGraph: {
        getVisibleDependencySourceByRef: vi.fn(() => ({
          type: 'trace-local-dependency',
          dependencyId: 'selected-dependency',
          dependencyRef,
          startSpanId: 'start-span',
          endSpanId: 'end-span',
          startSpanRef,
          endSpanRef,
          waitMode: 'end-to-start',
          bidirectional: false,
          waitTimeMs: 0,
          keywords: new Set<string>()
        }))
      },
      localDependencyGeometryChunks: [],
      spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([
        [startSpanRef, new Float32Array([1, 10, 5, 14])],
        [endSpanRef, new Float32Array([8, 20, 13, 24])]
      ])
    } as unknown as TraceLayout;

    expectGeometryValues(
      getTraceLayoutSelectedLocalDependencyGeometry({traceLayout, dependencyRef}),
      new Float32Array([5, 12, 8, 22])
    );
  });
});
