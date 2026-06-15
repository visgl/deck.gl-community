import {useCallback, useEffect, useRef, useState} from 'react';

import {log} from '../../trace/log';
import {WithTooltip} from './with-tooltip';

import type {
  TraceChunkStoreDiagnostics,
  TraceEngineDiagnostics,
  TraceGraphSizeEntry,
  TraceGraphSizeReport
} from '../../trace/index';

/** Browser heap-memory counters exposed by Chromium performance.memory. */
type BrowserHeapMemoryInfo = {
  /** Maximum JavaScript heap size available to this renderer. */
  jsHeapSizeLimit: number;
  /** JavaScript heap bytes allocated from the OS. */
  totalJSHeapSize: number;
  /** JavaScript heap bytes currently used by live objects. */
  usedJSHeapSize: number;
};

/** Props for {@link HeapMemoryInfoBar}. */
export type HeapMemoryInfoBarProps = {
  /** Builds the Tracevis-owned memory report on demand without walking unbounded trace data. */
  buildTraceMemoryReport?: () => TraceMemoryReport | null;
  /** Optional class name added to the compact memory bar root. */
  className?: string;
};

/** On-demand trace memory diagnostics shown in the hover popup and watermark dumps. */
export type TraceMemoryReport = {
  /** Optional cheap retained-state counters for the active TraceChunkStore. */
  traceChunkStoreDiagnostics?: TraceChunkStoreDiagnostics | null;
  /** Optional retained ready-payload estimate for the active TraceChunkStore. */
  traceChunkStoreSizeReport?: TraceGraphSizeReport | null;
  /** Optional observed browser heap delta since the active TraceChunkStore baseline. */
  traceChunkStoreObservedHeapDeltaBytes?: number | null;
  /** Optional observed heap delta not assigned to payloads or the visible window estimate. */
  traceChunkStoreUnattributedHeapDeltaBytes?: number | null;
  /** Optional number of ready chunk payloads retained by the active TraceChunkStore. */
  traceChunkStoreReadyChunkCount?: number | null;
  /** Optional number of ready span rows retained by the active TraceChunkStore. */
  traceChunkStoreReadySpanCount?: number | null;
  /** Optional memory estimate for the active materialized visualization window. */
  traceVisualizationWindowSizeReport?: TraceGraphSizeReport | null;
  /** @deprecated Use `traceVisualizationWindowSizeReport` for visualization-window estimates. */
  traceGraphSizeReport?: TraceGraphSizeReport | null;
  /** Optional cheap retained-state and build diagnostics for the mounted TraceEngine. */
  traceEngineDiagnostics?: TraceEngineDiagnostics | null;
};

const DEFAULT_MEMORY_POLL_MS = 2000;
const HEAP_MEMORY_DIAGNOSTICS_WATERMARK_BYTES = 3 * 1024 * 1024 * 1024;
const HEAP_MEMORY_DIAGNOSTICS_RESET_BYTES = Math.floor(2.75 * 1024 * 1024 * 1024);

/** Why HeapMemoryInfoBar is collecting and logging one on-demand memory report. */
type MemoryDiagnosticsTrigger = 'hover' | 'heap-watermark';

/**
 * Shows a compact JavaScript heap-usage bar for tracevis diagnostics with a memory-detail popup.
 */
