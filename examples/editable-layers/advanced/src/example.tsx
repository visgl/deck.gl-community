// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */
import * as React from 'react';
import {useState, useCallback} from 'react';
import DeckGL from '@deck.gl/react';
import {MapView, MapController} from '@deck.gl/core';
import StaticMap from 'react-map-gl/maplibre';
import {GL} from '@luma.gl/constants';
import circle from '@turf/circle';

import {
  EditableGeoJsonLayer,
  SelectionLayer,
  ModifyMode,
  ResizeCircleMode,
  TranslateMode,
  TransformMode,
  ScaleMode,
  RotateMode,
  DuplicateMode,
  ExtendLineStringMode,
  SplitPolygonMode,
  ExtrudeMode,
  ElevationMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawPolygonMode,
  DrawRectangleMode,
  DrawSquareMode,
  DrawRectangleFromCenterMode,
  DrawSquareFromCenterMode,
  DrawCircleByDiameterMode,
  DrawCircleFromCenterMode,
  DrawEllipseByBoundingBoxMode,
  DrawEllipseUsingThreePointsMode,
  DrawRectangleUsingThreePointsMode,
  Draw90DegreePolygonMode,
  DrawPolygonByDraggingMode,
  MeasureDistanceMode,
  MeasureAreaMode,
  MeasureAngleMode,
  ViewMode,
  CompositeMode,
  SnappableMode,
  ElevatedEditHandleLayer,
  GeoJsonEditMode,
  Color,
  FeatureCollection
} from '@deck.gl-community/editable-layers';

import {PathMarkerLayer} from '@deck.gl-community/layers';

import sampleGeoJson from '../../data/sample-geojson.json';

import iconSheet from '../../data/edit-handles.png';

import {
  Toolbox,
  ToolboxControl,
  ToolboxTitle,
  ToolboxRow,
  ToolboxButton,
  ToolboxCheckbox
} from './toolbox';

type RGBAColor = Color;
const COMPOSITE_MODE = new CompositeMode([new DrawLineStringMode(), new ModifyMode()]);

const styles = {
  mapContainer: {
    alignItems: 'stretch',
    display: 'flex',
    height: '100vh'
  },
  checkbox: {
    margin: 10
  }
};

const initialViewport = {
  bearing: 0,
  height: 0,
  latitude: 37.76,
  longitude: -122.44,
  pitch: 0,
  width: 0,
  zoom: 11
};

const ALL_MODES: any = [
  {
    category: 'View',
    modes: [
      {label: 'View', mode: ViewMode},
      {
        label: 'Measure Distance',
        mode: MeasureDistanceMode
      },
      {label: 'Measure Area', mode: MeasureAreaMode},
      {label: 'Measure Angle', mode: MeasureAngleMode}
    ]
  },
  {
    category: 'Draw',
    modes: [
      {label: 'Draw Point', mode: DrawPointMode},
      {label: 'Draw LineString', mode: DrawLineStringMode},
      {label: 'Draw Polygon', mode: DrawPolygonMode},
      {label: 'Draw 90° Polygon', mode: Draw90DegreePolygonMode},
      {label: 'Draw Polygon By Dragging', mode: DrawPolygonByDraggingMode},
      {label: 'Draw Rectangle', mode: DrawRectangleMode},
      {label: 'Draw Rectangle From Center', mode: DrawRectangleFromCenterMode},
      {label: 'Draw Rectangle Using 3 Points', mode: DrawRectangleUsingThreePointsMode},
      {label: 'Draw Square', mode: DrawSquareMode},
      {label: 'Draw Square From Center', mode: DrawSquareFromCenterMode},
      {label: 'Draw Circle From Center', mode: DrawCircleFromCenterMode},
      {label: 'Draw Circle By Diameter', mode: DrawCircleByDiameterMode},
      {label: 'Draw Ellipse By Bounding Box', mode: DrawEllipseByBoundingBoxMode},
      {label: 'Draw Ellipse Using 3 Points', mode: DrawEllipseUsingThreePointsMode}
    ]
  },
  {
    category: 'Alter',
    modes: [
      {label: 'Modify', mode: ModifyMode},
      {label: 'Resize Circle', mode: ResizeCircleMode},
      {label: 'Elevation', mode: ElevationMode},
      {label: 'Translate', mode: new SnappableMode(new TranslateMode())},
      {label: 'Rotate', mode: RotateMode},
      {label: 'Scale', mode: ScaleMode},
      {label: 'Duplicate', mode: DuplicateMode},
      {label: 'Extend LineString', mode: ExtendLineStringMode},
      {label: 'Extrude', mode: ExtrudeMode},
      {label: 'Split', mode: SplitPolygonMode},
      {label: 'Transform', mode: new SnappableMode(new TransformMode())}
    ]
  },
  {
    category: 'Composite',
    modes: [{label: 'Draw LineString + Modify', mode: COMPOSITE_MODE}]
  }
];

