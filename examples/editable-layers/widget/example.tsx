// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import DeckGL from '@deck.gl/react';
import {
  ViewMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawPolygonMode,
  DrawRectangleMode,
  DrawCircleFromCenterMode,
  MeasureDistanceMode,
  MeasureAngleMode,
  MeasureAreaMode,
  EditableGeoJsonLayer,
  EditModeTrayWidget,
  type EditModeTrayWidgetModeOption,
  type GeoJsonEditModeConstructor,
  type GeoJsonEditModeType
} from '@deck.gl-community/editable-layers';
import StaticMap from 'react-map-gl/maplibre';
import type {FeatureCollection} from 'geojson';

import '@deck.gl/widgets/stylesheet.css';

export function getDefaultGeoJSON(): FeatureCollection {
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
              [-122.46212548792364, 37.79026033616934],
              [-122.48435831844807, 37.77160302698496],
              [-122.45884849905971, 37.74414218845571],
              [-122.42863676726826, 37.76266965836386],
              [-122.46212548792364, 37.79026033616934]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.4136573004723, 37.78826678755718],
              [-122.44875601708893, 37.782670574261324],
              [-122.43793598592286, 37.74322062447909],
              [-122.40836932539945, 37.75125290412125],
              [-122.4136573004723, 37.78826678755718]
            ]
          ]
        }
      }
    ]
  } as FeatureCollection;
}

const initialViewState = {
  longitude: -122.43,
  latitude: 37.775,
  zoom: 12
};

const MODE_OPTIONS: EditModeTrayWidgetModeOption[] = [
  {id: 'view', mode: ViewMode, icon: '👆', title: 'View mode', label: 'View'},
  {id: 'draw-point', mode: DrawPointMode, icon: '•', title: 'Draw point', label: 'Point'},
  {id: 'draw-line', mode: DrawLineStringMode, icon: '╱', title: 'Draw line string', label: 'Line'},
  {id: 'draw-polygon', mode: DrawPolygonMode, icon: '⬠', title: 'Draw polygon', label: 'Polygon'},
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
  },
  {
    id: 'measure-distance',
    mode: MeasureDistanceMode,
    icon: '📏',
    title: 'Measure distance',
    label: 'Distance'
  },
  {id: 'measure-angle', mode: MeasureAngleMode, icon: '∠', title: 'Measure angle', label: 'Angle'},
  {id: 'measure-area', mode: MeasureAreaMode, icon: '▢', title: 'Measure area', label: 'Area'}
];

const CONTROL_PANEL_STYLE: React.CSSProperties = {
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
  fontFamily: 'var(--ifm-font-family-base, sans-serif)'
};

const CONTROL_SECTION_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const CONTROL_BUTTON_GROUP_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px'
};

const CONTROL_BUTTON_STYLE: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  borderRadius: '999px',
  background: 'rgba(15, 23, 42, 0.4)',
  color: '#e2e8f0',
  padding: '6px 12px',
  fontSize: '13px',
  lineHeight: 1.2,
  cursor: 'pointer',
  transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease'
};

const CONTROL_BUTTON_ACTIVE_STYLE: React.CSSProperties = {
  background: '#2563eb',
  color: '#f8fafc',
  borderColor: '#2563eb'
};

type ControlPanelProps = {
  modeConfig: Record<string, unknown>;
  onSetModeConfig: (config: Record<string, unknown>) => void;
  onClear: () => void;
  onReset: () => void;
};

