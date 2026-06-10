import {describe, expect, it} from 'vitest';

import {buildTraceLayoutGeometryColumn} from './trace-layout';
import {estimateTraceLayoutSize} from './trace-layout-size';

import type {TraceLayout} from './trace-layout';

describe('estimateTraceLayoutSize', () => {
  it('counts kept layout geometry buffers once', () => {
    const spanValues = new Float32Array(8);
    const dependencyValues = new Float32Array(4);
    const spanGeometry = buildTraceLayoutGeometryColumn(spanValues);
    const localDependencyGeometry = buildTraceLayoutGeometryColumn(dependencyValues);
    const layout = {
      traceGraph: {},
      processLayouts: [
        {
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
      renderRows: [],
      threadLayoutMap: {},
      spanGeometryChunks: [spanGeometry],
      localDependencyGeometryChunks: [localDependencyGeometry],
      crossDependencyGeometryChunks: [],
      geometryCache: {
        processesById: {},
        spanGeometryChunks: [spanGeometry],
        localDependencyGeometryChunks: [localDependencyGeometry],
        crossDependencyGeometryChunks: [],
        crossDependencyReuseKeyByVisibleRef: new Map()
      },
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

    expect(report.totalBytes).toBeGreaterThan(spanValues.byteLength + dependencyValues.byteLength);
    expect(
      report.entries.filter(
        entry =>
          entry.path.endsWith('.spanGeometryChunks[0].values') ||
          entry.path.endsWith('.localDependencyGeometryChunks[0].values')
      )
    ).toHaveLength(2);
  });
});