const POLYGON_DRAWING_MODES = [
  DrawPolygonMode,
  Draw90DegreePolygonMode,
  DrawPolygonByDraggingMode,
  DrawRectangleMode,
  DrawRectangleFromCenterMode,
  DrawRectangleUsingThreePointsMode,
  DrawSquareMode,
  DrawSquareFromCenterMode,
  DrawCircleFromCenterMode,
  DrawCircleByDiameterMode,
  DrawEllipseByBoundingBoxMode,
  DrawEllipseUsingThreePointsMode
];

const TWO_CLICK_POLYGON_MODES = [
  DrawRectangleMode,
  DrawSquareMode,
  DrawRectangleFromCenterMode,
  DrawSquareFromCenterMode,
  DrawCircleFromCenterMode,
  DrawCircleByDiameterMode,
  DrawEllipseByBoundingBoxMode
];

const EMPTY_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
};

function hex2rgb(hex: string) {
  const value = parseInt(hex, 16);
  return [16, 8, 0].map((shift) => ((value >> shift) & 0xff) / 255);
}

const FEATURE_COLORS = [
  '00AEE4',
  'DAF0E3',
  '9BCC32',
  '07A35A',
  'F7DF90',
  'EA376C',
  '6A126A',
  'FCB09B',
  'B0592D',
  'C1B5E3',
  '9C805B',
  'CCDFE5'
].map(hex2rgb);

// TODO edit-modes:  delete once fully on EditMode implementation and just use handle.properties.editHandleType...
// Unwrap the edit handle object from either layer implementation
function getEditHandleTypeFromEitherLayer(handleOrFeature) {
  if (handleOrFeature.__source) {
    return handleOrFeature.__source.object.properties.editHandleType;
  } else if (handleOrFeature.sourceFeature) {
    return handleOrFeature.sourceFeature.feature.properties.editHandleType;
  } else if (handleOrFeature.properties) {
    return handleOrFeature.properties.editHandleType;
  }

  return handleOrFeature.type;
}

function getEditHandleColor(handle: {}): RGBAColor {
  switch (getEditHandleTypeFromEitherLayer(handle)) {
    case 'existing':
      return [0xff, 0x80, 0x00, 0xff];
    case 'snap-source':
      return [0xc0, 0x80, 0xf0, 0xff];
    case 'intermediate':
    default:
      return [0xff, 0xc0, 0x80, 0xff];
  }
}

