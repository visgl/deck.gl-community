import {ReactNode} from 'react';

import {WithTooltip} from './with-tooltip';

import type {MouseEvent} from 'react';

/** Query lifecycle state used by Tracevis loading indicators. */
export type QueryStatus = {
  /** Whether the query is actively loading. */
  isLoading?: boolean;
  /** Optional React Query-style fetching flag accepted for compatibility. */
  isFetching?: boolean;
  /** Timestamp in milliseconds when loading started. */
  loadStartTimestamp?: number | null;
  /** Timestamp in milliseconds when loading finished. */
  loadEndTimestamp?: number | null;
  /** Error captured for the query, when loading failed. */
  error?: unknown | null;
  /** Warning captured for the query, when loading completed with degraded data. */
  warning?: unknown | null;
  /** Human-readable resource name used in status tooltips. */
  resourceName?: string;
  /** Optional payload retained for compatibility with query libraries. */
  data?: unknown;
};

/** Compact visual states supported by the Tracevis query status glyph. */
export type CompactQueryStatusState = 'loading' | 'success' | 'error' | 'warning';

/** Props for {@link CompactQueryStatus}. */
export type CompactQueryStatusProps = {
  /** Query status used to derive the displayed glyph. */
  queryStatus?: QueryStatus;
  /** Status to display when the query status has not reached a derived terminal state. */
  fallbackStatus?: CompactQueryStatusState;
  /** Optional tooltip shown for successful or fallback statuses. */
  tooltip?: string;
  /** Whether the status glyph should render as a clickable button. */
  interactive?: boolean;
  /** Click handler used when `interactive` is enabled. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Optional class name added to the glyph wrapper. */
  className?: string;
};

const STATUS_TO_SYMBOL: Record<Exclude<CompactQueryStatusState, 'loading'>, ReactNode> = {
  error: '❌',
  success: '✅',
  warning: <span className="text-amber-500">⚠️</span>
};

/**
 * Render a compact loading/success/warning/error status glyph for trace side panels.
 */
export function CompactQueryStatus({
  queryStatus,
  fallbackStatus,
  tooltip,
  interactive,
  onClick,
  className
}: CompactQueryStatusProps) {
  const resolvedStatus = resolveStatus(queryStatus, fallbackStatus);
  if (resolvedStatus === 'loading' && !isQueryLoading(queryStatus)) {
    return null;
  }

  const glyph = renderStatusGlyph({
    className,
    interactive: Boolean(interactive && onClick),
    onClick,
    queryStatus,
    status: resolvedStatus
  });
  const resolvedTooltip = buildTooltip(resolvedStatus, queryStatus, tooltip);

  return resolvedTooltip ? <WithTooltip tooltip={resolvedTooltip}>{glyph}</WithTooltip> : glyph;
}

/**
 * Create an idle query status for one named resource.
 */
export function createQueryStatus(resourceName: string): QueryStatus {
  return {
    error: null,
    isLoading: false,
    loadStartTimestamp: null,
    resourceName,
    warning: null
  };
}

/**
 * Update one query status while preserving load timing fields.
 */
export function updateQueryStatus(
  prev: QueryStatus,
  status: {isLoading: boolean; error?: unknown | null; warning?: unknown | null}
): QueryStatus {
  const error = normalizeError(status.error);
  const warning = normalizeError(status.warning);
  const loadStartTimestamp =
    status.isLoading && !prev.isLoading ? Date.now() : prev.loadStartTimestamp;
  const loadEndTimestamp = !status.isLoading && prev.isLoading ? Date.now() : prev.loadEndTimestamp;

  if (
    status.isLoading === prev.isLoading &&
    error === prev.error &&
    warning === prev.warning &&
    loadStartTimestamp === prev.loadStartTimestamp &&
    loadEndTimestamp === prev.loadEndTimestamp
  ) {
    return prev;
  }

  return {
    ...prev,
    error,
    isLoading: status.isLoading,
    loadEndTimestamp,
    loadStartTimestamp,
    warning
  };
}

/**
 * Create or update one query status for callers that store status lazily.
 */
