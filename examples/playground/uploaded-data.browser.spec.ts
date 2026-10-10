import {Deck} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
/** @jsxImportSource preact */
import {render} from 'preact';
import {tableFromArrays, tableToIPC} from 'apache-arrow';
import {afterEach, expect, test, vi} from 'vitest';
import {DeckPlayground, PlaygroundDataSourceManager} from '@deck.gl-community/playground';
import {loadUploadedData} from './uploaded-data';
import {UploadedSources, createDataSourcesPanel} from './data-sources-panel';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

test('JSON and CSV imports retain Arrow tables with plain nested rows for deck.gl', async () => {
  const rows = [
    {position: [1, 2], info: {name: 'One'}, value: 7},
    {position: [3, 4], info: {name: 'Two'}, value: 9}
  ];
  const json = await loadUploadedData(new File([JSON.stringify(rows)], 'points.json'));
  expect(json.table.numRows).toBe(2);
  expect(json.data).toEqual(rows);
  const csv = await loadUploadedData(new File(['x,y,label\n1,2,One\n3,4,Two'], 'points.csv'));
  expect(csv.table.numRows).toBe(2);
  expect(csv.data).toEqual([
    {x: 1, y: 2, label: 'One'},
    {x: 3, y: 4, label: 'Two'}
  ]);
});

test('Arrow IPC retains its schema and adapts list values without JSON coercion', async () => {
  const table = tableFromArrays({
    position: [
      [1, 2],
      [3, 4]
    ],
    id: [1n, 2n]
  });
  const value = await loadUploadedData(
    new File([tableToIPC(table) as Uint8Array<ArrayBuffer>], 'points.arrow')
  );
  expect(value.table.schema.fields.map(field => field.name)).toEqual(['position', 'id']);
  expect(value.data).toEqual([
    {position: [1, 2], id: 1n},
    {position: [3, 4], id: 2n}
  ]);
});

test('GeoJSON uses lossless Arrow feature rows and restores geometry, properties, and foreign members', async () => {
  const features = [
    {
      type: 'Feature',
      id: 3,
      geometry: {type: 'Point', coordinates: [1, 2]},
      properties: {label: 'A'},
      extra: 'kept'
    },
    {type: 'Feature', geometry: null, properties: null}
  ];
  const value = await loadUploadedData(
    new File([JSON.stringify({type: 'FeatureCollection', features})], 'shapes.geojson')
  );
  expect(value.table.numRows).toBe(2);
  expect(value.data).toEqual(features);
  const empty = await loadUploadedData(new File(['[]'], 'empty.json'));
  expect(empty.table.numRows).toBe(0);
  expect(empty.data).toEqual([]);
});

test('upload state assigns unique IDs, reports invalid files, and stops registrations after teardown', async () => {
  const manager = new PlaygroundDataSourceManager();
  const sources = new UploadedSources(manager);
  cleanups.push(() => {
    sources.finalize();
    void manager.finalize();
  });
  await sources.upload([
    new File(['[{"value":1}]'], 'points.json'),
    new File(['[{"value":2}]'], 'points.json'),
    new File(['invalid'], 'broken.json')
  ]);
  expect(sources.entries.map(entry => [entry.id, entry.status])).toEqual([
    ['points', 'ready'],
    ['points-2', 'ready'],
    ['broken', 'error']
  ]);
  expect(manager.listDataSources().map(entry => entry.dataSourceId)).toEqual([
    'points',
    'points-2'
  ]);
  const late = sources.upload([new File(['[]'], 'late.json')]);
  sources.finalize();
  await late;
  expect(manager.contains('late')).toBe(false);
});

test('composed panel shows upload controls, source references, and existing Arrow inspectors across remounts', async () => {
  const manager = new PlaygroundDataSourceManager();
  const sources = new UploadedSources(manager);
  const root = document.createElement('div');
  document.body.append(root);
  cleanups.push(() => {
    render(null, root);
    root.remove();
    sources.finalize();
    void manager.finalize();
  });
  const panel = createDataSourcesPanel(sources);
  render(panel.content, root);
  expect(root.querySelector('input[type=url]')).toBeNull();
  const transfer = new DataTransfer();
  transfer.items.add(new File(['[{"value":42}]'], 'sample.json'));
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', {bubbles: true}));
  await vi.waitFor(() => expect(root.textContent).toContain('JSON: 1 rows'));
  expect(root.querySelector<HTMLInputElement>('[aria-label="Source URL reference"]')!.value).toBe(
    'datasource://sample'
  );
  expect(root.querySelector('[data-arrow-table-panel]')).not.toBeNull();
  const buttons = () => Array.from(root.querySelectorAll('button'));
  buttons()
    .find(button => button.textContent === 'Schema')!
    .click();
  await vi.waitFor(() => expect(root.querySelector('[data-arrow-schema-panel]')).not.toBeNull());
  buttons()
    .find(button => button.textContent === 'Batches')!
    .click();
  await vi.waitFor(() => expect(root.querySelector('[data-arrow-batches-panel]')).not.toBeNull());
  render(null, root);
  render(panel.content, root);
  expect(root.textContent).toContain('sample.json');
});

test('uploaded source URLs refresh a persistent preview and survive template changes', async () => {
  const manager = new PlaygroundDataSourceManager();
  const uploads = new UploadedSources(manager);
  const host = document.createElement('div');
  host.style.cssText = 'width:900px;height:550px';
  document.body.append(host);
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const initial = {
    views: {'@@type': 'OrthographicView'},
    initialViewState: {target: [0, 0, 0], zoom: 1},
    layers: [
      {
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: [{position: [0, 0]}],
        getPosition: '@@=position'
      }
    ]
  };
  const playground = new DeckPlayground({
    parentElement: host,
    registry: {layers: {ScatterplotLayer}},
    templates: {Initial: initial, Other: initial},
    dataSources: manager,
    panels: [createDataSourcesPanel(uploads)],
    onError: vi.fn()
  });
  cleanups.push(() => {
    uploads.finalize();
    playground.finalize();
    void manager.finalize();
    host.remove();
    setProps.mockRestore();
  });
  await vi.waitFor(() => expect(host.querySelector('canvas')).not.toBeNull());
  const canvas = host.querySelector('canvas');
  const deck = setProps.mock.contexts[0] as Deck;
  const before = deck.props.layers;
  playground.setText(
    JSON.stringify({...initial, layers: [{...initial.layers[0], data: 'datasource://uploaded'}]})
  );
  expect(deck.props.layers).toBe(before);
  const tab = Array.from(host.querySelectorAll('button')).find(
    button => button.textContent === 'Data Sources'
  )!;
  tab.click();
  await vi.waitFor(() => expect(host.querySelector('input[type=file]')).not.toBeNull());
  const transfer = new DataTransfer();
  transfer.items.add(new File(['[{"position":[1,2]}]'], 'uploaded.json'));
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', {bubbles: true}));
  await vi.waitFor(() =>
    expect((deck.props.layers as ScatterplotLayer[])[0].props.data).toEqual([{position: [1, 2]}])
  );
  expect(host.querySelector('canvas')).toBe(canvas);
  playground.setTemplate('Other');
  expect(manager.contains('uploaded')).toBe(true);
  playground.setText(
    JSON.stringify({...initial, layers: [{...initial.layers[0], data: 'datasource://uploaded'}]})
  );
  expect((deck.props.layers as ScatterplotLayer[])[0].props.data).toEqual([{position: [1, 2]}]);
  expect(host.querySelector('canvas')).toBe(canvas);
});
