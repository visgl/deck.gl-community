// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useMemo, useState} from 'react';
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
  type EditModeTrayWidgetMenu,
  type EditModeTrayWidgetMenuOption,
  type EditModeTrayWidgetMenuSelectEvent,
  type GeoJsonEditModeConstructor,
  type GeoJsonEditModeType
} from '@deck.gl-community/editable-layers';
import StaticMap from 'react-map-gl/maplibre';
import type {FeatureCollection} from 'geojson';

import '@deck.gl/widgets/stylesheet.css';
import {Toolbox} from './toolbox/toolbox';

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
  {id: 'draw-circle', mode: DrawCircleFromCenterMode, icon: '◯', title: 'Draw circle', label: 'Circle'},
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

type ControlPanelProps = {
  onClear: () => void;
  onReset: () => void;
};

function ControlPanel({onClear, onReset}: ControlPanelProps) {
  return (
    <aside style={CONTROL_PANEL_STYLE}>
      <div>
        <h2 style={{margin: '0 0 4px', fontSize: '18px', fontWeight: 600}}>Editable layers editor</h2>
        <p style={{margin: 0, fontSize: '14px', lineHeight: 1.5}}>
          Select a tool from the mode tray to draw new geometries, measure features, or adjust existing
          shapes in the scene. Configure boolean operations and other options directly from the tray menus
          to modify how new polygons interact.
        </p>
      </div>

      <section style={{...CONTROL_SECTION_STYLE, marginTop: '4px'}}>
        <h3 style={{margin: 0, fontSize: '15px', fontWeight: 600}}>Dataset</h3>
        <div style={CONTROL_BUTTON_GROUP_STYLE}>
          <button
            type="button"
            style={CONTROL_BUTTON_STYLE}
            onClick={onReset}
          >
            Reset example
          </button>
          <button
            type="button"
            style={{...CONTROL_BUTTON_STYLE, color: '#fecaca', borderColor: 'rgba(239, 68, 68, 0.7)'}}
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

const BOOLEAN_OPERATION_MENU_ID = 'boolean-operation';

const BOOLEAN_OPERATION_MENU_OPTIONS: EditModeTrayWidgetMenuOption[] = [
  {
    id: 'none',
    label: 'None',
    title: 'Edit existing geometries without boolean operations'
  },
  {
    id: 'difference',
    label: 'Subtract',
    title: 'Cut overlapping polygons from each other'
  },
  {
    id: 'union',
    label: 'Union',
    title: 'Merge overlapping polygons together'
  },
  {
    id: 'intersection',
    label: 'Intersect',
    title: 'Keep only the overlapping regions'
  }
];

function areModesEqual(modeA: ModeType, modeB: ModeType): boolean {
  if (modeA === modeB) {
    return true;
  }
  const constructorA = (modeA as GeoJsonEditModeType)?.constructor;
  const constructorB = (modeB as GeoJsonEditModeType)?.constructor;
  return Boolean(constructorA && constructorB && constructorA === constructorB);
}

export function Example() {
  const [geoJson, setGeoJson] = useState<FeatureCollection>(getDefaultGeoJSON());
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState([0]);
  const [mode, setMode] = useState<ModeType>(() => ViewMode);
  const [modeConfig, setModeConfig] = useState<Record<string, unknown>>({});

  const handleSetMode = useCallback(
    (nextMode: ModeType) => {
      if (areModesEqual(mode, nextMode)) {
        return;
      }
      setMode(() => nextMode);
      setModeConfig({});
    },
    [mode, setMode, setModeConfig]
  );

  const handleReset = useCallback(() => {
    const reset = getDefaultGeoJSON();
    setGeoJson(reset);
    setSelectedFeatureIndexes([0]);
    setMode(() => ViewMode);
    setModeConfig({});
  }, [setGeoJson, setMode, setModeConfig, setSelectedFeatureIndexes]);

  const handleClear = useCallback(() => {
    setGeoJson({type: 'FeatureCollection', features: []});
    setSelectedFeatureIndexes([]);
  }, [setGeoJson, setSelectedFeatureIndexes]);

  const handleImport = useCallback(
    (imported: FeatureCollection) => {
      setGeoJson((current) => ({
        type: 'FeatureCollection',
        features: [...current.features, ...imported.features]
      }));
    },
    [setGeoJson]
  );

  const handleSetGeoJson = useCallback((nextGeoJson: FeatureCollection) => {
    setGeoJson(nextGeoJson);
  }, [setGeoJson]);

  const booleanOperation =
    typeof modeConfig?.['booleanOperation'] === 'string'
      ? (modeConfig['booleanOperation'] as string)
      : null;

  const trayMenus = useMemo<EditModeTrayWidgetMenu[]>(() => {
    const selectedId = booleanOperation ?? 'none';
    return [
      {
        id: BOOLEAN_OPERATION_MENU_ID,
        label: 'Boolean operations',
        options: BOOLEAN_OPERATION_MENU_OPTIONS,
        selectedOptionId: selectedId
      }
    ];
  }, [booleanOperation]);

  const handleSelectMenuOption = useCallback(
    ({menuId, optionId}: EditModeTrayWidgetMenuSelectEvent) => {
      if (menuId !== BOOLEAN_OPERATION_MENU_ID) {
        return;
      }
      setModeConfig((current) => {
        const next = {...current};
        if (optionId === 'none') {
          delete next.booleanOperation;
        } else {
          next.booleanOperation = optionId;
        }
        return next;
      });
    },
    [setModeConfig]
  );

  const widgets = useMemo(() => {
    const tray = new EditModeTrayWidget({
      placement: 'top-left',
      layout: 'vertical',
      style: {margin: '16px 0 0 16px'},
      modes: MODE_OPTIONS,
      activeMode: mode,
      menus: trayMenus,
      onSelectMode: ({mode: selectedMode}) => {
        handleSetMode(selectedMode);
      },
      onSelectMenuOption: handleSelectMenuOption
    });
    return [tray];
  }, [handleSelectMenuOption, handleSetMode, mode, trayMenus]);

  const layer = new EditableGeoJsonLayer({
    data: geoJson,
    mode,
    modeConfig,
    selectedFeatureIndexes,
    onEdit: ({ updatedData }) => {
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
        onClear={handleClear}
        onReset={handleReset}
      />
      <Toolbox
        geoJson={geoJson}
        mode={mode}
        modeConfig={modeConfig}
        onSetMode={handleSetMode}
        onSetModeConfig={setModeConfig}
        onSetGeoJson={handleSetGeoJson}
        onImport={handleImport}
      />
    </>
  );
}
