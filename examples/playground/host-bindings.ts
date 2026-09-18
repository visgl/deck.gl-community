// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ScatterplotLayer} from '@deck.gl/layers';
import {
  DeckPlayground,
  PlaygroundDataSourceRegistry,
  ScatterplotLayerSchema
} from '@deck.gl-community/playground';

type PointRow = {id: string; position: [number, number]};

const POINTS: PointRow[] = [
  {id: 'west', position: [-30, 0]},
  {id: 'center', position: [0, 20]},
  {id: 'east', position: [30, 0]}
];

/** Registers example rows independently of any playground that consumes them. */
export function createHostDataSources(): PlaygroundDataSourceRegistry {
  const dataSources = new PlaygroundDataSourceRegistry();
  dataSources.register('points', {
    data: POINTS,
    getRowId: (row: PointRow) => row.id
  });
  return dataSources;
}

/** Mounts a playground using a source registry that can be shared with other previews. */
export function mountHostBindingsExample(
  container: HTMLElement,
  dataSources = createHostDataSources()
): () => void {
  const document = container.ownerDocument;
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:12px;align-items:center;padding:8px';
  const replaceButton = document.createElement('button');
  replaceButton.type = 'button';
  replaceButton.textContent = 'Reverse rows';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset view';
  const status = document.createElement('output');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Select a point';
  const previewHost = document.createElement('div');
  previewHost.style.cssText = 'position:relative;flex:1;min-height:0';
  toolbar.append(replaceButton, resetButton, status);
  root.append(toolbar, previewHost);
  container.append(root);

  const playground = new DeckPlayground({
    parentElement: previewHost,
    registry: {
      layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
    },
    dataSources,
    templates: {
      Points: {
        views: {'@@type': 'OrthographicView', id: 'plot'},
        controller: true,
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

  const reverseRows = () => {
    const points = dataSources.get('points');
    if (points) {
      dataSources.register('points', {...points, data: [...points.data].reverse()});
    }
  };
  const resetView = () => playground.resetView();
  replaceButton.addEventListener('click', reverseRows);
  resetButton.addEventListener('click', resetView);

  return () => {
    replaceButton.removeEventListener('click', reverseRows);
    resetButton.removeEventListener('click', resetView);
    playground.finalize();
    // Registered sources remain available to other previews sharing this registry.
    root.remove();
  };
}
