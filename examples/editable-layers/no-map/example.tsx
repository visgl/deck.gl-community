// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import DeckGL from '@deck.gl/react';
import {BitmapLayer} from '@deck.gl/layers';
import {
  ViewMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawPolygonMode,
  DrawRectangleMode,
  DrawCircleFromCenterMode,
  ModifyMode,
  TranslateMode,
  EditableGeoJsonLayer,
  EditModeTrayWidget,
  type EditModeTrayWidgetModeOption,
  type GeoJsonEditModeConstructor,
  type GeoJsonEditModeType
} from '@deck.gl-community/editable-layers';
import type {FeatureCollection} from 'geojson';

import '@deck.gl/widgets/stylesheet.css';

// Bird image used as a non-map background
// Source: JJ Harrison - CC BY-SA 4.0
// https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures/Animals/Birds
const BACKGROUND_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Dendrocygna_eytoni_-_Macquarie_University.jpg/1280px-Dendrocygna_eytoni_-_Macquarie_University.jpg';

// Position the image near the equator where Mercator distortion is minimal.
// Bounds: [west, south, east, north]
const IMAGE_BOUNDS: [number, number, number, number] = [-10, -8, 10, 8];

function getDefaultGeoJSON(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-4, -2],
              [-4, 2],
              [0, 2],
              [0, -2],
              [-4, -2]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [5, 3]
        }
      }
    ]
  };
}

// Centered at [0, 0] — no basemap rendered, just a plain background
const INITIAL_VIEW_STATE = {
  longitude: 0,
  latitude: 0,
  zoom: 5
};

const MODE_OPTIONS: EditModeTrayWidgetModeOption[] = [
  {id: 'view', mode: ViewMode, icon: '👆', title: 'View mode', label: 'View'},
  {id: 'modify', mode: ModifyMode, icon: '✎', title: 'Modify vertices', label: 'Modify'},
  {id: 'translate', mode: TranslateMode, icon: '↔', title: 'Move features', label: 'Move'},
  {id: 'draw-point', mode: DrawPointMode, icon: '•', title: 'Draw point', label: 'Point'},
  {
    id: 'draw-line',
    mode: DrawLineStringMode,
    icon: '╱',
    title: 'Draw line string',
    label: 'Line'
  },
  {
    id: 'draw-polygon',
    mode: DrawPolygonMode,
    icon: '⬠',
    title: 'Draw polygon',
    label: 'Polygon'
  },
  {
    id: 'draw-rectangle',
    mode: DrawRectangleMode,
    icon: '▭',
    title: 'Draw rectangle',
    label: 'Rectangle'
  },
  {
    id: 'draw-circle',
    mode: DrawCircleFromCenterMode,
    icon: '◯',
    title: 'Draw circle',
    label: 'Circle'
  }
];

const INFO_PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 116,
  maxWidth: 320,
  padding: '12px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  background: 'rgba(26, 32, 44, 0.9)',
  color: '#f8fafc',
  borderRadius: '12px',
  fontFamily: 'sans-serif'
};

type ModeType = GeoJsonEditModeConstructor | GeoJsonEditModeType;

export function Example() {
  const [geoJson, setGeoJson] = useState<FeatureCollection>(getDefaultGeoJSON);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<number[]>([0]);
  const [mode, setMode] = useState<ModeType>(() => ViewMode);

  const trayWidget = useMemo(
    () =>
      new EditModeTrayWidget({
        placement: 'top-left',
        layout: 'vertical',
        style: {margin: '16px 0 0 16px'}
      }),
    []
  );

  const widgets = useMemo(() => [trayWidget], [trayWidget]);

  const handleSetMode = useCallback(
    (nextMode: ModeType) => {
      setMode(() => nextMode);
    },
    [setMode]
  );

  useEffect(() => {
    const selected = MODE_OPTIONS.find((option) => option.mode === mode)?.id ?? null;
    trayWidget.setProps({
      modes: MODE_OPTIONS,
      activeMode: mode,
      selectedModeId: selected,
      onSelectMode: ({mode: selectedMode}) => {
        if (mode !== selectedMode) {
          handleSetMode(selectedMode);
        }
      }
    });
  }, [handleSetMode, mode, trayWidget]);

  const backgroundLayer = new BitmapLayer({
    id: 'background-image',
    bounds: IMAGE_BOUNDS,
    image: BACKGROUND_IMAGE
  });

  const editableLayer = new EditableGeoJsonLayer({
    data: geoJson,
    mode,
    selectedFeatureIndexes,
    onEdit: ({updatedData}) => {
      setGeoJson(updatedData);
    },
    getFillColor: [0, 100, 200, 80],
    getLineColor: [0, 100, 200, 200],
    getLineWidth: 2,
    lineWidthMinPixels: 2,
    pointRadiusMinPixels: 6,
    editHandlePointRadiusMinPixels: 5
  });

  return (
    <>
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={{doubleClickZoom: false}}
        layers={[backgroundLayer, editableLayer]}
        getCursor={editableLayer.getCursor.bind(editableLayer)}
        onClick={(info) => {
          if (mode === ViewMode) {
            if (info && info.index >= 0) {
              setSelectedFeatureIndexes([info.index]);
            } else {
              setSelectedFeatureIndexes([]);
            }
          }
        }}
        widgets={widgets}
      />

      <aside style={INFO_PANEL_STYLE}>
        <div>
          <h2 style={{margin: '0 0 4px', fontSize: '18px', fontWeight: 600}}>
            Editable Layers — No Map
          </h2>
          <p style={{margin: 0, fontSize: '14px', lineHeight: 1.5}}>
            Editing GeoJSON features without a basemap. Uses a Mercator projection centered at the
            equator with a bitmap image as background. All edit modes (draw, modify, translate) work
            with geographic coordinates.
          </p>
        </div>
        <div style={{fontSize: '13px', color: '#94a3b8'}}>
          Features: {geoJson.features.length} | Selected:{' '}
          {selectedFeatureIndexes.length > 0 ? selectedFeatureIndexes.join(', ') : 'none'}
        </div>
      </aside>
    </>
  );
}
