// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {PanWidget, ZoomRangeWidget} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

const INITIAL_VIEW_STATE = {
  target: [0, 0],
  zoom: 0
} as const;

const view = new OrthographicView({id: 'ortho'});

export function App() {
  const data = useMemo(() => {
    const points: {position: [number, number]; color: [number, number, number, number]}[] = [];
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
  }, []);

  const widgets = useMemo(
    () => [
      new PanWidget({
        style: {margin: '16px 0 0 16px'}
      }),
      new ZoomRangeWidget({
        style: {margin: '96px 0 0 16px'},
        minZoom: -3,
        maxZoom: 6,
        step: 0.1
      })
    ],
    []
  );

  const layers = useMemo(
    () => [
      new ScatterplotLayer({
        id: 'points',
        data,
        getPosition: (d) => d.position,
        getFillColor: (d) => d.color,
        radiusMinPixels: 4,
        radiusMaxPixels: 12,
        radiusUnits: 'pixels',
        pickable: false
      })
    ],
    [data]
  );

  return (
    <DeckGL
      views={view}
      initialViewState={INITIAL_VIEW_STATE}
      controller={{dragMode: 'pan'}}
      layers={layers}
      widgets={widgets}
    >
      <div
        style={{
          position: 'absolute',
          right: 16,
          top: 16,
          maxWidth: 320,
          padding: '12px 16px',
          background: 'rgba(255, 255, 255, 0.9)',
          borderRadius: '8px',
          fontFamily: 'var(--ifm-font-family-base, sans-serif)',
          lineHeight: 1.5
        }}
      >
        <h3 style={{margin: '0 0 8px'}}>Pan &amp; Zoom Widgets</h3>
        <p style={{margin: 0}}>
          Use the navigation pad and slider to explore this abstract scatterplot. The controls update the
          view state directly through deck.gl&apos;s widget API, making them reusable outside geospatial
          maps.
        </p>
      </div>
    </DeckGL>
  );
}