export function HeapMemoryInfoBar({
  buildTraceMemoryReport,
  className = ''
}: HeapMemoryInfoBarProps = {}) {
  const memoryInfo = useBrowserHeapMemoryInfo(DEFAULT_MEMORY_POLL_MS);
  const [traceMemoryReport, setTraceMemoryReport] = useState<TraceMemoryReport | null>(null);
  const hasLoggedHeapWatermarkRef = useRef(false);
  const usedRatio = memoryInfo
    ? clampRatio(memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit)
    : 0;
  const totalRatio = memoryInfo
    ? clampRatio(memoryInfo.totalJSHeapSize / memoryInfo.jsHeapSizeLimit)
    : 0;
  const usedLabel = memoryInfo ? formatGigabytesValue(memoryInfo.usedJSHeapSize) : 'N/A';
  const usedBarClassName = `absolute inset-y-0 left-0 ${getUsedHeapBarClassName(usedRatio)}`;
  const rootClassName = [
    'flex w-28 shrink-0 cursor-help items-center gap-2 text-[10px] font-medium text-muted-foreground',
    className
  ]
    .filter(Boolean)
    .join(' ');
  const buildAndLogMemoryDiagnostics = useCallback(
    (trigger: MemoryDiagnosticsTrigger) => {
      const nextTraceMemoryReport = buildTraceMemoryReport?.() ?? null;
      setTraceMemoryReport(nextTraceMemoryReport);
      logMemoryDiagnostics(
        buildMemoryDiagnosticsParams({
          trigger,
          memoryInfo,
          traceMemoryReport: nextTraceMemoryReport
        })
      );
    },
    [buildTraceMemoryReport, memoryInfo]
  );
  const handleMouseEnter = useCallback(() => {
    buildAndLogMemoryDiagnostics('hover');
  }, [buildAndLogMemoryDiagnostics]);

  useEffect(() => {
    if (!memoryInfo) {
      return;
    }
    if (memoryInfo.usedJSHeapSize <= HEAP_MEMORY_DIAGNOSTICS_RESET_BYTES) {
      hasLoggedHeapWatermarkRef.current = false;
      return;
    }
    if (
      memoryInfo.usedJSHeapSize < HEAP_MEMORY_DIAGNOSTICS_WATERMARK_BYTES ||
      hasLoggedHeapWatermarkRef.current
    ) {
      return;
    }
    hasLoggedHeapWatermarkRef.current = true;
    buildAndLogMemoryDiagnostics('heap-watermark');
  }, [buildAndLogMemoryDiagnostics, memoryInfo]);

  return (
    <WithTooltip
      tooltip={
        <HeapMemoryInfoTooltip
          memoryInfo={memoryInfo}
          traceChunkStoreDiagnostics={traceMemoryReport?.traceChunkStoreDiagnostics ?? null}
          traceChunkStoreSizeReport={traceMemoryReport?.traceChunkStoreSizeReport ?? null}
          traceChunkStoreObservedHeapDeltaBytes={
            traceMemoryReport?.traceChunkStoreObservedHeapDeltaBytes ?? null
          }
          traceChunkStoreUnattributedHeapDeltaBytes={
            traceMemoryReport?.traceChunkStoreUnattributedHeapDeltaBytes ?? null
          }
          traceChunkStoreReadyChunkCount={traceMemoryReport?.traceChunkStoreReadyChunkCount ?? null}
          traceChunkStoreReadySpanCount={traceMemoryReport?.traceChunkStoreReadySpanCount ?? null}
          traceVisualizationWindowSizeReport={
            traceMemoryReport?.traceVisualizationWindowSizeReport ??
            traceMemoryReport?.traceGraphSizeReport ??
            null
          }
          traceEngineDiagnostics={traceMemoryReport?.traceEngineDiagnostics ?? null}
        />
      }
    >
      <div
        className={rootClassName}
        aria-label="JavaScript heap memory"
        onMouseEnter={handleMouseEnter}
      >
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted-foreground/20">
          <div
            className="absolute inset-y-0 left-0 bg-muted-foreground/30"
            style={{width: `${totalRatio * 100}%`}}
          />
          <div className={usedBarClassName} style={{width: `${usedRatio * 100}%`}} />
        </div>
        <span className="whitespace-nowrap tabular-nums">
          {memoryInfo ? `${usedLabel} GB` : 'N/A'}
        </span>
      </div>
    </WithTooltip>
  );
}

