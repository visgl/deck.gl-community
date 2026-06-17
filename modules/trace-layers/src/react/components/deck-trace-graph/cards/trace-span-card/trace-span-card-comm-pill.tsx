import {ArrowDown, ArrowUp} from 'lucide-react';

import {formatTimeMs, pluralize} from '../../../../../trace/index';
import {cn} from '../../../ui';
import {WithTooltip} from '../../../with-tooltip';

import type {ResolvedTraceLabels} from './trace-span-card-types';

/**
 * Props for the compact communication summary pill rendered below TraceSpanCard.
 */
export type TraceSpanCommPillProps = {
  /** Resolved singular and plural labels for the owning trace view. */
  traceLabels: ResolvedTraceLabels;
  /** Communication operation name extracted from span data. */
  operation: string;
  /** Number of processes participating in the communication op. */
  processCount: number;
  /** Active block duration used to derive byte-rate labels. */
  durationMs: number;
  /** Total received bytes, when available. */
  recvBytes: number | null;
  /** Total sent bytes, when available. */
  sendBytes: number | null;
};

/**
 * Render the communication summary pill for spans with byte metadata.
 */
export function TraceSpanCommPill(props: TraceSpanCommPillProps) {
  const durationSec = props.durationMs > 0 ? props.durationMs / 1000 : 0;
  const recvRate =
    durationSec > 0 && typeof props.recvBytes === 'number' ? props.recvBytes / durationSec : null;
  const sendRate =
    durationSec > 0 && typeof props.sendBytes === 'number' ? props.sendBytes / durationSec : null;
  const durationLabel = formatTimeMs(props.durationMs, {space: false, roundDigits: 3});

  return (
    <div className="inline-flex items-center gap-2 leading-none text-foreground">
      🌐 <b>{props.operation}</b> {props.processCount} {pluralize(props.traceLabels.processLabel)}
      <CommPillLane
        direction="recv"
        bytes={props.recvBytes}
        rateBytesPerSec={recvRate}
        durationLabel={durationLabel}
      />
      <CommPillLane
        direction="send"
        bytes={props.sendBytes}
        rateBytesPerSec={sendRate}
        durationLabel={durationLabel}
      />
    </div>
  );
}

/**
 * Render one directional communication lane within the communication pill.
 */
function CommPillLane(props: {
  /** Direction represented by the lane. */
  direction: 'recv' | 'send';
  /** Total bytes transferred in this direction. */
  bytes: number | null;
  /** Transfer rate in bytes per second, when available. */
  rateBytesPerSec: number | null;
  /** Formatted duration label for tooltip copy. */
  durationLabel: string;
}) {
  const isRecv = props.direction === 'recv';
  const Icon = isRecv ? ArrowDown : ArrowUp;
  const accentClass = isRecv
    ? 'dark:text-cyan-200 text-cyan-800'
    : 'dark:text-orange-200 text-orange-800';
  const rate =
    typeof props.rateBytesPerSec === 'number' && props.rateBytesPerSec > 0
      ? formatBytesPerSecCompact(props.rateBytesPerSec)
      : '';
  const summaryTotal = props.bytes === null ? '—' : formatBytesCompact(props.bytes);
  let detailedTotal = props.bytes === null ? '—' : formatBytesDetailed(props.bytes);
  if (rate) {
    detailedTotal += ` (${rate})`;
  }
  detailedTotal += ` over ${props.durationLabel}`;

  return (
    <WithTooltip tooltip={detailedTotal}>
      <div
        className={cn('flex min-w-0 items-center gap-1 overflow-hidden tabular-nums', accentClass)}
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', accentClass)} />
        <span className="shrink-0">{summaryTotal}</span>
        <span className={cn('shrink-0 font-medium', accentClass)}>{rate ? `(${rate})` : '—'}</span>
      </div>
    </WithTooltip>
  );
}

/**
 * Format bytes in a compact engineering style.
 */
function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return `${bytes}`;
  }

  const absBytes = Math.abs(bytes);
  const sign = Math.sign(bytes) < 0 ? '-' : '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let unitIndex = 0;
  let value = absBytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${sign}${value.toFixed(digits)} ${units[unitIndex]}`;
}

/**
 * Format bytes with stable three-decimal precision for tooltips.
 */
function formatBytesDetailed(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return `${bytes}`;
  }

  const absBytes = Math.abs(bytes);
  const sign = Math.sign(bytes) < 0 ? '-' : '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let unitIndex = 0;
  let value = absBytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${sign}${value.toFixed(3)} ${units[unitIndex]}`;
}

/**
 * Format a byte-rate label using the compact byte formatter.
 */
function formatBytesPerSecCompact(bytesPerSec: number): string {
  return `${formatBytesCompact(bytesPerSec)}/s`;
}
