// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useCallback, useMemo, useState} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {PanWidget, ZoomRangeWidget} from '@deck.gl-community/react';

import '@deck.gl/widgets/stylesheet.css';

const INITIAL_VIEW_STATE = {
  target: [0, 0],
  zoom: 0
};

const view = new OrthographicView({id: 'ortho'});

export function App() {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

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

  const handleViewStateChange = useCallback(({viewState: nextViewState}) => {
    setViewState(nextViewState);
  }, []);

  return (
    <DeckGL
      views={view}
      viewState={viewState}
      controller={{dragMode: 'pan'}}
      onViewStateChange={handleViewStateChange}
      layers={layers}
    >
      <PanWidget style={{margin: '16px 0 0 16px'}} />
      <ZoomRangeWidget style={{margin: '96px 0 0 16px'}} minZoom={-3} maxZoom={6} step={0.1} />

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
        <h3 style={{margin: '0 0 8px'}}>React wrapper widgets</h3>
        <p style={{margin: 0}}>
          This example renders the Pan and Zoom range widgets as JSX children using the React wrappers from{' '}
          <code style={{marginLeft: 4}}>@deck.gl-community/react</code>. Each widget registers itself through the shared{' '}
          <code style={{marginLeft: 4}}>&lt;DeckGL&gt;</code> context, so there is no need to pass a <code>widgets</code> array prop.
        </p>
      </div>
    </DeckGL>
  );
}
