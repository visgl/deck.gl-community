// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {Playground, type PlaygroundTemplate} from '@deck.gl-community/playground';

type PlaygroundDocument = {
  initialViewState: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
  points: Array<{position: [number, number]; color: [number, number, number]; radius: number}>;
};

const TEMPLATES: Record<string, PlaygroundTemplate> = {
  'Hello world': {
    initialViewState: {latitude: 37.78, longitude: -122.42, zoom: 11},
    points: [
      {position: [-122.42, 37.78], color: [255, 80, 80], radius: 800},
      {position: [-122.45, 37.76], color: [80, 160, 255], radius: 500},
      {position: [-122.4, 37.8], color: [80, 220, 140], radius: 650}
    ]
  },
  'Many points': {
    initialViewState: {latitude: 37.78, longitude: -122.42, zoom: 10},
    points: Array.from({length: 20}, (_, index) => ({
      position: [-122.52 + (index % 5) * 0.05, 37.68 + Math.floor(index / 5) * 0.06] as [
        number,
        number
      ],
      color: [255, 180 - index * 5, 80] as [number, number, number],
      radius: 350 + index * 20
    }))
  }
};

export function mountPlaygroundExample(container: HTMLElement): () => void {
  let deck: Deck | undefined;
  const playground = new Playground({
    parentElement: container,
    templates: TEMPLATES,
    render: (previewElement, value) => {
      const document = value as PlaygroundDocument;
      deck?.finalize();
      deck = new Deck({
        parent: previewElement as HTMLDivElement,
        controller: true,
        initialViewState: document.initialViewState,
        layers: [
          new ScatterplotLayer({
            id: 'points',
            data: document.points,
            getPosition: point => point.position,
            getFillColor: point => point.color,
            getRadius: point => point.radius,
            radiusMinPixels: 4,
            pickable: true
          })
        ],
        getTooltip: ({object}) => (object ? `Radius: ${object.radius}` : null)
      });
      return () => {
        deck?.finalize();
        deck = undefined;
      };
    }
  });

  return () => {
    playground.finalize();
    deck?.finalize();
  };
}
