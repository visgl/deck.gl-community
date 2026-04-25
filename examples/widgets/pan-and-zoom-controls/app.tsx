// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {MarkdownPanel} from '@deck.gl-community/panels';
import {BoxWidget, PanWidget, ZoomRangeWidget} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

type PointDatum = {
  position: [number, number];
  color: [number, number, number, number];
};

const INITIAL_VIEW_STATE = {
  target: [0, 0] as [number, number],
  zoom: 0
};

const VIEW = new OrthographicView({id: 'ortho'});

const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%'
} as const;

const POINTS = buildPoints();

export function mountPanAndZoomControlsExample(container: HTMLElement): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  container.replaceChildren(rootElement);

  const deck = new Deck({
    parent: rootElement,
    views: VIEW,
    initialViewState: INITIAL_VIEW_STATE,
    controller: {dragMode: 'pan'},
    layers: [
      new ScatterplotLayer<PointDatum>({
        id: 'points',
        data: POINTS,
        getPosition: (point) => point.position,
        getFillColor: (point) => point.color,
        radiusMinPixels: 4,
        radiusMaxPixels: 12,
        radiusUnits: 'pixels',
        pickable: false
      })
    ],
    widgets: [
      new PanWidget({
        style: {margin: '16px 0 0 16px'}
      }),
      new ZoomRangeWidget({
        style: {margin: '96px 0 0 16px'},
        minZoom: -3,
        maxZoom: 6,
        step: 0.1
      }),
      new BoxWidget({
        id: 'pan-and-zoom-info',
        placement: 'top-right',
        widthPx: 320,
        title: 'Pan & Zoom Widgets',
        panel: new MarkdownPanel({
          id: 'summary',
          title: '',
          markdown: [
            'Use the navigation pad and slider to explore this abstract scatterplot.',
            '',
            "The controls update the view state directly through deck.gl's widget API, making them reusable outside geospatial maps."
          ].join('\n')
        })
      })
    ]
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function buildPoints(): PointDatum[] {
  const points: PointDatum[] = [];
  const size = 10;

  for (let x = -size; x <= size; x++) {
    for (let y = -size; y <= size; y++) {
      const distance = Math.sqrt(x * x + y * y);
      const intensity = Math.max(0, 1 - distance / size);
      points.push({
        position: [x * 20, y * 20],
        color: [255 * intensity, 128 + 80 * intensity, 200, 200]
      });
    }
  }

  return points;
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
