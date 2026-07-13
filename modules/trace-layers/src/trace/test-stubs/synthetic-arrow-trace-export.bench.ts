import {bench, describe} from 'vitest';

import {ArrowChromeTraceWriter} from '../loaders/chrome-trace-loader/chrome-trace-writer';
import {buildTraceDatasetFromReadyTraceChunks} from '../trace-chunk-graph-assembler';
import {buildSyntheticArrowTraceFixture} from './synthetic-arrow-trace';

import type {TraceDataset} from '../trace-dataset';
import type {SyntheticArrowTraceFixture} from './synthetic-arrow-trace';

const DEFAULT_TRACE_EXPORT_BENCHMARK_ROW_COUNTS = [10_000, 100_000] as const;
const TRACE_EXPORT_BENCHMARK_ROW_COUNTS = getTraceExportBenchmarkRowCounts();
const TRACE_EXPORT_BENCHMARK_OPTIONS = {
  iterations: 1,
  time: 0,
  warmupIterations: 0,
  warmupTime: 0
} as const;

describe.each(
  TRACE_EXPORT_BENCHMARK_ROW_COUNTS
)('synthetic Arrow Chrome trace export (%i rows)', rowCount => {
  let fixture: SyntheticArrowTraceFixture | null = null;
  let traceDataset: TraceDataset | null = null;
  let outputBytes = 0;

  /**
   * Prepare one deterministic dataset before Tinybench measures explicit export.
   *
   * The fixture and dataset stay outside the measured callback so this benchmark isolates the
   * click-time Chrome/Perfetto export boundary rather than dataset assembly.
   */
  async function prepareSyntheticTraceExportBenchmarkState(): Promise<void> {
    if (fixture && traceDataset) {
      return;
    }
    fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'synthetic-arrow-trace-export-bench-' + rowCount,
      rowCount
    });
    await yieldTraceExportBenchmarkWorker();
    traceDataset = materializeSyntheticTraceExportDataset(fixture);
    assertSyntheticTraceExportDatasetSummary(fixture, traceDataset);
    await yieldTraceExportBenchmarkWorker();
  }

  /** Emit one explicit NDJSON summary after the measured export run finishes. */
  function emitSyntheticTraceExportBenchmarkSummary(): void {
    if (!traceDataset || outputBytes <= 0) {
      throw new Error('Expected synthetic trace export output before summary emission.');
    }
    process.stdout.write(
      JSON.stringify({
        type: 'tracevis-chrome-trace-export-benchmark-summary',
        rowCount,
        writerInput: 'trace-dataset',
        outputFormat: 'chrome-trace-json',
        semanticCounts: {
          spans: traceDataset.stats.spanCount,
          processes: traceDataset.stats.processCount,
          threads: traceDataset.stats.threadCount,
          sameProcessDependencies: traceDataset.stats.sameProcessDependencyCount,
          crossProcessDependencies: traceDataset.stats.crossProcessDependencyCount
        },
        timeExtents: traceDataset.timeExtents,
        outputBytes
      }) + '\n'
    );
  }

  const benchmarkOptions = {
    ...TRACE_EXPORT_BENCHMARK_OPTIONS,
    setup: prepareSyntheticTraceExportBenchmarkState,
    teardown: (_task: unknown, mode: 'warmup' | 'run') => {
      if (mode === 'run') {
        emitSyntheticTraceExportBenchmarkSummary();
      }
    }
  };

  // Tinybench probes synchronous callbacks once before both warmup and run. Keeping the callback
  // async matches the main trace benchmark and confines every measured export to one task run.
  bench(
    'dataset Chrome trace export',
    async () => {
      if (!traceDataset) {
        throw new Error('Expected synthetic dataset before Chrome trace export.');
      }
      const arrayBuffer = ArrowChromeTraceWriter.encode(traceDataset);
      outputBytes = arrayBuffer.byteLength;
    },
    benchmarkOptions
  );
});

/** Materialize one canonical dataset snapshot from finalized synthetic Arrow chunks. */
function materializeSyntheticTraceExportDataset(fixture: SyntheticArrowTraceFixture): TraceDataset {
  return buildTraceDatasetFromReadyTraceChunks({
    name: 'synthetic-arrow-trace-export-' + fixture.summary.spanCount,
    ...fixture.materializationInputs
  });
}

/** Require deterministic fixture counts and bounds before timing export serialization. */
function assertSyntheticTraceExportDatasetSummary(
  fixture: SyntheticArrowTraceFixture,
  traceDataset: TraceDataset
): void {
  const expected = fixture.summary;
  if (
    traceDataset.stats.spanCount !== expected.spanCount ||
    traceDataset.stats.processCount !== expected.processCount ||
    traceDataset.stats.threadCount !== expected.threadCount ||
    traceDataset.stats.sameProcessDependencyCount !== expected.sameProcessDependencyCount ||
    traceDataset.stats.crossProcessDependencyCount !== 0 ||
    traceDataset.timeExtents.minTimeMs !== expected.minTimeMs ||
    traceDataset.timeExtents.maxTimeMs !== expected.maxTimeMs
  ) {
    throw new Error('Synthetic trace export benchmark fixture lost deterministic semantics.');
  }
}

/** Resolve optional comma-separated row-count overrides for focused export runs. */
function getTraceExportBenchmarkRowCounts(): readonly number[] {
  const configuredRowCounts = process.env.TRACEVIS_EXPORT_BENCHMARK_ROW_COUNTS;
  if (!configuredRowCounts) {
    return DEFAULT_TRACE_EXPORT_BENCHMARK_ROW_COUNTS;
  }
  const rowCounts = configuredRowCounts.split(',').map(value => Number(value.trim()));
  if (
    rowCounts.length === 0 ||
    rowCounts.some(rowCount => !Number.isInteger(rowCount) || rowCount <= 0)
  ) {
    throw new Error(
      'TRACEVIS_EXPORT_BENCHMARK_ROW_COUNTS must be a comma-separated list of positive integers.'
    );
  }
  return rowCounts;
}

/** Yield one event-loop turn so fixture setup does not starve Vitest worker RPC. */
function yieldTraceExportBenchmarkWorker(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
