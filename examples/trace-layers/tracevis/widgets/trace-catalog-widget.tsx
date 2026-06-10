/** @jsxImportSource preact */
import {useEffect, useState} from 'preact/hooks';

import {TRACEVIS_EXAMPLE_TRACES} from '../examples/tracevis-examples';

import type {AppState} from '../tracevis-store';
import {Panel} from '@deck.gl-community/trace-layers/react';
import type {JSX} from 'preact';

/**
 * Minimal store contract consumed by the trace-catalog panel.
 */
export type TraceCatalogPanelStore = {
  /** Returns the latest demo application state snapshot. */
  getState: () => AppState;
  /** Subscribes to store updates so the panel can rerender. */
  subscribe: (listener: () => void) => () => void;
};

/**
 * Props accepted by the trace-catalog panel.
 */
export type TraceCatalogPanelProps = {
  /** Demo store used to read uploaded traces and dispatch selection changes. */
  store: TraceCatalogPanelStore;
};

/**
 * Widget panel that manages example and uploaded-trace selection for the demo app.
 */
export class TraceCatalogPanel extends Panel {
  /**
   * Creates a trace-catalog panel bound to the provided demo store.
   */
  constructor(props: TraceCatalogPanelProps) {
    super({
      id: 'tracevis-trace-catalog-panel',
      title: 'Traces',
      content: <TraceCatalogPanelView store={props.store} />
    });
  }
}

/**
 * Renders the example and uploaded-trace management panel.
 */
function TraceCatalogPanelView({store}: TraceCatalogPanelProps) {
  const [state, setState] = useState<AppState>(() => store.getState());

  useEffect(() => store.subscribe(() => setState(store.getState())), [store]);

  const exampleTraceSelectionMap = state.tracevis.exampleTraceSelectionMap;
  const uploadedTraceMetadatas = state.tracevis.uploadedTraceMetadatas;
  const uploadedTraceSelectionMap = state.tracevis.uploadedTraceSelectionMap;
  const selectedExampleTraceIds = TRACEVIS_EXAMPLE_TRACES.map(example => example.traceId).filter(
    traceId => Boolean(exampleTraceSelectionMap[traceId])
  );
  const selectedUploadedTraceIds = uploadedTraceMetadatas
    .map(metadata => metadata.traceId)
    .filter(traceId => Boolean(uploadedTraceSelectionMap[traceId]));
  const traceSelectionOverflowCount = Math.max(
    0,
    selectedExampleTraceIds.length + selectedUploadedTraceIds.length - 2
  );

  return (
    <div style={PANEL_CONTENT_STYLE}>
      <div style={PANEL_HINT_STYLE}>Select up to two traces for side-by-side comparison.</div>
      <section style={SECTION_STYLE}>
        <div style={SECTION_TITLE_STYLE}>Uploaded traces</div>
        <input
          type="file"
          accept=".json,.jsonl,.pb"
          multiple
          style={FILE_INPUT_STYLE}
          onChange={event => {
            const nextFiles = Array.from(event.currentTarget.files ?? []);
            if (nextFiles.length === 0) {
              return;
            }
            void state.tracevis.uploadTraceFiles(nextFiles);
            event.currentTarget.value = '';
          }}
        />
        <div style={TRACE_LIST_STYLE}>
          {uploadedTraceMetadatas.length === 0 ? (
            <div style={EMPTY_STATE_STYLE}>No uploaded traces loaded.</div>
          ) : (
            uploadedTraceMetadatas.map(metadata => (
              <label key={metadata.traceId} style={TRACE_ROW_STYLE}>
                <input
                  type="checkbox"
                  checked={Boolean(uploadedTraceSelectionMap[metadata.traceId])}
                  onChange={event =>
                    state.tracevis.setUploadedTraceSelectionMap({
                      ...state.tracevis.uploadedTraceSelectionMap,
                      [metadata.traceId]: event.currentTarget.checked
                    })
                  }
                />
                <span style={TRACE_TEXT_STYLE}>
                  <span style={TRACE_NAME_STYLE}>{metadata.name}</span>
                  <span style={TRACE_TYPE_STYLE}>{metadata.type}</span>
                </span>
              </label>
            ))
          )}
        </div>
      </section>
      <section style={SECTION_STYLE}>
        <div style={SECTION_TITLE_STYLE}>Examples</div>
        <div style={EXAMPLE_TILE_LIST_STYLE}>
          {TRACEVIS_EXAMPLE_TRACES.map(example => (
            <label key={example.traceId} style={EXAMPLE_TILE_STYLE}>
              <input
                type="checkbox"
                checked={Boolean(exampleTraceSelectionMap[example.traceId])}
                onChange={event =>
                  state.tracevis.setExampleTraceSelectionMap({
                    ...state.tracevis.exampleTraceSelectionMap,
                    [example.traceId]: event.currentTarget.checked
                  })
                }
              />
              <span style={TRACE_TEXT_STYLE}>
                <span style={TRACE_NAME_STYLE}>{example.name}</span>
                <span style={TRACE_TYPE_STYLE}>{example.formatLabel}</span>
                <span style={TRACE_STATS_STYLE}>
                  <span>{formatCatalogStat(example.stats.processCount, 'process')}</span>
                  <span>{formatCatalogStat(example.stats.threadCount, 'thread')}</span>
                  <span>{formatCatalogStat(example.stats.spanCount, 'span')}</span>
                  <span>{formatCatalogStat(example.stats.dependencyCount, 'dependency')}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>
      {traceSelectionOverflowCount > 0 ? (
        <div style={OVERFLOW_MESSAGE_STYLE}>
          Only the first two selected traces render. Deselect {traceSelectionOverflowCount} extra{' '}
          {traceSelectionOverflowCount === 1 ? 'trace' : 'traces'} to compare a different pair.
        </div>
      ) : null}
    </div>
  );
}

/** Formats one compact trace-catalog statistic with a correctly pluralized label. */
function formatCatalogStat(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

const PANEL_CONTENT_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px'
};

const FILE_INPUT_STYLE: JSX.CSSProperties = {
  width: '100%',
  fontSize: '12px'
};

const PANEL_HINT_STYLE: JSX.CSSProperties = {
  fontSize: '11px',
  opacity: 0.8
};

const SECTION_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const SECTION_TITLE_STYLE: JSX.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0',
  opacity: 0.72
};

const EXAMPLE_TILE_LIST_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const EXAMPLE_TILE_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '16px minmax(0, 1fr)',
  gap: '8px',
  alignItems: 'start',
  border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '12px',
  padding: '8px'
};

const TRACE_LIST_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px'
};

const EMPTY_STATE_STYLE: JSX.CSSProperties = {
  fontSize: '12px',
  opacity: 0.8
};

const TRACE_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '16px minmax(0, 1fr)',
  gap: '8px',
  alignItems: 'start',
  fontSize: '12px',
  padding: '6px 0'
};

const TRACE_TEXT_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column'
};

const TRACE_NAME_STYLE: JSX.CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
};

const TRACE_TYPE_STYLE: JSX.CSSProperties = {
  opacity: 0.7
};

const TRACE_STATS_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '2px 8px',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  lineHeight: 1.35,
  marginTop: '4px',
  opacity: 0.82
};

const OVERFLOW_MESSAGE_STYLE: JSX.CSSProperties = {
  fontSize: '11px',
  color: '#b45309'
};