/** Renders the hover popup for {@link HeapMemoryInfoBar}. */
function HeapMemoryInfoTooltip(props: {
  /** Browser heap-memory snapshot, or null when unsupported. */
  memoryInfo: BrowserHeapMemoryInfo | null;
  /** Optional cheap retained-state counters for the active TraceChunkStore. */
  traceChunkStoreDiagnostics: TraceChunkStoreDiagnostics | null;
  /** Optional retained ready-payload estimate for the active TraceChunkStore. */
  traceChunkStoreSizeReport: TraceGraphSizeReport | null;
  /** Optional observed browser heap delta since the active TraceChunkStore baseline. */
  traceChunkStoreObservedHeapDeltaBytes: number | null;
  /** Optional observed heap delta not assigned to payloads or the visible window estimate. */
  traceChunkStoreUnattributedHeapDeltaBytes: number | null;
  /** Optional number of ready chunk payloads retained by the active TraceChunkStore. */
  traceChunkStoreReadyChunkCount: number | null;
  /** Optional number of ready span rows retained by the active TraceChunkStore. */
  traceChunkStoreReadySpanCount: number | null;
  /** Optional retained-size estimate for the active materialized visualization window. */
  traceVisualizationWindowSizeReport: TraceGraphSizeReport | null;
  /** Optional cheap retained-state and build diagnostics for the mounted TraceEngine. */
  traceEngineDiagnostics: TraceEngineDiagnostics | null;
}) {
  const traceEngineRetainedSizeBytes = props.traceEngineDiagnostics?.traceEngineRetainedSizeBytes;
  const traceLayoutSizeBytes = props.traceEngineDiagnostics?.traceLayoutSizeBytes;
  const traceDeckInputsSizeBytes = props.traceEngineDiagnostics?.traceDeckInputsSizeBytes;
  const hasTraceChunkStoreMemory =
    props.traceChunkStoreDiagnostics != null ||
    props.traceChunkStoreSizeReport != null ||
    typeof props.traceChunkStoreObservedHeapDeltaBytes === 'number' ||
    typeof props.traceChunkStoreUnattributedHeapDeltaBytes === 'number' ||
    typeof props.traceChunkStoreReadyChunkCount === 'number' ||
    typeof props.traceChunkStoreReadySpanCount === 'number';
  const hasTraceEngineMemory =
    props.traceEngineDiagnostics != null ||
    typeof traceEngineRetainedSizeBytes === 'number' ||
    typeof traceLayoutSizeBytes === 'number' ||
    typeof traceDeckInputsSizeBytes === 'number';
  const hasTraceMemory =
    hasTraceChunkStoreMemory ||
    props.traceVisualizationWindowSizeReport != null ||
    hasTraceEngineMemory;
  const traceChunkStoreReadyChunkCount =
    props.traceChunkStoreDiagnostics?.readyChunkCount ?? props.traceChunkStoreReadyChunkCount;

  return (
    <div className="w-80 space-y-2 text-xs">
      <div className="font-medium text-foreground">Memory</div>
      {props.memoryInfo ? (
        <div className="space-y-1">
          <MemoryMetricRow
            label="JS heap used"
            value={`${formatGigabytesValue(props.memoryInfo.usedJSHeapSize)} GB`}
          />
          <MemoryMetricRow
            label="JS heap allocated"
            value={`${formatGigabytesValue(props.memoryInfo.totalJSHeapSize)} GB`}
          />
          <MemoryMetricRow
            label="JS heap limit"
            value={`${formatGigabytesValue(props.memoryInfo.jsHeapSizeLimit)} GB`}
          />
        </div>
      ) : (
        <div className="text-muted-foreground">JS heap usage is unavailable in this browser.</div>
      )}
      {hasTraceMemory ? (
        <>
          {hasTraceChunkStoreMemory ? (
            <div className="space-y-1 border-t border-border pt-2">
              <div className="font-medium text-foreground">TraceChunkStore</div>
              {props.traceChunkStoreSizeReport ? (
                <MemoryMetricRow
                  label="Retained payload estimate"
                  value={formatTraceSizeBytes(props.traceChunkStoreSizeReport.totalBytes)}
                />
              ) : null}
              {props.traceChunkStoreDiagnostics ? (
                <>
                  <MemoryMetricRow
                    label="Descriptors"
                    value={formatTraceCount(props.traceChunkStoreDiagnostics.descriptorCount)}
                  />
                  <MemoryMetricRow
                    label="Loaded chunks"
                    value={`${formatTraceCount(props.traceChunkStoreDiagnostics.readyChunkCount)} / ${formatTraceCount(props.traceChunkStoreDiagnostics.descriptorCount)}`}
                  />
                  <MemoryMetricRow
                    label="Pending chunks"
                    value={formatTraceCount(props.traceChunkStoreDiagnostics.pendingChunkCount)}
                  />
                  <MemoryMetricRow
                    label="Failed chunks"
                    value={formatTraceCount(props.traceChunkStoreDiagnostics.failedChunkCount)}
                  />
                  <MemoryMetricRow
                    label="Active windows"
                    value={formatTraceCount(props.traceChunkStoreDiagnostics.traceWindowCount)}
                  />
                  {props.traceChunkStoreDiagnostics.sourceSpanFilterCount > 0 ? (
                    <MemoryMetricRow
                      label="Source filters"
                      value={`${formatTraceCount(props.traceChunkStoreDiagnostics.sourceSpanFilterCount)} @ ${formatTraceCount(props.traceChunkStoreDiagnostics.sourceSpanFilterRevision)}`}
                    />
                  ) : null}
                </>
              ) : typeof traceChunkStoreReadyChunkCount === 'number' ? (
                <MemoryMetricRow
                  label="Loaded chunks"
                  value={formatTraceCount(traceChunkStoreReadyChunkCount)}
                />
              ) : null}
              {typeof props.traceChunkStoreReadySpanCount === 'number' ? (
                <MemoryMetricRow
                  label="Loaded spans"
                  value={formatTraceCount(props.traceChunkStoreReadySpanCount)}
                />
              ) : null}
              {typeof props.traceChunkStoreObservedHeapDeltaBytes === 'number' ? (
                <MemoryMetricRow
                  label="Observed store heap delta"
                  value={formatTraceSizeBytes(props.traceChunkStoreObservedHeapDeltaBytes)}
                />
              ) : null}
              {typeof props.traceChunkStoreUnattributedHeapDeltaBytes === 'number' ? (
                <MemoryMetricRow
                  label="Unattributed store delta"
                  value={formatTraceSizeBytes(props.traceChunkStoreUnattributedHeapDeltaBytes)}
                />
              ) : null}
              {props.traceChunkStoreSizeReport
                ? getTraceSizeDriverRows(props.traceChunkStoreSizeReport).map(entry => (
                    <MemoryMetricRow
                      key={entry.path}
                      label={formatTraceSizePath(entry.path)}
                      value={formatTraceSizeBytes(entry.bytes)}
                      className="pl-3 text-[11px]"
                    />
                  ))
                : null}
            </div>
          ) : null}
          {props.traceVisualizationWindowSizeReport ? (
            <div className="space-y-1 border-t border-border pt-2">
              <div className="font-medium text-foreground">Visualization window</div>
              <MemoryMetricRow
                label="TraceGraph estimate"
                value={formatTraceSizeBytes(props.traceVisualizationWindowSizeReport.totalBytes)}
              />
            </div>
          ) : null}
          {hasTraceEngineMemory ? (
            <div className="space-y-1 border-t border-border pt-2">
              <div className="font-medium text-foreground">TraceEngine</div>
              {typeof traceEngineRetainedSizeBytes === 'number' ? (
                <MemoryMetricRow
                  label="Retained viewer state"
                  value={formatTraceSizeBytes(traceEngineRetainedSizeBytes)}
                />
              ) : null}
              {typeof traceLayoutSizeBytes === 'number' ? (
                <MemoryMetricRow
                  label="Active TraceLayout"
                  value={formatTraceSizeBytes(traceLayoutSizeBytes)}
                />
              ) : null}
              {typeof traceDeckInputsSizeBytes === 'number' ? (
                <MemoryMetricRow
                  label="Prepared deck inputs"
                  value={formatTraceSizeBytes(traceDeckInputsSizeBytes)}
                />
              ) : null}
              {props.traceEngineDiagnostics ? (
                <>
                  <MemoryMetricRow
                    label="Revision"
                    value={formatTraceCount(props.traceEngineDiagnostics.revision)}
                  />
                  <MemoryMetricRow
                    label="Last update"
                    value={formatTraceEngineReason(props.traceEngineDiagnostics.lastUpdateReason)}
                  />
                  <MemoryMetricRow
                    label="Displayed spans"
                    value={formatTraceCount(props.traceEngineDiagnostics.displayedSpanCount)}
                  />
                  <MemoryMetricRow
                    label="Displayed deps"
                    value={formatTraceCount(
                      props.traceEngineDiagnostics.displayedLocalDependencyCount +
                        props.traceEngineDiagnostics.displayedCrossDependencyCount
                    )}
                  />
                  <MemoryMetricRow
                    label="Selection"
                    value={`${formatTraceCount(props.traceEngineDiagnostics.selectedSpanCount)} selected / ${formatTraceCount(props.traceEngineDiagnostics.focusedSpanCount)} focused`}
                  />
                  <MemoryMetricRow
                    label="Layouts"
                    value={`${formatTraceCount(props.traceEngineDiagnostics.activeLayoutCount)} active / ${formatTraceCount(props.traceEngineDiagnostics.baseLayoutCount)} base / ${formatTraceCount(props.traceEngineDiagnostics.focusedLayoutCount)} focus`}
                  />
                  <MemoryMetricRow
                    label="Prepared rows"
                    value={`${formatTraceCount(props.traceEngineDiagnostics.preparedForegroundRowCount)} fg / ${formatTraceCount(props.traceEngineDiagnostics.preparedOverviewRowCount)} overview`}
                  />
                  <MemoryMetricRow
                    label="Last build"
                    value={formatTraceDurationMs(
                      props.traceEngineDiagnostics.buildPhaseTimings.totalDurationMs
                    )}
                  />
                  {typeof props.traceEngineDiagnostics.retainedSizeEstimateDurationMs ===
                  'number' ? (
                    <MemoryMetricRow
                      label="Size estimate"
                      value={formatTraceDurationMs(
                        props.traceEngineDiagnostics.retainedSizeEstimateDurationMs
                      )}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
            Estimates are bounded retained drivers. JS heap can also include transient parse/build
            garbage and other app allocations.
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Renders one compact label/value row in the heap diagnostics popup. */
function MemoryMetricRow(props: {
  /** Human-readable metric name. */
  label: string;
  /** Formatted metric value. */
  value: string;
  /** Optional extra class names applied to the row. */
  className?: string;
}) {
  return (
    <div className={`flex justify-between gap-4 ${props.className ?? ''}`.trim()}>
      <span className="text-muted-foreground">{props.label}</span>
      <span className="font-medium text-foreground">{props.value}</span>
    </div>
  );
}

/** Returns the faded health color for the used-heap bar. */
function getUsedHeapBarClassName(usedRatio: number): string {
  if (usedRatio >= 0.85) {
    return 'bg-red-500/70';
  }
  if (usedRatio >= 0.7) {
    return 'bg-orange-500/65';
  }
  return 'bg-emerald-500/60';
}

/** Polls browser heap-memory counters when the current browser exposes them. */
function useBrowserHeapMemoryInfo(pollIntervalMs: number): BrowserHeapMemoryInfo | null {
  const [memoryInfo, setMemoryInfo] = useState<BrowserHeapMemoryInfo | null>(null);

  useEffect(() => {
    let isMounted = true;

    const updateMemoryInfo = () => {
      const nextMemoryInfo = getBrowserHeapMemoryInfo();
      if (isMounted) {
        setMemoryInfo(nextMemoryInfo);
      }
    };

    updateMemoryInfo();
    const intervalId = window.setInterval(updateMemoryInfo, Math.max(500, pollIntervalMs));

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [pollIntervalMs]);

  return memoryInfo;
}

/** Reads the browser heap-memory snapshot, returning null when unsupported. */
function getBrowserHeapMemoryInfo(): BrowserHeapMemoryInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const memory = (window.performance as Performance & {memory?: BrowserHeapMemoryInfo}).memory;
  if (!memory || !memory.jsHeapSizeLimit) {
    return null;
  }

  return {
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    totalJSHeapSize: memory.totalJSHeapSize ?? 0,
    usedJSHeapSize: memory.usedJSHeapSize ?? 0
  };
}

/** Clamps a numeric ratio to the closed interval [0, 1]. */
function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

/** Formats byte counts as compact gigabyte labels. */
function formatGigabytesValue(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return '0.0';
  }
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}

/** Inputs retained while collecting one heap diagnostics report. */
type MemoryDiagnosticsParams = {
  /** Why HeapMemoryInfoBar collected this report. */
  trigger: MemoryDiagnosticsTrigger;
  /** Browser heap-memory snapshot, or null when unsupported. */
  memoryInfo: BrowserHeapMemoryInfo | null;
  /** Optional cheap retained-state counters for the active TraceChunkStore. */
  traceChunkStoreDiagnostics: TraceChunkStoreDiagnostics | null;
  /** Optional retained ready-payload estimate for the active TraceChunkStore. */
  traceChunkStoreSizeReport: TraceGraphSizeReport | null;
  /** Optional observed browser heap delta since the active TraceChunkStore baseline. */
  traceChunkStoreObservedHeapDeltaBytes: number | null;
  /** Optional observed heap delta not assigned to payloads or the visible window estimate. */
  traceChunkStoreUnattributedHeapDeltaBytes: number | null;
  /** Optional number of ready chunk payloads retained by the active TraceChunkStore. */
  traceChunkStoreReadyChunkCount: number | null;
  /** Optional number of ready span rows retained by the active TraceChunkStore. */
  traceChunkStoreReadySpanCount: number | null;
  /** Optional retained-size estimate for the active materialized visualization window. */
  traceVisualizationWindowSizeReport: TraceGraphSizeReport | null;
  /** Optional cheap retained-state and build diagnostics for the mounted TraceEngine. */
  traceEngineDiagnostics: TraceEngineDiagnostics | null;
};

/** One formatted console-table row emitted by heap diagnostics. */
type MemorySummaryRow = {
  /** Human-readable metric name. */
  metric: string;
  /** Raw byte count for byte-sized metrics, or null for count/string metrics. */
  bytes: number | null;
  /** Compact formatted metric value. */
  size: string;
};

/** Builds one normalized diagnostics input from an on-demand trace memory report. */
function buildMemoryDiagnosticsParams(params: {
  /** Why HeapMemoryInfoBar collected this report. */
  trigger: MemoryDiagnosticsTrigger;
  /** Browser heap-memory snapshot, or null when unsupported. */
  memoryInfo: BrowserHeapMemoryInfo | null;
  /** On-demand trace memory report, or null when the host has no trace report. */
  traceMemoryReport: TraceMemoryReport | null;
}): MemoryDiagnosticsParams {
  return {
    trigger: params.trigger,
    memoryInfo: params.memoryInfo,
    traceChunkStoreDiagnostics: params.traceMemoryReport?.traceChunkStoreDiagnostics ?? null,
    traceChunkStoreSizeReport: params.traceMemoryReport?.traceChunkStoreSizeReport ?? null,
    traceChunkStoreObservedHeapDeltaBytes:
      params.traceMemoryReport?.traceChunkStoreObservedHeapDeltaBytes ?? null,
    traceChunkStoreUnattributedHeapDeltaBytes:
      params.traceMemoryReport?.traceChunkStoreUnattributedHeapDeltaBytes ?? null,
    traceChunkStoreReadyChunkCount:
      params.traceMemoryReport?.traceChunkStoreReadyChunkCount ?? null,
    traceChunkStoreReadySpanCount: params.traceMemoryReport?.traceChunkStoreReadySpanCount ?? null,
    traceVisualizationWindowSizeReport:
      params.traceMemoryReport?.traceVisualizationWindowSizeReport ??
      params.traceMemoryReport?.traceGraphSizeReport ??
      null,
    traceEngineDiagnostics: params.traceMemoryReport?.traceEngineDiagnostics ?? null
  };
}

/** Logs detailed heap and trace retained-size diagnostics as console tables. */
function logMemoryDiagnostics(params: MemoryDiagnosticsParams): void {
  const summaryRows = buildMemorySummaryRows(params);
  log.probe(0, getMemoryDiagnosticsLogLabel(params.trigger))();
  if (summaryRows.length > 0) {
    log.table(0, summaryRows)();
  }

  logTraceSizeReportDetails('TraceChunkStore payloads', params.traceChunkStoreSizeReport);
  logTraceSizeReportDetails(
    'Visualization window estimate',
    params.traceVisualizationWindowSizeReport
  );
}

/** Returns the console probe label for one heap diagnostics trigger. */
function getMemoryDiagnosticsLogLabel(trigger: MemoryDiagnosticsTrigger): string {
  return trigger === 'heap-watermark'
    ? `HeapMemoryInfoBar heap watermark diagnostics at ${formatTraceSizeBytes(HEAP_MEMORY_DIAGNOSTICS_WATERMARK_BYTES)}`
    : 'HeapMemoryInfoBar hover diagnostics';
}

/** Logs one named trace retained-size report as storage-kind and entry tables. */
function logTraceSizeReportDetails(metric: string, report: TraceGraphSizeReport | null): void {
  if (!report || report.entries.length === 0) {
    return;
  }

  log.table(
    0,
    getTraceSizeKindRows(report).map(row => ({
      metric,
      kind: formatTraceSizeKind(row.kind),
      bytes: row.bytes,
      size: formatTraceSizeBytes(row.bytes)
    }))
  )();
  log.table(
    0,
    report.entries
      .filter(entry => entry.bytes > 0)
      .map(entry => ({
        metric,
        path: entry.path,
        kind: formatTraceSizeKind(entry.kind),
        bytes: entry.bytes,
        size: formatTraceSizeBytes(entry.bytes),
        rowCount: entry.rowCount ?? null,
        columnCount: entry.columnCount ?? null
      }))
  )();
}

/** Builds console-table summary rows for heap and trace retained-size estimates. */
function buildMemorySummaryRows(params: MemoryDiagnosticsParams): MemorySummaryRow[] {
  const rows: MemorySummaryRow[] = [];
  if (params.memoryInfo) {
    rows.push(
      {
        metric: 'JS heap used',
        bytes: params.memoryInfo.usedJSHeapSize,
        size: formatTraceSizeBytes(params.memoryInfo.usedJSHeapSize)
      },
      {
        metric: 'JS heap allocated',
        bytes: params.memoryInfo.totalJSHeapSize,
        size: formatTraceSizeBytes(params.memoryInfo.totalJSHeapSize)
      },
      {
        metric: 'JS heap limit',
        bytes: params.memoryInfo.jsHeapSizeLimit,
        size: formatTraceSizeBytes(params.memoryInfo.jsHeapSizeLimit)
      }
    );
  }
  if (params.traceChunkStoreSizeReport) {
    rows.push({
      metric: 'TraceChunkStore retained payload estimate',
      bytes: params.traceChunkStoreSizeReport.totalBytes,
      size: formatTraceSizeBytes(params.traceChunkStoreSizeReport.totalBytes)
    });
  }
  if (params.traceChunkStoreDiagnostics) {
    rows.push(
      buildMemorySummaryValueRow(
        'TraceChunkStore descriptors',
        formatTraceCount(params.traceChunkStoreDiagnostics.descriptorCount)
      ),
      buildMemorySummaryValueRow(
        'TraceChunkStore loaded chunks',
        `${formatTraceCount(params.traceChunkStoreDiagnostics.readyChunkCount)} / ${formatTraceCount(params.traceChunkStoreDiagnostics.descriptorCount)}`
      ),
      buildMemorySummaryValueRow(
        'TraceChunkStore pending chunks',
        formatTraceCount(params.traceChunkStoreDiagnostics.pendingChunkCount)
      ),
      buildMemorySummaryValueRow(
        'TraceChunkStore failed chunks',
        formatTraceCount(params.traceChunkStoreDiagnostics.failedChunkCount)
      ),
      buildMemorySummaryValueRow(
        'TraceChunkStore active windows',
        formatTraceCount(params.traceChunkStoreDiagnostics.traceWindowCount)
      )
    );
  }
  if (typeof params.traceChunkStoreReadySpanCount === 'number') {
    rows.push(
      buildMemorySummaryValueRow(
        'TraceChunkStore loaded spans',
        formatTraceCount(params.traceChunkStoreReadySpanCount)
      )
    );
  }
  if (typeof params.traceChunkStoreObservedHeapDeltaBytes === 'number') {
    rows.push({
      metric: 'Observed store heap delta',
      bytes: params.traceChunkStoreObservedHeapDeltaBytes,
      size: formatTraceSizeBytes(params.traceChunkStoreObservedHeapDeltaBytes)
    });
  }
  if (typeof params.traceChunkStoreUnattributedHeapDeltaBytes === 'number') {
    rows.push({
      metric: 'Unattributed store delta',
      bytes: params.traceChunkStoreUnattributedHeapDeltaBytes,
      size: formatTraceSizeBytes(params.traceChunkStoreUnattributedHeapDeltaBytes)
    });
  }
  if (params.traceVisualizationWindowSizeReport) {
    rows.push({
      metric: 'Visualization window TraceGraph estimate',
      bytes: params.traceVisualizationWindowSizeReport.totalBytes,
      size: formatTraceSizeBytes(params.traceVisualizationWindowSizeReport.totalBytes)
    });
  }
  const traceEngineRetainedSizeBytes = params.traceEngineDiagnostics?.traceEngineRetainedSizeBytes;
  const traceLayoutSizeBytes = params.traceEngineDiagnostics?.traceLayoutSizeBytes;
  const traceDeckInputsSizeBytes = params.traceEngineDiagnostics?.traceDeckInputsSizeBytes;
  if (typeof traceEngineRetainedSizeBytes === 'number') {
    rows.push({
      metric: 'TraceEngine retained viewer state',
      bytes: traceEngineRetainedSizeBytes,
      size: formatTraceSizeBytes(traceEngineRetainedSizeBytes)
    });
  }
  if (typeof traceLayoutSizeBytes === 'number') {
    rows.push({
      metric: 'TraceEngine active TraceLayout',
      bytes: traceLayoutSizeBytes,
      size: formatTraceSizeBytes(traceLayoutSizeBytes)
    });
  }
  if (typeof traceDeckInputsSizeBytes === 'number') {
    rows.push({
      metric: 'TraceEngine prepared deck inputs',
      bytes: traceDeckInputsSizeBytes,
      size: formatTraceSizeBytes(traceDeckInputsSizeBytes)
    });
  }
  if (params.traceEngineDiagnostics) {
    rows.push(
      buildMemorySummaryValueRow(
        'TraceEngine revision',
        formatTraceCount(params.traceEngineDiagnostics.revision)
      ),
      buildMemorySummaryValueRow(
        'TraceEngine last update',
        formatTraceEngineReason(params.traceEngineDiagnostics.lastUpdateReason)
      ),
      buildMemorySummaryValueRow(
        'TraceEngine displayed spans',
        formatTraceCount(params.traceEngineDiagnostics.displayedSpanCount)
      ),
      buildMemorySummaryValueRow(
        'TraceEngine displayed deps',
        formatTraceCount(
          params.traceEngineDiagnostics.displayedLocalDependencyCount +
            params.traceEngineDiagnostics.displayedCrossDependencyCount
        )
      ),
      buildMemorySummaryValueRow(
        'TraceEngine layouts',
        `${formatTraceCount(params.traceEngineDiagnostics.activeLayoutCount)} active / ${formatTraceCount(params.traceEngineDiagnostics.baseLayoutCount)} base / ${formatTraceCount(params.traceEngineDiagnostics.focusedLayoutCount)} focus`
      ),
      buildMemorySummaryValueRow(
        'TraceEngine prepared rows',
        `${formatTraceCount(params.traceEngineDiagnostics.preparedForegroundRowCount)} fg / ${formatTraceCount(params.traceEngineDiagnostics.preparedOverviewRowCount)} overview`
      ),
      buildMemorySummaryValueRow(
        'TraceEngine last build',
        formatTraceDurationMs(params.traceEngineDiagnostics.buildPhaseTimings.totalDurationMs)
      )
    );
    if (typeof params.traceEngineDiagnostics.retainedSizeEstimateDurationMs === 'number') {
      rows.push(
        buildMemorySummaryValueRow(
          'TraceEngine size estimate',
          formatTraceDurationMs(params.traceEngineDiagnostics.retainedSizeEstimateDurationMs)
        )
      );
    }
  }
  return rows;
}

/** Builds one non-byte console-table summary row. */
function buildMemorySummaryValueRow(metric: string, size: string): MemorySummaryRow {
  return {metric, bytes: null, size};
}

/** Returns non-empty trace size storage-kind rows sorted by descending retained bytes. */
function getTraceSizeKindRows(report: TraceGraphSizeReport): Array<{
  /** Storage category represented by this row. */
  kind: TraceGraphSizeEntry['kind'];
  /** Estimated retained bytes for the storage category. */
  bytes: number;
}> {
  return Object.entries(report.bytesByKind)
    .flatMap(([kind, bytes]) =>
      bytes > 0 ? [{kind: kind as TraceGraphSizeEntry['kind'], bytes}] : []
    )
    .sort((left, right) => right.bytes - left.bytes);
}

/** Returns the largest bounded retained-driver rows shown in the hover popup. */
function getTraceSizeDriverRows(report: TraceGraphSizeReport): TraceGraphSizeEntry[] {
  return report.entries.filter(entry => entry.bytes > 0).slice(0, 4);
}

/** Formats trace graph storage-kind labels for human-readable size breakdowns. */
function formatTraceSizeKind(kind: TraceGraphSizeEntry['kind']): string {
  switch (kind) {
    case 'arrow':
      return 'Arrow buffers';
    case 'map':
      return 'Maps';
    case 'array':
      return 'Arrays';
    case 'object':
      return 'Objects';
    case 'string':
      return 'Strings';
    case 'typed-array':
      return 'Typed arrays';
    case 'primitive':
      return 'Primitives';
  }
}

/** Formats bounded retained-driver paths for human-readable popup labels. */
function formatTraceSizePath(path: string): string {
  switch (path) {
    case 'traceChunkStore.processMetadataSnapshots':
      return 'Process snapshots';
    case 'traceChunkStore.spanSidecarRows':
      return 'Span sidecars';
    case 'traceChunkStore.spanSidecarTables':
      return 'Sidecar Arrow tables';
    case 'traceChunkStore.spanTables':
      return 'Span tables';
    case 'traceChunkStore.localDependencyTables':
      return 'Local dependency tables';
    case 'traceChunkStore.sourceDependencyTables':
      return 'Source dependencies';
    case 'traceChunkStore.rowWindowTables':
      return 'Window ranges';
    case 'traceChunkStore.lookupIndexes':
      return 'Lookup indexes';
    case 'traceChunkStore.processRefs':
      return 'Process refs';
    case 'traceChunkStore.chunkDiagnostics':
      return 'Chunk diagnostics';
    case 'traceChunkStore.chunkMetadata':
      return 'Chunk metadata';
    case 'traceChunkStore.sourceFilterMasks':
      return 'Source filter masks';
    default:
      return path;
  }
}

/** Formats integer trace counts for compact memory surfaces. */
function formatTraceCount(count: number): string {
  return Number.isFinite(count) ? Math.round(count).toLocaleString('en-US') : '0';
}

/** Formats one TraceEngine update reason for compact memory surfaces. */
function formatTraceEngineReason(reason: TraceEngineDiagnostics['lastUpdateReason']): string {
  return reason.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Formats one TraceEngine build duration for compact memory surfaces. */
function formatTraceDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '0 ms';
  }
  return `${durationMs.toLocaleString(undefined, {
    maximumFractionDigits: durationMs < 100 ? 1 : 0
  })} ms`;
}

/** Formats retained trace graph size estimates for compact memory surfaces. */
function formatTraceSizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  if (bytes < 1024) {
    return `${Math.round(bytes).toLocaleString('en-US')} B`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${formatTraceSizeValue(kib)} KB`;
  }

  const mib = kib / 1024;
  if (mib >= 1024) {
    const gib = mib / 1024;
    return `${formatTraceSizeValue(gib)} GB`;
  }
  return `${formatTraceSizeValue(mib)} MB`;
}

/** Formats one positive trace byte unit value with compact useful precision. */
function formatTraceSizeValue(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0
  });
}
