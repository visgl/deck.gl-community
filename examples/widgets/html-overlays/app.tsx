// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {ScatterplotLayer} from '@deck.gl/layers';
import {h} from 'preact';
import StaticMap from 'react-map-gl/maplibre';
import {HtmlOverlayItem, HtmlOverlayWidget} from '@deck.gl-community/widgets';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const DESTINATIONS = [
  {
    id: 'seattle',
    name: 'Seattle',
    subtitle: 'Waterfront skyline + coffee culture',
    coordinates: [-122.335167, 47.608013]
  },
  {
    id: 'san-francisco',
    name: 'San Francisco',
    subtitle: 'Bay views, bridges, and hills',
    coordinates: [-122.431297, 37.773972]
  },
  {
    id: 'denver',
    name: 'Denver',
    subtitle: 'Gateway to the Rockies',
    coordinates: [-104.99025, 39.739235]
  },
  {
    id: 'austin',
    name: 'Austin',
    subtitle: 'Live music and lakeside trails',
    coordinates: [-97.743057, 30.267153]
  },
  {
    id: 'new-york',
    name: 'New York City',
    subtitle: 'Skyscrapers, parks, and galleries',
    coordinates: [-73.985664, 40.748433]
  },
  {
    id: 'miami',
    name: 'Miami',
    subtitle: 'Beachfront skyline on Biscayne Bay',
    coordinates: [-80.191788, 25.761681]
  }
] as const;

const INITIAL_VIEW_STATE = {
  longitude: -103.5,
  latitude: 39.5,
  zoom: 3.7,
  pitch: 0,
  bearing: 0
} as const;

const OVERLAY_STYLE = {
  width: '220px',
  padding: '10px 12px',
  borderRadius: '12px',
  background: 'rgba(255, 255, 255, 0.94)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
  border: '1px solid rgba(0, 0, 0, 0.05)',
  transform: 'translate(-50%, -110%)'
};

export function App() {
  const overlayWidget = useMemo(() => {
    const overlayItems = DESTINATIONS.map(({id, name, subtitle, coordinates}) =>
      h(
        HtmlOverlayItem,
        {
          key: id,
          coordinates,
          style: {
            ...OVERLAY_STYLE,
            color: '#1f2937',
            fontFamily: 'var(--ifm-font-family-base, "Inter", system-ui, sans-serif)',
            fontSize: '14px',
            lineHeight: 1.5
          }
        },
        h('div', {style: {fontWeight: 700, fontSize: '16px'}}, name),
        h('div', {style: {color: '#4b5563', marginTop: '4px'}}, subtitle)
      )
    );

    return new HtmlOverlayWidget({
      id: 'html-destination-overlays',
      overflowMargin: 128,
      zIndex: 3,
      items: overlayItems
    });
  }, []);

  const layers = useMemo(
    () => [
      new ScatterplotLayer({
        id: 'destinations',
        data: DESTINATIONS,
        getPosition: (d) => d.coordinates,
        getFillColor: [0, 122, 255, 200],
        radiusMinPixels: 10,
        radiusMaxPixels: 22,
        stroked: true,
        getLineColor: [255, 255, 255],
        lineWidthMinPixels: 2,
        pickable: false
      })
    ],
    []
  );

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      widgets={[overlayWidget]}
      style={{position: 'absolute', inset: 0}}
    >
      <StaticMap reuseMaps mapStyle={MAP_STYLE} />
      <div
        style={{
          position: 'absolute',
          right: 16,
          top: 16,
          maxWidth: 340,
          padding: '14px 16px',
          background: 'rgba(255, 255, 255, 0.92)',
          borderRadius: '10px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
          fontFamily: 'var(--ifm-font-family-base, "Inter", system-ui, sans-serif)',
          lineHeight: 1.6,
          color: '#111827'
        }}
      >
        <h3 style={{margin: '0 0 8px', fontSize: '18px'}}>HTML Overlay Widget</h3>
        <p style={{margin: 0}}>
          Each city badge is rendered with <code>HtmlOverlayWidget</code>, projecting Preact nodes into
          screen space with deck.gl&apos;s widget lifecycle. Try panning and zooming the map—the cards stay
          anchored to their coordinates.
        </p>
      </div>
    </DeckGL>
  );
}