export function Example() {
  const [viewport, setViewport] = useState<Record<string, any>>(initialViewport);
  const [testFeatures, setTestFeatures] = useState<any>(sampleGeoJson);
  const [mode, setMode] = useState<typeof GeoJsonEditMode>(DrawPolygonMode);
  const [modeConfig, setModeConfig] = useState<any>({allowHoles: true, allowSelfIntersection: false});
  const [pointsRemovable, setPointsRemovable] = useState<boolean>(true);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<number[]>([]);
  const [editHandleType, setEditHandleType] = useState<string>('point');
  const [selectionTool, setSelectionTool] = useState<string | undefined>(undefined);
  const [showGeoJson, setShowGeoJson] = useState<boolean>(false);
  const [pathMarkerLayer, setPathMarkerLayer] = useState<boolean>(false);
  const [featureMenu, setFeatureMenu] = useState<{index: number; x: number; y: number} | undefined>(undefined);

  const getDefaultModeConfig = useCallback((mode: any) => {
    if (mode === DrawPolygonMode) {
      return {allowHoles: true, allowSelfIntersection: false};
    }
    return {};
  }, []);

  const onLayerClick = useCallback((info: any) => {
    console.log('onLayerClick', info); // eslint-disable-line
    if (mode !== ViewMode || selectionTool) {
      // don't change selection while editing
      return;
    }

    if (info) {
      console.log(`select editing feature ${info.index}`); // eslint-disable-line
      // a feature was clicked
      setSelectedFeatureIndexes([info.index]);
    } else {
      console.log('deselect editing feature'); // eslint-disable-line
      // open space was clicked, so stop editing
      setSelectedFeatureIndexes([]);
    }
  }, [mode, selectionTool]);

  const parseStringJson = useCallback((json: string) => {
    let parsedFeatures: FeatureCollection | null = null;
    try {
      parsedFeatures = JSON.parse(json);
      if (Array.isArray(parsedFeatures)) {
        parsedFeatures = {
          type: 'FeatureCollection',
          features: parsedFeatures
        };
      }
      // eslint-disable-next-line
      console.log('Loaded JSON:', parsedFeatures);
      setTestFeatures(parsedFeatures);
    } catch (err) {
      error(err);
    }
  }, []);

  const loadSample = useCallback((type: string) => {
    if (type === 'mixed') {
      setTestFeatures(sampleGeoJson);
      setSelectedFeatureIndexes([]);
    } else if (type === 'complex') {
      setTestFeatures({
        type: 'FeatureCollection',
        features: [
          circle([-122.45, 37.81], 4, {steps: 5000}),
          circle([-122.33, 37.81], 4, {steps: 5000}),
          circle([-122.45, 37.73], 4, {steps: 5000}),
          circle([-122.33, 37.73], 4, {steps: 5000})
        ]
      });
      setSelectedFeatureIndexes([]);
    } else if (type === 'blank') {
      setTestFeatures(EMPTY_FEATURE_COLLECTION);
      setSelectedFeatureIndexes([]);
    } else if (type === 'file') {
      const el = document.createElement('input');
      el.type = 'file';
      el.onchange = (e) => {
        const eventTarget = e.target as HTMLInputElement;
        if (eventTarget.files && eventTarget.files[0]) {
          const reader = new FileReader();
          reader.onload = ({target}) => {
            parseStringJson(target.result as string);
          };
          reader.readAsText(eventTarget.files[0]);
        }
      };
      el.click();
    }
  }, [parseStringJson]);

  const error = useCallback((err: any) => {
    // eslint-disable-next-line
    alert(err);
  }, []);

  const copy = useCallback(() => {
    if (navigator && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(testFeatures));
    } else {
      error('No navigator.clipboard');
    }
  }, [testFeatures, error]);

  const paste = useCallback(() => {
    if (navigator && navigator.clipboard) {
      navigator.clipboard.readText().then(
        (value) => {
          parseStringJson(value);
        },
        (reason) => {
          error(reason);
        }
      );
    } else {
      error('No navigator.clipboard');
    }
  }, [parseStringJson, error]);

  const download = useCallback(() => {
    const blob = new Blob([JSON.stringify(testFeatures)], {
      type: 'octet/stream'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nebula.geojson';
    a.click();
  }, [testFeatures]);

  const getHtmlColorForFeature = useCallback((index: number, selected: boolean) => {
    const length = FEATURE_COLORS.length;
    const color = FEATURE_COLORS[index % length].map((c) => c * 255).join(',');
    const alpha = selected ? 1.0 : 0.7;

    return `rgba(${color}, ${alpha})`;
  }, []);

  const getDeckColorForFeature = useCallback((index: number, bright: number, alpha: number): RGBAColor => {
    const length = FEATURE_COLORS.length;
    const color = FEATURE_COLORS[index % length].map((c) => c * bright * 255);

    // @ts-expect-error TODO
    return [...color, alpha * 255];
  }, []);

  const renderSelectFeatureCheckbox = useCallback((index: number, featureType: string) => {
    return (
      <div key={index}>
        <ToolboxCheckbox
          style={styles.checkbox}
          type="checkbox"
          checked={selectedFeatureIndexes.includes(index)}
          onChange={() => {
            if (selectedFeatureIndexes.includes(index)) {
              setSelectedFeatureIndexes(selectedFeatureIndexes.filter((e) => e !== index));
            } else {
              setSelectedFeatureIndexes([...selectedFeatureIndexes, index]);
            }
          }}
        >
          <span
            style={{
              color: getHtmlColorForFeature(index, selectedFeatureIndexes.includes(index))
            }}
          >
            {index}
            {': '}
            {featureType}
          </span>
          <a
            style={{position: 'absolute', right: 12}}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedFeatureIndexes([index]);
              setFeatureMenu({index, x: e.clientX, y: e.clientY});
            }}
          >
            &gt;&gt;
          </a>
        </ToolboxCheckbox>
      </div>
    );
  }, [selectedFeatureIndexes, getHtmlColorForFeature]);

  const renderSelectFeatureCheckboxes = useCallback(() => {
    const checkboxes: React.ReactElement[] = [];
    for (let i = 0; i < testFeatures.features.length; ++i) {
      checkboxes.push(renderSelectFeatureCheckbox(i, testFeatures.features[i].geometry.type));
    }
    return checkboxes;
  }, [testFeatures.features, renderSelectFeatureCheckbox]);

  const renderBooleanOperationControls = useCallback(() => {
    const operations = ['union', 'difference', 'intersection'];
    return (
      <ToolboxRow key="booleanOperations">
        <ToolboxTitle>
          Boolean operation
          <br />
          (requires single selection)
        </ToolboxTitle>
        <ToolboxControl>
          {operations.map((operation) => (
            <ToolboxButton
              key={operation}
              selected={
                modeConfig && modeConfig.booleanOperation === operation
              }
              onClick={() => {
                if (modeConfig && modeConfig.booleanOperation === operation) {
                  setModeConfig({
                    ...(modeConfig || {}),
                    booleanOperation: null
                  });
                } else {
                  setModeConfig({
                    ...(modeConfig || {}),
                    booleanOperation: operation
                  });
                }
              }}
            >
              {operation}
            </ToolboxButton>
          ))}
        </ToolboxControl>
      </ToolboxRow>
    );
  }, [modeConfig]);

  const renderTwoClickPolygonControls = useCallback(() => {
    return (
      <ToolboxRow key="twoClick">
        <ToolboxTitle>Drag to draw</ToolboxTitle>
        <ToolboxControl>
          <input
            type="checkbox"
            checked={Boolean(modeConfig && modeConfig.dragToDraw)}
            onChange={(event) =>
              setModeConfig({
                ...(modeConfig || {}),
                dragToDraw: Boolean(event.target.checked)
              })
            }
          />
        </ToolboxControl>
      </ToolboxRow>
    );
  }, [modeConfig]);

  const renderModifyModeControls = useCallback(() => {
    return (
      <ToolboxRow key="modify">
        <ToolboxTitle>Allow removing points</ToolboxTitle>
        <ToolboxControl>
          <input
            type="checkbox"
            checked={pointsRemovable}
            onChange={() => setPointsRemovable(!pointsRemovable)}
          />
        </ToolboxControl>
      </ToolboxRow>
    );
  }, [pointsRemovable]);

  const renderSplitModeControls = useCallback(() => {
    return (
      <ToolboxRow key="split">
        <ToolboxTitle>Constrain to 90&deg;</ToolboxTitle>
        <ToolboxControl>
          <input
            type="checkbox"
            checked={Boolean(modeConfig && modeConfig.lock90Degree)}
            onChange={(event) =>
              setModeConfig({lock90Degree: Boolean(event.target.checked)})
            }
          />
        </ToolboxControl>
      </ToolboxRow>
    );
  }, [modeConfig]);

  const renderSnappingControls = useCallback(() => {
    return (
      <div key="snap">
        <ToolboxRow>
          <ToolboxTitle>Enable snapping</ToolboxTitle>
          <ToolboxControl>
            <input
              type="checkbox"
              checked={Boolean(modeConfig && modeConfig.enableSnapping)}
              onChange={(event) => {
                const newModeConfig = {
                  ...modeConfig,
                  enableSnapping: Boolean(event.target.checked)
                };
                setModeConfig(newModeConfig);
              }}
            />
          </ToolboxControl>
        </ToolboxRow>
      </div>
    );
  }, [modeConfig]);

  const renderMeasureDistanceControls = useCallback(() => {
    return (
      <ToolboxRow key="measure-distance">
        <ToolboxTitle>Units</ToolboxTitle>
        <ToolboxControl>
          <select
            value={
              (modeConfig &&
                modeConfig.turfOptions &&
                modeConfig.turfOptions.units) ||
              'kilometers'
            }
            onChange={(event) => {
              const newModeConfig = {
                ...modeConfig,
                turfOptions: {units: event.target.value}
              };
              setModeConfig(newModeConfig);
            }}
          >
            <option value="kilometers">kilometers</option>
            <option value="miles">miles</option>
            <option value="degrees">degrees</option>
            <option value="radians">radians</option>
          </select>
        </ToolboxControl>

        <ToolboxTitle>Center Tooltips on Line</ToolboxTitle>
        <ToolboxControl>
          <input
            type="checkbox"
            checked={Boolean(modeConfig && modeConfig.centerTooltipsOnLine)}
            onChange={(event) => {
              const newModeConfig = {
                ...modeConfig,
                centerTooltipsOnLine: Boolean(event.target.checked)
              };
              setModeConfig(newModeConfig);
            }}
          />
        </ToolboxControl>
      </ToolboxRow>
    );
  }, [modeConfig]);

  const renderDrawPolygonModeControls = useCallback(() => {
    const currentModeConfig = modeConfig || {};
    return (
      <React.Fragment key="draw-polygon">
        <ToolboxRow key="draw-polygon-holes">
          <ToolboxTitle>Allow Polygon Holes</ToolboxTitle>
          <ToolboxControl>
            <ToolboxCheckbox
              type="checkbox"
              checked={Boolean(currentModeConfig.allowHoles)}
              onChange={(event) =>
                setModeConfig({
                  ...currentModeConfig,
                  allowHoles: Boolean(event.target.checked),
                  allowSelfIntersection: Boolean(currentModeConfig.allowSelfIntersection),
                  maxHolesPerPolygon: 4,
                  emitInvalidEvents: true
                })
              }
            >
              Enable hole drawing
            </ToolboxCheckbox>
          </ToolboxControl>
        </ToolboxRow>
        <ToolboxRow key="draw-polygon-allow-intersect">
          <ToolboxTitle>Allow self-intersecting lines</ToolboxTitle>
          <ToolboxControl>
            <input
              type="checkbox"
              checked={Boolean(currentModeConfig.allowSelfIntersection)}
              onChange={(event) =>
                setModeConfig({
                  ...currentModeConfig,
                  allowSelfIntersection: Boolean(event.target.checked)
                })
              }
            />
          </ToolboxControl>
        </ToolboxRow>
        <ToolboxRow key="draw-polygon-help">
          <ToolboxTitle>Drawing tips</ToolboxTitle>
          <ToolboxControl>
            <div
              style={{
                padding: '12px 8px',
                fontSize: 12,
                lineHeight: 1.4,
                background: '#f0f0f0',
                color: '#000'
              }}
            >
              <div style={{marginBottom: '8px'}}>
                <strong>Hole drawing:</strong> Enable hole drawing, then close a polygon ring inside
                an existing polygon. Valid holes are automatically added and invalid ones trigger
                helpful warnings.
              </div>
              <div>
                <strong>Self-intersection:</strong> When "Prevent intersecting lines" is checked,
                figure-8 or bowtie-shaped polygons will be rejected. Uncheck to allow complex
                overlapping polygon shapes.
              </div>
            </div>
          </ToolboxControl>
        </ToolboxRow>
      </React.Fragment>
    );
  }, [modeConfig]);

  const renderModeConfigControls = useCallback(() => {
    const controls: React.ReactElement[] = [];

    if (POLYGON_DRAWING_MODES.indexOf(mode) > -1) {
      controls.push(renderBooleanOperationControls());
    }
    // @ts-expect-error TODO
    if (TWO_CLICK_POLYGON_MODES.indexOf(mode) > -1) {
      controls.push(renderTwoClickPolygonControls());
    }
    if (mode === ModifyMode) {
      controls.push(renderModifyModeControls());
    }
    if (mode === SplitPolygonMode) {
      controls.push(renderSplitModeControls());
    }
    if (mode instanceof SnappableMode) {
      controls.push(renderSnappingControls());
    }
    if (mode === MeasureDistanceMode) {
      controls.push(renderMeasureDistanceControls());
    }
    if (mode === DrawPolygonMode) {
      controls.push(renderDrawPolygonModeControls());
    }

    return controls;
  }, [mode, renderBooleanOperationControls, renderTwoClickPolygonControls, renderModifyModeControls,
      renderSplitModeControls, renderSnappingControls, renderMeasureDistanceControls, renderDrawPolygonModeControls]);

  const renderToolBox = useCallback(() => {
    return (
      <Toolbox>
        {ALL_MODES.map((category) => (
          <ToolboxRow key={category.category}>
            <ToolboxTitle>{category.category} Modes</ToolboxTitle>
            {category.modes.map(({mode: modeOption, label}) => (
              <ToolboxButton
                key={label}
                selected={mode === modeOption}
                onClick={() => {
                  setMode(modeOption);
                  setModeConfig(getDefaultModeConfig(modeOption));
                  setSelectionTool(undefined);
                }}
              >
                {label}
              </ToolboxButton>
            ))}
          </ToolboxRow>
        ))}
        {renderModeConfigControls()}
        {showGeoJson && (
          <React.Fragment>
            <ToolboxTitle>GeoJSON</ToolboxTitle>
            <ToolboxButton onClick={() => setShowGeoJson(!showGeoJson)}>
              hide &#9650;
            </ToolboxButton>
            <ToolboxControl>
              <textarea
                id="geo-json-text"
                rows={5}
                style={{width: '100%'}}
                value={JSON.stringify(testFeatures)}
                onChange={(event) => setTestFeatures(JSON.parse(event.target.value))}
              />
            </ToolboxControl>
          </React.Fragment>
        )}
        {!showGeoJson && (
          <React.Fragment>
            <ToolboxTitle>GeoJSON</ToolboxTitle>
            <ToolboxButton onClick={() => setShowGeoJson(!showGeoJson)}>
              show &#9660;
            </ToolboxButton>
          </React.Fragment>
        )}
        <ToolboxButton onClick={() => copy()}>Copy</ToolboxButton>
        <ToolboxButton onClick={() => paste()}>Paste</ToolboxButton>
        <ToolboxButton onClick={() => download()}>Download</ToolboxButton>
        <ToolboxRow>
          <ToolboxTitle>Load data</ToolboxTitle>
          <ToolboxControl>
            <ToolboxButton onClick={() => loadSample('mixed')}>Mixed Sample</ToolboxButton>
            <ToolboxButton onClick={() => loadSample('complex')}>
              Complex Sample
            </ToolboxButton>
            <ToolboxButton onClick={() => loadSample('blank')}>Blank</ToolboxButton>
            <ToolboxButton onClick={() => loadSample('file')}>Open file...</ToolboxButton>
          </ToolboxControl>
        </ToolboxRow>

        <ToolboxRow>
          <ToolboxTitle>Options</ToolboxTitle>
          <ToolboxControl>
            <ToolboxCheckbox
              type="checkbox"
              checked={editHandleType === 'icon'}
              onChange={() =>
                setEditHandleType(editHandleType === 'icon' ? 'point' : 'icon')
              }
            >
              Use Icons
            </ToolboxCheckbox>
          </ToolboxControl>

          <ToolboxControl>
            <ToolboxCheckbox
              type="checkbox"
              checked={editHandleType === 'elevated'}
              onChange={() =>
                setEditHandleType(editHandleType === 'elevated' ? 'point' : 'elevated')
              }
            >
              Use ElevatedEditHandleLayer
            </ToolboxCheckbox>
          </ToolboxControl>

          <ToolboxControl>
            <ToolboxCheckbox
              type="checkbox"
              checked={pathMarkerLayer}
              onChange={() =>
                setPathMarkerLayer(!pathMarkerLayer)
              }
            >
              Use PathMarkerLayer
            </ToolboxCheckbox>
          </ToolboxControl>
        </ToolboxRow>

        <ToolboxRow>
          <ToolboxTitle>Select Features</ToolboxTitle>
          <ToolboxControl>
            <ToolboxButton
              onClick={() => {
                setSelectedFeatureIndexes([]);
                setSelectionTool('none');
              }}
            >
              Clear Selection
            </ToolboxButton>
            <ToolboxButton
              onClick={() => {
                setMode(ViewMode);
                setSelectionTool('rectangle');
              }}
            >
              Rect Select
            </ToolboxButton>
            <ToolboxButton
              onClick={() => {
                setMode(ViewMode);
                setSelectionTool('polygon');
              }}
            >
              Lasso Select
            </ToolboxButton>
          </ToolboxControl>
        </ToolboxRow>
        <ToolboxTitle>Features</ToolboxTitle>
        <ToolboxRow>{renderSelectFeatureCheckboxes()}</ToolboxRow>
      </Toolbox>
    );
  }, [mode, showGeoJson, testFeatures, copy, paste, download, loadSample, editHandleType,
      pathMarkerLayer, renderModeConfigControls, renderSelectFeatureCheckboxes, getDefaultModeConfig]);

  const renderStaticMap = useCallback((currentViewport: Record<string, any>) => {
    return (
      <StaticMap
        {...currentViewport}
        mapStyle={'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'}
      />
    );
  }, []);

  const featureMenuClick = useCallback((action: string) => {
    const {index} = featureMenu || {};
    let updatedFeatures = testFeatures;

    if (action === 'delete') {
      const features = [...updatedFeatures.features];
      features.splice(index as any, 1);
      updatedFeatures = Object.assign({}, updatedFeatures, {
        features
      });
    } else if (action === 'split') {
      // TODO
    } else if (action === 'info') {
      // eslint-disable-next-line
      console.log(updatedFeatures.features[index as any]);
    }

    setFeatureMenu(undefined);
    setTestFeatures(updatedFeatures);
  }, [featureMenu, testFeatures]);

  const renderFeatureMenu = useCallback(({x, y}: {x: number; y: number}) => {
    return (
      <div style={{position: 'fixed', top: y - 40, left: x + 20}}>
        <ToolboxButton onClick={() => featureMenuClick('delete')}>Delete</ToolboxButton>
        <ToolboxButton onClick={() => featureMenuClick('split')}>Split</ToolboxButton>
        <ToolboxButton onClick={() => featureMenuClick('info')}>Info</ToolboxButton>
        <ToolboxButton onClick={() => featureMenuClick('')}>Close</ToolboxButton>
      </div>
    );
  }, [featureMenuClick]);

  const onEdit = useCallback(({updatedData, editType, editContext}) => {
    let updatedSelectedFeatureIndexes = selectedFeatureIndexes;

    if (
      ![
        'movePosition',
        'extruding',
        'rotating',
        'translating',
        'scaling',
        'updateTentativeFeature'
      ].includes(editType)
    ) {
      // Don't log edits that happen as the pointer moves since they're really chatty
      const updatedDataInfo = featuresToInfoString(updatedData);
      // eslint-disable-next-line
      console.log('onEdit', editType, editContext, updatedDataInfo);

      // Special logging for hole-related events
      if (editType === 'addHole' || editType === 'invalidHole') {
        // eslint-disable-next-line
        console.log('🕳️ Hole event:', editType, editContext);
      }
    }

    if (editType === 'removePosition' && !pointsRemovable) {
      // This is a simple example of custom handling of edits
      // reject the edit
      return;
    }

    if (editType === 'addFeature' && mode !== DuplicateMode) {
      const {featureIndexes} = editContext;
      // Add the new feature to the selection
      updatedSelectedFeatureIndexes = [...selectedFeatureIndexes, ...featureIndexes];
    }

    setTestFeatures(updatedData);
    setSelectedFeatureIndexes(updatedSelectedFeatureIndexes);
  }, [selectedFeatureIndexes, pointsRemovable, mode]);

  const getFillColor = useCallback((feature, isSelected) => {
    const index = testFeatures.features.indexOf(feature);
    return isSelected
      ? getDeckColorForFeature(index, 1.0, 0.5)
      : getDeckColorForFeature(index, 0.5, 0.5);
  }, [testFeatures.features, getDeckColorForFeature]);

  const getLineColor = useCallback((feature, isSelected) => {
    const index = testFeatures.features.indexOf(feature);
    return isSelected
      ? getDeckColorForFeature(index, 1.0, 1.0)
      : getDeckColorForFeature(index, 0.5, 1.0);
  }, [testFeatures.features, getDeckColorForFeature]);

  // eslint-disable-next-line complexity
  const currentViewport: Record<string, any> = {
    ...viewport,
    height: window.innerHeight,
    width: window.innerWidth
  };

  let currentModeConfig = modeConfig;

  if (mode === ElevationMode) {
    currentModeConfig = {
      ...currentModeConfig,
      viewport: currentViewport,
      calculateElevationChange: (opts) =>
        ElevationMode.calculateElevationChangeWithViewport(currentViewport, opts)
    };
  } else if (mode === ModifyMode) {
    currentModeConfig = {
      ...currentModeConfig,
      viewport: currentViewport,
      lockRectangles: true
    };
  } else if (mode instanceof SnappableMode && currentModeConfig) {
    if (mode._handler instanceof TranslateMode) {
      currentModeConfig = {
        ...currentModeConfig,
        viewport: currentViewport,
        screenSpace: true
      };
    }

    if (currentModeConfig && currentModeConfig.enableSnapping) {
      // Snapping can be accomplished to features that aren't rendered in the same layer
      currentModeConfig = {
        ...currentModeConfig,
        additionalSnapTargets: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.52235, 37.734008],
                  [-122.52217, 37.712706],
                  [-122.49436, 37.711979],
                  [-122.49725, 37.734306],
                  [-122.52235, 37.734008]
                ]
              ]
            }
          }
        ]
      };
    }
  } else if (mode === DrawPolygonByDraggingMode) {
    currentModeConfig = {
      ...currentModeConfig,
      throttleMs: 100
    };
  }

  // Demonstrate how to override sub layer properties
  let _subLayerProps = {
    tooltips: {
      getColor: [255, 255, 255, 255]
    }
  };

  if (editHandleType === 'elevated') {
    _subLayerProps = Object.assign(_subLayerProps, {
      guides: {
        _subLayerProps: {
          points: {
            type: ElevatedEditHandleLayer,
            getFillColor: [0, 255, 0]
          }
        }
      }
    });
  }

  if (pathMarkerLayer) {
    _subLayerProps = Object.assign(_subLayerProps, {
      geojson: {
        _subLayerProps: {
          linestrings: {
            type: PathMarkerLayer,
            getMarkerColor: (x) => [255, 255, 255, 255],
            sizeScale: 1500
          }
        }
      }
    });
  }

  const editableGeoJsonLayer = new EditableGeoJsonLayer({
    id: 'geojson',
    data: testFeatures,
    // @ts-expect-error TODO
    selectedFeatureIndexes,
    mode,
    modeConfig: currentModeConfig,
    autoHighlight: false,

    // Editing callbacks
    onEdit,

    editHandleType,

    // test using icons for edit handles
    editHandleIconAtlas: iconSheet,
    editHandleIconMapping: {
      intermediate: {
        x: 0,
        y: 0,
        width: 58,
        height: 58,
        mask: false
      },
      existing: {
        x: 58,
        y: 0,
        width: 58,
        height: 58,
        mask: false
      },
      'snap-source': {
        x: 58,
        y: 0,
        width: 58,
        height: 58,
        mask: false
      },
      'snap-target': {
        x: 0,
        y: 0,
        width: 58,
        height: 58,
        mask: false
      }
    },
    getEditHandleIcon: (d) => getEditHandleTypeFromEitherLayer(d),
    getEditHandleIconSize: 40,
    getEditHandleIconColor: getEditHandleColor,

    // Specify the same GeoJsonLayer props
    // lineWidthMinPixels: 2,
    pointRadiusMinPixels: 5,
    // getLineDashArray: () => [0, 0],

    // Accessors receive an isSelected argument
    getFillColor,
    getLineColor,

    // Can customize editing points props
    getEditHandlePointColor: getEditHandleColor,
    editHandlePointRadiusScale: 2,

    // customize tentative feature style
    // getTentativeLineDashArray: () => [7, 4],
    // getTentativeLineColor: () => [0x8f, 0x8f, 0x8f, 0xff],

    _subLayerProps,

    parameters: {
      depthTest: true,
      depthMask: false,

      blend: true,
      blendEquation: GL.FUNC_ADD,
      blendFunc: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA]
    }
  });

  const layers = [editableGeoJsonLayer];

  if (selectionTool) {
    layers.push(
      // @ts-expect-error TODO
      new SelectionLayer({
        id: 'selection',
        // @ts-expect-error TODO
        selectionType: selectionTool,
        onSelect: ({pickingInfos}) => {
          setSelectedFeatureIndexes(pickingInfos.map((pi) => pi.index));
        },
        layerIds: ['geojson'],

        getTentativeFillColor: () => [255, 0, 255, 100],
        getTentativeLineColor: () => [0, 0, 255, 255],
        lineWidthMinPixels: 3
      })
    );
  }

  return (
    <div style={styles.mapContainer}>
      <DeckGL
        viewState={currentViewport}
        getCursor={editableGeoJsonLayer.getCursor.bind(editableGeoJsonLayer)}
        layers={layers}
        height="100%"
        width="100%"
        views={[
          new MapView({
            id: 'basemap',
            controller: {
              type: MapController,
              doubleClickZoom: false
            }
          })
        ]}
        onClick={onLayerClick}
        onViewStateChange={({viewState}) => setViewport(viewState)}
      >
        {renderStaticMap(currentViewport)}
      </DeckGL>
      {renderToolBox()}
      {featureMenu && renderFeatureMenu(featureMenu)}
    </div>
  );
}

export default Example;

function featuresToInfoString(featureCollection: any): string {
  const info = featureCollection.features.map(
    (feature) => `${feature.geometry.type}(${getPositionCount(feature.geometry)})`
  );

  return JSON.stringify(info);
}

function getPositionCount(geometry): number {
  const flatMap = (f, arr) => arr.reduce((x, y) => [...x, ...f(y)], []);

  const {type, coordinates} = geometry;
  switch (type) {
    case 'Point':
      return 1;
    case 'LineString':
    case 'MultiPoint':
      return coordinates.length;
    case 'Polygon':
    case 'MultiLineString':
      return flatMap((x) => x, coordinates).length;
    case 'MultiPolygon':
      return flatMap((x) => flatMap((y) => y, x), coordinates).length;
    default:
      throw Error(`Unknown geometry type: ${type}`);
  }
}
