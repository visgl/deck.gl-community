// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {ScatterplotLayer} from '@deck.gl/layers';
import {h} from 'preact';
import StaticMap from 'react-map-gl/maplibre';
import {
  HtmlClusterWidget,
  HtmlOverlayItem,
  HtmlOverlayWidget,
  HtmlTooltipWidget
} from '@deck.gl-community/widgets';

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

const STOPOVERS = [
  {id: 'seattle-harbor', city: 'Seattle', title: 'Harbor Steps', coordinates: [-122.3403, 47.6068]},
  {id: 'seattle-park', city: 'Seattle', title: 'Volunteer Park', coordinates: [-122.314, 47.6292]},
  {id: 'sf-embarcadero', city: 'San Francisco', title: 'Embarcadero', coordinates: [-122.3952, 37.795]},
  {id: 'sf-sutro', city: 'San Francisco', title: 'Sutro Heights', coordinates: [-122.5078, 37.7774]},
  {id: 'sf-mission', city: 'San Francisco', title: 'Mission Dolores', coordinates: [-122.4256, 37.7599]},
  {id: 'denver-park', city: 'Denver', title: 'City Park', coordinates: [-104.9551, 39.7475]},
  {id: 'denver-rino', city: 'Denver', title: 'RiNo Arts', coordinates: [-104.9793, 39.7691]},
  {id: 'denver-sloan', city: 'Denver', title: 'Sloan Lake', coordinates: [-105.047, 39.7479]},
  {id: 'austin-zilker', city: 'Austin', title: 'Zilker Park', coordinates: [-97.7713, 30.2665]},
  {id: 'austin-lake', city: 'Austin', title: 'Lady Bird Lake', coordinates: [-97.7438, 30.2653]},
  {id: 'austin-mueller', city: 'Austin', title: 'Mueller Lake', coordinates: [-97.6996, 30.2977]},
  {id: 'ny-central', city: 'New York City', title: 'Central Park', coordinates: [-73.9765, 40.7812]},
  {id: 'ny-dumbo', city: 'New York City', title: 'DUMBO Landing', coordinates: [-73.9903, 40.7033]},
  {id: 'ny-highline', city: 'New York City', title: 'The High Line', coordinates: [-74.0048, 40.7479]},
  {id: 'miami-beach', city: 'Miami', title: 'South Beach', coordinates: [-80.1321, 25.784]},
  {id: 'miami-wynwood', city: 'Miami', title: 'Wynwood Walls', coordinates: [-80.1995, 25.8007]},
  {id: 'miami-key', city: 'Miami', title: 'Virginia Key', coordinates: [-80.1632, 25.7444]}
] as const;

const CLUSTER_STYLE = {
  padding: '10px 12px',
  borderRadius: '14px',
  background: 'linear-gradient(135deg, #111827, #1f2937)',
  color: 'white',
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  transform: 'translate(-50%, -110%)',
  minWidth: 180
};

const PIN_STYLE = {
  padding: '8px 10px',
  borderRadius: '12px',
  background: 'rgba(17, 24, 39, 0.92)',
  color: 'white',
  boxShadow: '0 10px 30px rgba(0,0,0,0.24)',
  border: '1px solid rgba(255,255,255,0.08)',
  transform: 'translate(-50%, -115%)',
  minWidth: 150
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

  const clusterWidget = useMemo(() => {
    return new (class extends HtmlClusterWidget<(typeof STOPOVERS)[number]> {
      override getAllObjects = () => STOPOVERS;

      override getObjectCoordinates = (stop) => stop.coordinates;

      override renderObject = (coordinates, stop) =>
        h(
          HtmlOverlayItem,
          {
            key: stop.id,
            coordinates,
            style: PIN_STYLE
          },
          h('div', {style: {fontWeight: 700}}, stop.title),
          h('div', {style: {fontSize: 12, opacity: 0.8}}, stop.city)
        );

      override renderCluster = (coordinates, clusterId, pointCount) => {
        const cities = this.getClusterObjects(clusterId).map((stop) => stop.city);
        const cityLabel = new Intl.ListFormat('en', {style: 'long', type: 'conjunction'}).format(
          [...new Set(cities)].slice(0, 3)
        );

        return h(
          HtmlOverlayItem,
          {
            key: `cluster-${clusterId}`,
            coordinates,
            style: CLUSTER_STYLE
          },
          h('div', {style: {fontWeight: 800, fontSize: 16}}, `${pointCount} stops`),
          h('div', {style: {fontSize: 12, opacity: 0.86}}, cityLabel)
        );
      };
    })({
      id: 'html-cluster-overlays',
      overflowMargin: 96,
      zIndex: 4
    });
  }, []);

  const tooltipWidget = useMemo(
    () =>
      new HtmlTooltipWidget({
        id: 'html-overlay-tooltips',
        showDelay: 120,
        getTooltip: (info) => {
          const stop = info.object as (typeof STOPOVERS)[number] | (typeof DESTINATIONS)[number] | null;
          if (!stop) {
            return null;
          }

          return h(
            'div',
            {
              style: {
                fontFamily: 'var(--ifm-font-family-base, "Inter", system-ui, sans-serif)',
                minWidth: 140,
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }
            },
            h('div', {style: {fontWeight: 700}}, stop.name ?? stop.title),
            stop.subtitle
              ? h('div', {style: {opacity: 0.8}}, stop.subtitle)
              : h('div', {style: {opacity: 0.8}}, stop.city)
          );
        }
      }),
    []
  );

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
        pickable: true
      }),
      new ScatterplotLayer({
        id: 'stopovers',
        data: STOPOVERS,
        getPosition: (d) => d.coordinates,
        getFillColor: [255, 115, 29, 220],
        radiusMinPixels: 6,
        stroked: true,
        getLineColor: [255, 255, 255],
        lineWidthMinPixels: 1,
        pickable: true
      })
    ],
    []
  );

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      widgets={[overlayWidget, clusterWidget, tooltipWidget]}
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
        <h3 style={{margin: '0 0 8px', fontSize: '18px'}}>HTML Overlay Widgets</h3>
        <p style={{margin: '0 0 4px'}}>
          Destination cards use <code>HtmlOverlayWidget</code>, clusters summarize nearby stopovers via
          <code>HtmlClusterWidget</code>, and hovering any marker reveals a tooltip powered by
          <code>HtmlTooltipWidget</code>.
        </p>
        <p style={{margin: 0}}>
          All overlays are rendered with Preact nodes managed by deck.gl&apos;s widget lifecycle—pan or zoom
          to see them stay anchored to their coordinates.
        </p>
      </div>
    </DeckGL>
  );
}
