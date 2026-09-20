// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ScatterplotLayer} from '@deck.gl/layers';
import {
  DeckPlayground,
  PlaygroundDataSourceManager,
  ScatterplotLayerSchema
} from '@deck.gl-community/playground';

/** Owns example rows and publishes updates independently of their consumers. */
export function createHostDataSources() {
  let points = {
    data: [
      {id: 'west', position: [-30, 0]},
      {id: 'center', position: [0, 20]},
      {id: 'east', position: [30, 0]}
    ],
    getRowId: (row: {id: string}) => row.id
  };
  const dataSources = new PlaygroundDataSourceManager();
  dataSources.add({dataSourceId: 'points', dataSource: points});
  return {
    dataSources,
    reverseRows() {
      points = {...points, data: [...points.data].reverse()};
      dataSources.add({dataSourceId: 'points', dataSource: points});
    }
  };
}

/** Mounts a playground using a producer that can be shared with other previews. */
export function mountHostBindingsExample(
  container: HTMLElement,
  {dataSources, reverseRows} = createHostDataSources()
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
  root.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;padding:8px">
      <button type="button">Reverse rows</button>
      <button type="button">Reset view</button>
      <output aria-live="polite">Select a point</output>
    </div>
    <div data-preview style="position:relative;flex:1;min-height:0"></div>
  `;
  container.append(root);
  const status = root.querySelector('output')!;
  const [reverseButton, resetButton] = root.querySelectorAll('button');
  const playground = new DeckPlayground({
    parentElement: root.querySelector<HTMLElement>('[data-preview]')!,
    registry: {
      layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
    },
    dataSources,
    templates: {
      Points: {
        views: {'@@type': 'OrthographicView', id: 'plot'},
        initialViewState: {target: [0, 0, 0], zoom: 2},
        layers: [
          {
            '@@type': 'ScatterplotLayer',
            id: 'points',
            data: {'@@data': 'points'},
            getPosition: '@@=position',
            getRadius: 10,
            radiusUnits: 'pixels',
            getFillColor: [40, 120, 220],
            pickable: true
          }
        ]
      }
    },
    onSelect(selection) {
      status.textContent = selection ? `Selected ${selection.rowId}` : 'Select a point';
    },
    onError(error) {
      status.textContent = error.message;
    }
  });
  reverseButton.onclick = reverseRows;
  resetButton.onclick = () => playground.resetView();

  return () => {
    playground.finalize();
    root.remove();
  };
}
