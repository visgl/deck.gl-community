// deck.gl-community
// SPDX-License-Identifier: MIT
import {Deck} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {tableFromJSON} from 'apache-arrow';
import {expect, test, vi} from 'vitest';
import {DeckPlayground} from '../src/deck-playground';
import {PlaygroundDataSourceManager} from '../src/runtime/playground-data-source-manager';
import {createPlaygroundSQLProvider, PlaygroundSQLTableCatalog} from '../src/sql';

test('live SQL preserves the accepted preview on errors and recovers on valid table changes', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:900px;height:550px';
  document.body.append(host);
  const catalog = new PlaygroundSQLTableCatalog();
  catalog.setTable('points', tableFromJSON([{id: 'a', value: 2, position: [1, 2]}]));
  const manager = new PlaygroundDataSourceManager({
    queryProvider: createPlaygroundSQLProvider({...catalog, rowIdColumn: 'id'})
  });
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const onError = vi.fn();
  const documentFor = (sql: string) => ({
    sources: {filtered: {'@@sql': sql, parameters: {minimum: 2}}},
    views: {'@@type': 'OrthographicView'},
    initialViewState: {target: [0, 0, 0], zoom: 1},
    layers: [
      {
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: 'datasource://filtered',
        getPosition: '@@=position',
        getRadius: 5
      }
    ]
  });
  const valid = 'SELECT * FROM points WHERE value >= :minimum ORDER BY value DESC';
  const playground = new DeckPlayground({
    parentElement: host,
    registry: {layers: {ScatterplotLayer}},
    dataSources: manager,
    templates: {SQL: documentFor(valid)},
    onError
  });
  const layer = () => {
    const deck = setProps.mock.contexts.at(-1) as Deck;
    return (deck.props.layers as ScatterplotLayer[])[0];
  };
  try {
    await vi.waitFor(
      () => expect(layer()?.props.data).toEqual([{id: 'a', value: 2, position: [1, 2]}]),
      {timeout: 10000}
    );
    const canvas = host.querySelector('canvas');
    const accepted = layer().props.data;
    playground.setText(JSON.stringify(documentFor('SELECT absent FROM points')));
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(layer().props.data).toBe(accepted);
    playground.setText(JSON.stringify(documentFor(valid)));
    await vi.waitFor(() => expect(manager.listDataSources()[0].status).toBe('ready'));
    catalog.setTable('points', tableFromJSON([{id: 'b', value: 3, position: [3, 4]}]));
    await vi.waitFor(() =>
      expect(layer().props.data).toEqual([{id: 'b', value: 3, position: [3, 4]}])
    );
    catalog.removeTable('points');
    await vi.waitFor(() => expect(manager.listDataSources()[0].status).toBe('error'));
    expect(layer().props.data).toEqual([{id: 'b', value: 3, position: [3, 4]}]);
    catalog.setTable('points', tableFromJSON([{id: 'c', value: 4, position: [5, 6]}]));
    await vi.waitFor(() =>
      expect(layer().props.data).toEqual([{id: 'c', value: 4, position: [5, 6]}])
    );
    const inline = documentFor(valid);
    inline.sources = undefined as any;
    inline.layers[0].data = 'SELECT * FROM points WHERE value >= 2 ORDER BY value DESC';
    playground.setText(JSON.stringify(inline));
    await vi.waitFor(() =>
      expect(layer().props.data).toEqual([{id: 'c', value: 4, position: [5, 6]}])
    );
    expect(host.querySelector('canvas')).toBe(canvas);
  } finally {
    playground.finalize();
    await manager.finalize();
    catalog.finalize();
    host.remove();
    setProps.mockRestore();
  }
});
