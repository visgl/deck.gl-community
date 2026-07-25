import {describe, expect, it} from 'vitest';
import {
  buildJSONTrace,
  buildTraceRanksFromChromeTrace,
  materializeJSONTrace,
  parseChromeTrace
} from '@deck.gl-community/trace-layers/trace';

import {TRACEVIS_EXAMPLE_TRACES} from './tracevis-examples';

describe('TRACEVIS_EXAMPLE_TRACES', () => {
  it('keeps declared tile statistics aligned with the parsed synthetic Chrome trace', () => {
    const example = TRACEVIS_EXAMPLE_TRACES[0]!;
    const chromeTrace = parseChromeTrace(example.traceJson!);
    const {ranks, crossProcessDependencies} = buildTraceRanksFromChromeTrace(chromeTrace);
    const traceGraph = buildJSONTrace(ranks, crossProcessDependencies, {
      name: example.name,
      spanLayout: example.spanLayout
    });
    const stats = materializeJSONTrace(traceGraph).stats;

    expect({
      processCount: stats.processCount,
      threadCount: stats.threadCount,
      spanCount: stats.spanCount,
      dependencyCount: stats.dependencyCount
    }).toEqual(example.stats);
  });

  it('keeps declared tile statistics aligned with prebuilt custom-layout examples', () => {
    const manualExample = TRACEVIS_EXAMPLE_TRACES.find(
      example => example.traceId === 'manual-layout-trace'
    )!;
    const traceGraph = buildJSONTrace(
      manualExample.ranks!,
      manualExample.crossProcessDependencies ?? [],
      {
        name: manualExample.name,
        spanLayout: manualExample.spanLayout
      }
    );
    const materializedTraceGraph = materializeJSONTrace(traceGraph);
    const manualSpan = materializedTraceGraph.spanMap['manual-layout-render' as never];

    expect(materializedTraceGraph.spanLayout).toBe('manual');
    expect({
      processCount: materializedTraceGraph.stats.processCount,
      threadCount: materializedTraceGraph.stats.threadCount,
      spanCount: materializedTraceGraph.stats.spanCount,
      dependencyCount: materializedTraceGraph.stats.dependencyCount
    }).toEqual(manualExample.stats);
    expect(manualSpan).toMatchObject({
      layoutTopY: 10.8,
      layoutHeight: 6
    });
  });
});
