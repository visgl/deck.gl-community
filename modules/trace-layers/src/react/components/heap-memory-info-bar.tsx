import {useCallback, useEffect, useState} from 'react';

import {log} from '../../trace/log';
import {WithTooltip} from './with-tooltip';

import type {TraceGraphSizeEntry, TraceGraphSizeReport} from '../../trace/index';

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
  /** Builds the expensive Tracevis-owned retained-size report on demand. */
  buildTraceMemoryReport?: () => TraceMemoryReport | null;
  /** Optional class name added to the compact memory bar root. */
  className?: string;
};

/** On-demand Tracevis-owned retained-size report shown in memory diagnostics. */
export type TraceMemoryReport = {
  /** Optional trace graph size report to include in the hover popup. */
  traceGraphSizeReport?: TraceGraphSizeReport | null;
  /** Optional estimated retained TraceViewState byte size to include in memory diagnostics. */
  traceViewStateSizeBytes?: number | null;
  /** Optional estimated retained TraceLayout byte size to include in memory diagnostics. */
  traceLayoutSizeBytes?: number | null;
  /** Optional estimated retained prepared deck input byte size to include in memory diagnostics. */
  traceDeckInputsSizeBytes?: number | null;
};

const DEFAULT_MEMORY_POLL_MS = 2000;

/**
 * Shows a compact JavaScript heap-usage bar for tracevis diagnostics with a memory-detail popup.
 */
