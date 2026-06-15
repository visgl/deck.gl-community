import {describe, expect, it} from 'vitest';

import {buildTraceLayoutGeometryDerivationContext} from './trace-derived-geometry';
import {estimateTraceLayoutSize} from './trace-layout-size';

import type {TraceLayout} from './trace-layout';

describe('estimateTraceLayoutSize', () => {
  it('counts lane and row layout buffers without layout-owned span geometry', () => {
    const layout = {
      traceGraph: {
        maxTimeMs: 1,
        minTimeMs: 0,
        getProcessRefBySpanRef: () => null,
        getThreadRefBySpanRef: () => null
      },
      processLayouts: [
        {
          processRef: 0,
          yOffset: 0,
          yHeight: 10,
          labelY: 5,
          collapsedActivityY: 5,
          backgroundPolygon: new Float32Array(6),
          backgroundPolygonInfinite: new Float32Array(6),
          separatorLineInfinite: new Float32Array(4),
          terminalSeparatorLineInfinite: new Float32Array(4),
          startPosition: [0, 0, 0],
          threadLayouts: []
        }
      ],
      processLayoutMapByRef: new Map(),
      renderRows: [],
      threadLayoutMapByRef: new Map(),
      overflowLabels: [],
      currentBounds: [
        [0, 0],
        [1, 1]
      ],
      expandedBounds: [
        [0, 0],
        [1, 1]
      ]
    } as unknown as TraceLayout;

    const report = estimateTraceLayoutSize([layout]);

    expect(report.totalBytes).toBeGreaterThan(0);
    expect(report.entries.some(entry => entry.path.includes('spanGeometry'))).toBe(false);
    expect(report.entries.some(entry => entry.path.includes('geometryCache'))).toBe(false);
  });

  it('builds direct geometry context without duplicate span-indexed layout maps', () => {
    const layout = {
      traceGraph: {
        maxTimeMs: 1,
        minTimeMs: 0,
        getProcessRefBySpanRef: () => null,
        getThreadRefBySpanRef: () => null
      },
      processLayoutMapByRef: new Map(),
      threadLayoutMapByRef: new Map()
    } as unknown as TraceLayout;

    const context = buildTraceLayoutGeometryDerivationContext(layout);

    expect(context.layoutLookup).not.toHaveProperty('threadLayoutsBySpanRef');
    expect(context.layoutLookup).not.toHaveProperty('processLayoutsBySpanRef');
  });
});