function ControlPanel({modeConfig, onSetModeConfig, onClear, onReset}: ControlPanelProps) {
  const booleanOperation =
    typeof modeConfig?.['booleanOperation'] === 'string'
      ? (modeConfig['booleanOperation'] as string)
      : null;

  const buttons: {id: string; label: string; description: string; value: string | null}[] = [
    {
      id: 'none',
      label: 'Edit geometries',
      description: 'Use edit handles to modify shapes.',
      value: null
    },
    {
      id: 'difference',
      label: 'Subtract',
      description: 'Cut selected features from each other.',
      value: 'difference'
    },
    {
      id: 'union',
      label: 'Union',
      description: 'Merge overlapping polygons together.',
      value: 'union'
    },
    {
      id: 'intersection',
      label: 'Intersect',
      description: 'Keep only the overlapping regions.',
      value: 'intersection'
    }
  ];

  return (
    <aside style={CONTROL_PANEL_STYLE}>
      <div>
        <h2 style={{margin: '0 0 4px', fontSize: '18px', fontWeight: 600}}>
          Editable layers editor
        </h2>
        <p style={{margin: 0, fontSize: '14px', lineHeight: 1.5}}>
          Select a tool from the mode tray to draw new geometries, measure features, or adjust
          existing shapes in the scene.
        </p>
      </div>

      <section style={CONTROL_SECTION_STYLE}>
        <h3 style={{margin: 0, fontSize: '15px', fontWeight: 600}}>Boolean operations</h3>
        <p style={{margin: 0, fontSize: '13px', color: '#cbd5f5'}}>
          Apply when drawing overlapping polygons.
        </p>
        <div style={CONTROL_BUTTON_GROUP_STYLE}>
          {buttons.map((button) => {
            const active = button.value === booleanOperation;
            return (
              <button
                key={button.id}
                type="button"
                style={{
                  ...CONTROL_BUTTON_STYLE,
                  ...(active ? CONTROL_BUTTON_ACTIVE_STYLE : {})
                }}
                onClick={() => {
                  if (button.value) {
                    onSetModeConfig({booleanOperation: button.value});
                  } else {
                    onSetModeConfig({});
                  }
                }}
                aria-pressed={active}
                title={button.description}
              >
                {button.label}
              </button>
            );
          })}
        </div>
      </section>

      <section style={{...CONTROL_SECTION_STYLE, marginTop: '4px'}}>
        <h3 style={{margin: 0, fontSize: '15px', fontWeight: 600}}>Dataset</h3>
        <div style={CONTROL_BUTTON_GROUP_STYLE}>
          <button type="button" style={CONTROL_BUTTON_STYLE} onClick={onReset}>
            Reset example
          </button>
          <button
            type="button"
            style={{
              ...CONTROL_BUTTON_STYLE,
              color: '#fecaca',
              borderColor: 'rgba(239, 68, 68, 0.7)'
            }}
            onClick={onClear}
          >
            Clear features
          </button>
        </div>
      </section>
    </aside>
  );
}

type ModeType = GeoJsonEditModeConstructor | GeoJsonEditModeType;

export function Example() {
  const [geoJson, setGeoJson] = useState<FeatureCollection>(getDefaultGeoJSON());
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState([0]);
  const [mode, setMode] = useState<ModeType>(() => ViewMode);
  const [modeConfig, setModeConfig] = useState<Record<string, unknown>>({});

  const trayWidgetRef = useRef<EditModeTrayWidget | null>(null);
  if (!trayWidgetRef.current) {
    trayWidgetRef.current = new EditModeTrayWidget({
      placement: 'top-left',
      layout: 'vertical',
      style: {margin: '16px 0 0 16px'}
    });
  }
  const trayWidget = trayWidgetRef.current!;

  const widgets = useMemo(() => [trayWidget], [trayWidget]);

  const trayModeOptions = useMemo(() => MODE_OPTIONS, []);

  const handleSetMode = useCallback(
    (nextMode: ModeType) => {
      setMode(() => nextMode);
      setModeConfig({});
    },
    [setMode, setModeConfig]
  );

  const handleReset = useCallback(() => {
    const reset = getDefaultGeoJSON();
    setGeoJson(reset);
    setSelectedFeatureIndexes([0]);
    handleSetMode(ViewMode);
  }, [handleSetMode, setGeoJson, setSelectedFeatureIndexes]);

  const handleClear = useCallback(() => {
    setGeoJson({type: 'FeatureCollection', features: []});
    setSelectedFeatureIndexes([]);
  }, [setGeoJson, setSelectedFeatureIndexes]);

  useEffect(() => {
    const selected = trayModeOptions.find((option) => option.mode === mode)?.id ?? null;
    trayWidget.setProps({
      modes: trayModeOptions,
      activeMode: mode,
      selectedModeId: selected,
      onSelectMode: ({mode: selectedMode}) => {
        if (mode !== selectedMode) {
          handleSetMode(selectedMode);
        }
      }
    });
  }, [handleSetMode, mode, trayModeOptions, trayWidget]);

  const layer = new EditableGeoJsonLayer({
    data: geoJson,
    mode,
    modeConfig,
    selectedFeatureIndexes,
    onEdit: ({updatedData}) => {
      setGeoJson(updatedData);
    }
  });

  return (
    <>
      <DeckGL
        initialViewState={initialViewState}
        controller={{
          doubleClickZoom: false
        }}
        layers={[layer]}
        getCursor={layer.getCursor.bind(layer)}
        onClick={(info) => {
          if (mode === ViewMode) {
            const index = typeof info?.index === 'number' && info.index >= 0 ? info.index : null;
            if (index !== null) {
              setSelectedFeatureIndexes([index]);
            } else {
              setSelectedFeatureIndexes([]);
            }
          }
        }}
        widgets={widgets}
      >
        <StaticMap mapStyle={'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'} />
      </DeckGL>

      <ControlPanel
        modeConfig={modeConfig}
        onSetModeConfig={setModeConfig}
        onClear={handleClear}
        onReset={handleReset}
      />
    </>
  );
}
