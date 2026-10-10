/** @jsxImportSource preact */
// deck.gl-community
// SPDX-License-Identifier: MIT
import {useLayoutEffect, useState} from 'preact/hooks';
import {
  Panel,
  SourcePickerPanel,
  ArrowTablePanel,
  ArrowSchemaPanel,
  ArrowBatchesPanel,
  TabbedPanel
} from '@deck.gl-community/panels';
import {PlaygroundDataSourceManager} from '@deck.gl-community/playground';
import {loadUploadedData, type UploadedData} from './uploaded-data';

type SourceEntry = {
  id: string;
  filename: string;
  /** Unique table name, also used as the datasource URL identifier. */
  tableName: string;
  status: 'loading' | 'ready' | 'error';
  value?: UploadedData;
  error?: string;
};

/** Page-owned upload state that survives sidebar and template changes. */
export class UploadedSources {
  entries: SourceEntry[] = [];
  private listeners = new Set<() => void>();
  private active = true;
  constructor(readonly manager: PlaygroundDataSourceManager) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
  /** Registers each successful import under a collision-free source ID. */
  async upload(files: ReadonlyArray<File>): Promise<void> {
    if (!this.active) return;
    await Promise.all(
      files.map(async file => {
        const base =
          file.name
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'source';
        let id = base;
        let suffix = 2;
        const existing = new Set(
          this.manager
            .listDataSources()
            .filter(entry => entry.status !== 'placeholder')
            .map(entry => entry.dataSourceId)
        );
        while (existing.has(id) || this.entries.some(entry => entry.id === id))
          id = `${base}-${suffix++}`;
        const entry: SourceEntry = {id, tableName: id, filename: file.name, status: 'loading'};
        this.entries.push(entry);
        this.notify();
        try {
          const value = await loadUploadedData(file);
          if (!this.active) return;
          this.manager.add({dataSourceId: id, dataSource: value});
          entry.value = value;
          entry.status = 'ready';
        } catch (error) {
          if (!this.active) return;
          entry.status = 'error';
          entry.error = error instanceof Error ? error.message : String(error);
        }
        this.notify();
      })
    );
  }
  /** Stops late import completions from publishing after page teardown. */
  finalize(): void {
    this.active = false;
    this.listeners.clear();
    this.entries = [];
  }
}

/** Composes uploads and existing Arrow inspectors as one additional playground tab. */
export function createDataSourcesPanel(sources: UploadedSources): Panel {
  return new (class extends Panel {})({
    id: 'data-sources',
    title: 'Data Sources',
    keepMounted: true,
    content: <DataSourcesContent sources={sources} />
  });
}

function DataSourcesContent({sources}: {sources: UploadedSources}) {
  const [, refresh] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  useLayoutEffect(() => sources.subscribe(() => refresh(value => value + 1)), [sources]);
  const picker = new SourcePickerPanel({
    id: 'uploaded-files',
    title: 'Upload data',
    accept: '.json,.geojson,.csv,.arrow,.feather,.ipc',
    multiple: true,
    showUrlInput: false,
    onLoadUrl() {},
    onSelectFiles: files => {
      void sources.upload(files);
    }
  });
  const selected = sources.entries.find(entry => entry.id === selectedId) ?? sources.entries[0];
  const inspectors = selected?.value
    ? new TabbedPanel({
        panels: [
          new ArrowTablePanel({
            id: 'rows',
            title: 'Rows',
            table: selected.value.table,
            maxRows: 100,
            maxColumns: 20
          }),
          new ArrowSchemaPanel({
            id: 'schema',
            title: 'Schema',
            schema: selected.value.table.schema
          }),
          new ArrowBatchesPanel({id: 'batches', title: 'Batches', table: selected.value.table})
        ]
      })
    : undefined;
  return (
    <div style={{display: 'grid', gap: '12px'}}>
      <p>
        Files stay in this page until it closes or reloads. In a layer’s data property, use
        datasource://table_name or SELECT * FROM table_name; to load all rows.
      </p>
      {picker.content}
      <label style={{display: 'grid', gap: '4px'}}>
        Uploaded source
        <select
          aria-label="Uploaded source"
          disabled={!sources.entries.length}
          style={{width: '100%'}}
          value={selected?.id ?? ''}
          onChange={event => setSelectedId(event.currentTarget.value)}
        >
          {sources.entries.map(entry => (
            <option key={entry.id} value={entry.id}>
              {entry.tableName} ({entry.filename}) — {entry.status}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <>
          <label style={{display: 'grid', gap: '4px'}}>
            Table name
            <input
              aria-label="Table name"
              style={{width: '100%', boxSizing: 'border-box'}}
              readOnly
              value={selected.tableName}
              onFocus={event => event.currentTarget.select()}
            />
          </label>
          <label style={{display: 'grid', gap: '4px'}}>
            Source URL
            <input
              aria-label="Source URL reference"
              style={{width: '100%', boxSizing: 'border-box'}}
              readOnly
              value={`datasource://${selected.id}`}
              onFocus={event => event.currentTarget.select()}
            />
          </label>
          <label style={{display: 'grid', gap: '4px'}}>
            Table query (alternative to Source URL)
            <input
              aria-label="Table query reference"
              style={{width: '100%', boxSizing: 'border-box'}}
              readOnly
              value={`SELECT * FROM ${selected.tableName};`}
              onFocus={event => event.currentTarget.select()}
            />
          </label>
          <output aria-live="polite">
            {selected.error ??
              (selected.value
                ? `${selected.value.format}: ${selected.value.table.numRows} rows`
                : 'Loading…')}
          </output>
          {inspectors?.content}
        </>
      ) : (
        <p>No files uploaded yet.</p>
      )}
    </div>
  );
}