export function HeapMemoryInfoBar({
  buildTraceMemoryReport,
  className = ''
}: HeapMemoryInfoBarProps = {}) {
  const memoryInfo = useBrowserHeapMemoryInfo(DEFAULT_MEMORY_POLL_MS);
  const [traceMemoryReport, setTraceMemoryReport] = useState<TraceMemoryReport | null>(null);
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
  const handleMouseEnter = useCallback(() => {
    const nextTraceMemoryReport = buildTraceMemoryReport?.() ?? null;
    setTraceMemoryReport(nextTraceMemoryReport);
    logMemoryDiagnostics({
      memoryInfo,
      traceGraphSizeReport: nextTraceMemoryReport?.traceGraphSizeReport ?? null,
      traceViewStateSizeBytes: nextTraceMemoryReport?.traceViewStateSizeBytes ?? null,
      traceLayoutSizeBytes: nextTraceMemoryReport?.traceLayoutSizeBytes ?? null,
      traceDeckInputsSizeBytes: nextTraceMemoryReport?.traceDeckInputsSizeBytes ?? null
    });
  }, [buildTraceMemoryReport, memoryInfo]);

  return (
    <WithTooltip
      tooltip={
        <HeapMemoryInfoTooltip
          memoryInfo={memoryInfo}
          traceGraphSizeReport={traceMemoryReport?.traceGraphSizeReport ?? null}
          traceViewStateSizeBytes={traceMemoryReport?.traceViewStateSizeBytes ?? null}
          traceLayoutSizeBytes={traceMemoryReport?.traceLayoutSizeBytes ?? null}
          traceDeckInputsSizeBytes={traceMemoryReport?.traceDeckInputsSizeBytes ?? null}
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
  /** Optional trace graph size report to include in the popup. */
  traceGraphSizeReport: TraceGraphSizeReport | null;
  /** Optional estimated retained TraceViewState byte size to include in the popup. */
  traceViewStateSizeBytes: number | null;
  /** Optional estimated retained TraceLayout byte size to include in the popup. */
  traceLayoutSizeBytes: number | null;
  /** Optional estimated retained prepared deck input byte size to include in the popup. */
  traceDeckInputsSizeBytes: number | null;
}) {
  const traceGraphSizeReport = props.traceGraphSizeReport;
  const hasTraceMemory =
    traceGraphSizeReport != null ||
    (typeof props.traceViewStateSizeBytes === 'number' && props.traceViewStateSizeBytes > 0) ||
    (typeof props.traceLayoutSizeBytes === 'number' && props.traceLayoutSizeBytes > 0) ||
    (typeof props.traceDeckInputsSizeBytes === 'number' && props.traceDeckInputsSizeBytes > 0);

  return (
    <div className="w-72 space-y-2 text-xs">
      <div className="font-medium text-foreground">Memory</div>
      {props.memoryInfo ? (
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">JS heap used</span>
            <span className="font-medium text-foreground">
              {formatGigabytesValue(props.memoryInfo.usedJSHeapSize)} GB
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">JS heap allocated</span>
            <span className="font-medium text-foreground">
              {formatGigabytesValue(props.memoryInfo.totalJSHeapSize)} GB
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">JS heap limit</span>
            <span className="font-medium text-foreground">
              {formatGigabytesValue(props.memoryInfo.jsHeapSizeLimit)} GB
            </span>
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground">JS heap usage is unavailable in this browser.</div>
      )}
      {hasTraceMemory ? (
        <div className="space-y-1 border-t border-border pt-2">
          <div className="font-medium text-foreground">Tracevis-owned memory</div>
          {traceGraphSizeReport ? (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">TraceGraph retained</span>
              <span className="font-medium text-foreground">
                {formatTraceSizeBytes(traceGraphSizeReport.totalBytes)}
              </span>
            </div>
          ) : null}
          {typeof props.traceViewStateSizeBytes === 'number' &&
          props.traceViewStateSizeBytes > 0 ? (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">TraceViewState retained</span>
              <span className="font-medium text-foreground">
                {formatTraceSizeBytes(props.traceViewStateSizeBytes)}
              </span>
            </div>
          ) : null}
          {typeof props.traceLayoutSizeBytes === 'number' && props.traceLayoutSizeBytes > 0 ? (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">TraceLayout retained</span>
              <span className="font-medium text-foreground">
                {formatTraceSizeBytes(props.traceLayoutSizeBytes)}
              </span>
            </div>
          ) : null}
          {typeof props.traceDeckInputsSizeBytes === 'number' &&
          props.traceDeckInputsSizeBytes > 0 ? (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Prepared deck inputs</span>
              <span className="font-medium text-foreground">
                {formatTraceSizeBytes(props.traceDeckInputsSizeBytes)}
              </span>
            </div>
          ) : null}
          {traceGraphSizeReport ? (
            <div className="text-[11px] text-muted-foreground">
              Detailed TraceGraph tables are logged to the console on hover.
            </div>
          ) : null}
        </div>
      ) : null}
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

/** Logs detailed heap and trace retained-size diagnostics as console tables. */
function logMemoryDiagnostics(params: {
  /** Browser heap-memory snapshot, or null when unsupported. */
  memoryInfo: BrowserHeapMemoryInfo | null;
  /** Optional trace graph retained-size report. */
  traceGraphSizeReport: TraceGraphSizeReport | null;
  /** Optional estimated retained TraceViewState byte size. */
  traceViewStateSizeBytes: number | null;
  /** Optional estimated retained TraceLayout byte size. */
  traceLayoutSizeBytes: number | null;
  /** Optional estimated retained prepared deck input byte size. */
  traceDeckInputsSizeBytes: number | null;
}): void {
  const summaryRows = buildMemorySummaryRows(params);
  log.probe(0, 'HeapMemoryInfoBar hover diagnostics')();
  if (summaryRows.length > 0) {
    log.table(0, summaryRows)();
  }

  const traceGraphSizeReport = params.traceGraphSizeReport;
  if (!traceGraphSizeReport) {
    return;
  }

  log.table(
    0,
    getTraceSizeKindRows(traceGraphSizeReport).map(row => ({
      kind: formatTraceSizeKind(row.kind),
      bytes: row.bytes,
      size: formatTraceSizeBytes(row.bytes)
    }))
  )();
  log.table(
    0,
    traceGraphSizeReport.entries
      .filter(entry => entry.bytes > 0)
      .map(entry => ({
        path: entry.path,
        kind: formatTraceSizeKind(entry.kind),
        bytes: entry.bytes,
        size: formatTraceSizeBytes(entry.bytes),
        rowCount: entry.rowCount ?? null,
        columnCount: entry.columnCount ?? null
      }))
  )();
}

/** Builds console-table summary rows for heap, TraceGraph, and TraceLayout memory. */
function buildMemorySummaryRows(params: {
  /** Browser heap-memory snapshot, or null when unsupported. */
  memoryInfo: BrowserHeapMemoryInfo | null;
  /** Optional trace graph retained-size report. */
  traceGraphSizeReport: TraceGraphSizeReport | null;
  /** Optional estimated retained TraceViewState byte size. */
  traceViewStateSizeBytes: number | null;
  /** Optional estimated retained TraceLayout byte size. */
  traceLayoutSizeBytes: number | null;
  /** Optional estimated retained prepared deck input byte size. */
  traceDeckInputsSizeBytes: number | null;
}): Array<{metric: string; bytes: number; size: string}> {
  const rows: Array<{metric: string; bytes: number; size: string}> = [];
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
  if (params.traceGraphSizeReport) {
    rows.push({
      metric: 'TraceGraph retained',
      bytes: params.traceGraphSizeReport.totalBytes,
      size: formatTraceSizeBytes(params.traceGraphSizeReport.totalBytes)
    });
  }
  if (typeof params.traceViewStateSizeBytes === 'number' && params.traceViewStateSizeBytes > 0) {
    rows.push({
      metric: 'TraceViewState retained',
      bytes: params.traceViewStateSizeBytes,
      size: formatTraceSizeBytes(params.traceViewStateSizeBytes)
    });
  }
  if (typeof params.traceLayoutSizeBytes === 'number' && params.traceLayoutSizeBytes > 0) {
    rows.push({
      metric: 'TraceLayout retained',
      bytes: params.traceLayoutSizeBytes,
      size: formatTraceSizeBytes(params.traceLayoutSizeBytes)
    });
  }
  if (typeof params.traceDeckInputsSizeBytes === 'number' && params.traceDeckInputsSizeBytes > 0) {
    rows.push({
      metric: 'Prepared deck inputs',
      bytes: params.traceDeckInputsSizeBytes,
      size: formatTraceSizeBytes(params.traceDeckInputsSizeBytes)
    });
  }
  return rows;
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

/** Formats retained trace graph size estimates for compact memory surfaces. */
function formatTraceSizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB';
  }

  const mib = bytes / (1024 * 1024);
  return `${mib.toLocaleString(undefined, {
    maximumFractionDigits: mib < 10 ? 1 : 0
  })} MB`;
}