export function createOrUpdateQueryStatus(
  prev: QueryStatus | undefined,
  status: {isLoading: boolean; error?: unknown | null; warning?: unknown | null},
  resourceName: string
): QueryStatus {
  return updateQueryStatus(prev ?? createQueryStatus(resourceName), status);
}

/**
 * Reset one query status back to the idle state.
 */
export function resetQueryStatus(prev: QueryStatus): QueryStatus {
  return {
    ...prev,
    error: null,
    isLoading: false,
    loadStartTimestamp: null,
    warning: null
  };
}

function resolveStatus(
  queryStatus: QueryStatus | undefined,
  fallbackStatus: CompactQueryStatusState | undefined
): CompactQueryStatusState {
  return deriveStatusFromQuery(queryStatus) ?? fallbackStatus ?? 'loading';
}

function deriveStatusFromQuery(
  queryStatus: QueryStatus | undefined
): CompactQueryStatusState | undefined {
  if (!queryStatus) {
    return undefined;
  }

  if (queryStatus.error) {
    return 'error';
  }

  if (isQueryLoading(queryStatus)) {
    return 'loading';
  }

  if (queryStatus.warning) {
    return 'warning';
  }

  if (isQueryComplete(queryStatus)) {
    return 'success';
  }

  return undefined;
}

function renderStatusGlyph({
  className,
  interactive,
  onClick,
  queryStatus,
  status
}: {
  readonly className?: string;
  readonly interactive: boolean;
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly queryStatus?: QueryStatus;
  readonly status: CompactQueryStatusState;
}): ReactNode {
  const content =
    status === 'loading' ? renderLoadingContent(queryStatus) : STATUS_TO_SYMBOL[status];
  const resolvedClassName = ['inline-flex items-center justify-center', className]
    .filter(Boolean)
    .join(' ');

  if (interactive && onClick) {
    return (
      <button
        type="button"
        className={['pointer-events-auto', resolvedClassName].filter(Boolean).join(' ')}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <span className={resolvedClassName}>{content}</span>;
}

function renderLoadingContent(queryStatus: QueryStatus | undefined): ReactNode {
  const label = queryStatus?.resourceName ? `${queryStatus.resourceName} loading` : 'loading';
  return (
    <span aria-label={label} className="inline-flex items-center justify-center">
      <span aria-hidden="true" className="animate-pulse">
        …
      </span>
      <span className="sr-only">loading</span>
    </span>
  );
}

function buildTooltip(
  status: CompactQueryStatusState,
  queryStatus: QueryStatus | undefined,
  defaultTooltip: string | undefined
): ReactNode | undefined {
  if (!queryStatus) {
    return defaultTooltip;
  }

  const resourceName = queryStatus.resourceName || 'resource';
  switch (status) {
    case 'error':
      return getErrorMessage(queryStatus.error);
    case 'loading':
      return `${resourceName} is loading`;
    case 'success': {
      if (defaultTooltip) {
        return defaultTooltip;
      }
      const loadDurationMs = computeLoadDurationMs(queryStatus);
      return loadDurationMs === null
        ? `${resourceName} loaded`
        : `${resourceName} loaded in ${(loadDurationMs / 1000).toFixed(2)}s`;
    }
    case 'warning':
      return getErrorMessage(queryStatus.warning) || `${resourceName} loaded with warnings`;
  }
}

function isQueryLoading(queryStatus: QueryStatus | undefined): boolean {
  return Boolean(queryStatus?.isLoading || queryStatus?.isFetching);
}

function isQueryComplete(queryStatus: QueryStatus): boolean {
  const {loadEndTimestamp, loadStartTimestamp} = queryStatus;
  return (
    typeof loadStartTimestamp === 'number' &&
    typeof loadEndTimestamp === 'number' &&
    loadEndTimestamp >= loadStartTimestamp
  );
}

function computeLoadDurationMs(queryStatus: QueryStatus): number | null {
  if (!isQueryComplete(queryStatus)) {
    return null;
  }

  return Number(queryStatus.loadEndTimestamp) - Number(queryStatus.loadStartTimestamp);
}

function normalizeError(error: unknown): Error | null {
  if (!error) {
    return null;
  }
  return error instanceof Error ? error : new Error(String(error));
}

function getErrorMessage(error: unknown): string {
  if (!error) {
    return '';
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as {message?: unknown}).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error);
}
