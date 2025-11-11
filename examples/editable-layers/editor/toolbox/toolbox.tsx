import * as React from 'react';
import {
  ViewMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawPolygonMode,
  DrawCircleFromCenterMode,
  DrawRectangleMode,
  MeasureDistanceMode,
  MeasureAngleMode,
  MeasureAreaMode,
  type GeoJsonEditModeConstructor,
  type GeoJsonEditModeType
} from '@deck.gl-community/editable-layers';
import styled from 'styled-components';

import {ImportModal} from './import-modal';
import {ExportModal} from './export-modal';
import type {FeatureCollection} from 'geojson';

import pointerIconUrl from 'boxicons/svg/regular/bx-pointer.svg?url';
import mapPinIconUrl from 'boxicons/svg/regular/bx-map-pin.svg?url';
import statsIconUrl from 'boxicons/svg/regular/bx-stats.svg?url';
import polygonIconUrl from 'boxicons/svg/regular/bx-shape-polygon.svg?url';
import rectangleIconUrl from 'boxicons/svg/regular/bx-rectangle.svg?url';
import circleIconUrl from 'boxicons/svg/regular/bx-circle.svg?url';
import rulerIconUrl from 'boxicons/svg/regular/bx-ruler.svg?url';
import triangleIconUrl from 'boxicons/svg/regular/bx-shape-triangle.svg?url';
import squareIconUrl from 'boxicons/svg/regular/bx-shape-square.svg?url';
import exportIconUrl from 'boxicons/svg/regular/bx-export.svg?url';
import importIconUrl from 'boxicons/svg/regular/bx-import.svg?url';
import chevronRightIconUrl from 'boxicons/svg/regular/bx-chevron-right.svg?url';
import minusFrontIconUrl from 'boxicons/svg/regular/bx-minus-front.svg?url';
import uniteIconUrl from 'boxicons/svg/regular/bx-unite.svg?url';
import intersectIconUrl from 'boxicons/svg/regular/bx-intersect.svg?url';
import cogIconUrl from 'boxicons/svg/regular/bx-cog.svg?url';
import trashIconUrl from 'boxicons/svg/regular/bx-trash.svg?url';

const Tools = styled.div<{$left: boolean}>`
  position: absolute;
  display: flex;
  flex-direction: column;
  top: 10px;
  ${(props) => (props.$left ? 'left' : 'right')}: 10px;
`;

const Button = styled.button<{$active?: boolean; $kind?: 'danger'}>`
  color: #fff;
  background: ${({$kind, $active}) =>
    $kind === 'danger' ? 'rgb(180, 40, 40)' : $active ? 'rgb(0, 105, 217)' : 'rgb(90, 98, 94)'};
  font-size: 1em;
  font-weight: 400;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
    'Noto Color Emoji';
  border: 1px solid transparent;
  border-radius: 0.25em;
  margin: 0.05em;
  padding: 0.1em 0.2em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25em;
  :hover {
    background: rgb(128, 137, 133);
  }
`;

const SubToolsContainer = styled.div`
  position: relative;
`;

const SubTools = styled.div<{$left: boolean}>`
  display: flex;
  flex-direction: row-reverse;
  position: absolute;
  top: 0;
  ${(props) => (props.$left ? 'left' : 'right')}: 0;
`;

const ICON_SIZE = 20;

type IconImageProps = {
  src: string;
  label?: string;
  ariaHidden?: boolean;
};

function IconImage({src, label, ariaHidden = false}: IconImageProps) {
  return (
    <img
      src={src}
      alt={ariaHidden ? '' : label ?? ''}
      aria-hidden={ariaHidden ? true : undefined}
      width={ICON_SIZE}
      height={ICON_SIZE}
      style={{display: 'block'}}
      draggable={false}
    />
  );
}

const ICONS = {
  pointer: pointerIconUrl,
  mapPin: mapPinIconUrl,
  stats: statsIconUrl,
  polygon: polygonIconUrl,
  rectangle: rectangleIconUrl,
  circle: circleIconUrl,
  ruler: rulerIconUrl,
  triangle: triangleIconUrl,
  square: squareIconUrl,
  export: exportIconUrl,
  import: importIconUrl,
  chevronRight: chevronRightIconUrl,
  minusFront: minusFrontIconUrl,
  unite: uniteIconUrl,
  intersect: intersectIconUrl,
  cog: cogIconUrl,
  trash: trashIconUrl
} as const;

type ModeOption = {
  mode: GeoJsonEditModeConstructor | GeoJsonEditModeType;
  icon: string;
  label: string;
};

type ModeGroup = {
  modes: ModeOption[];
};

export type Props = {
  left?: boolean;
  mode: GeoJsonEditModeConstructor | GeoJsonEditModeType;
  modeConfig: Record<string, unknown>;
  geoJson: FeatureCollection;
  onSetMode: (mode: GeoJsonEditModeConstructor | GeoJsonEditModeType) => void;
  onSetModeConfig: (modeConfig: Record<string, unknown>) => void;
  onSetGeoJson: (geojson: FeatureCollection) => void;
  onImport: (imported: FeatureCollection) => void;
};

const MODE_GROUPS: ModeGroup[] = [
  {
    modes: [{mode: ViewMode, icon: ICONS.pointer, label: 'View mode'}]
  },
  {
    modes: [{mode: DrawPointMode, icon: ICONS.mapPin, label: 'Draw point'}]
  },
  {
    modes: [{mode: DrawLineStringMode, icon: ICONS.stats, label: 'Draw line string'}]
  },
  {
    modes: [
      {mode: DrawPolygonMode, icon: ICONS.polygon, label: 'Draw polygon'},
      {mode: DrawRectangleMode, icon: ICONS.rectangle, label: 'Draw rectangle'},
      {mode: DrawCircleFromCenterMode, icon: ICONS.circle, label: 'Draw circle'}
    ]
  },
  {
    modes: [
      {mode: MeasureDistanceMode, icon: ICONS.ruler, label: 'Measure distance'},
      {mode: MeasureAngleMode, icon: ICONS.triangle, label: 'Measure angle'},
      {mode: MeasureAreaMode, icon: ICONS.square, label: 'Measure area'}
    ]
  }
];

function ModeButton({
  buttonConfig,
  mode,
  onClick
}: {
  buttonConfig: ModeOption;
  mode: GeoJsonEditModeConstructor | GeoJsonEditModeType;
  onClick: () => void;
}) {
  const isActive = buttonConfig.mode === mode;
  return (
    <Button
      type="button"
      $active={isActive}
      onClick={onClick}
      title={buttonConfig.label}
      aria-label={buttonConfig.label}
      aria-pressed={isActive}
    >
      <IconImage src={buttonConfig.icon} ariaHidden={true} />
    </Button>
  );
}

function ModeGroupButtons({
  left,
  modeGroup,
  mode,
  onSetMode
}: {
  left?: boolean;
  modeGroup: ModeGroup;
  mode: GeoJsonEditModeConstructor | GeoJsonEditModeType;
  onSetMode: (mode: GeoJsonEditModeConstructor | GeoJsonEditModeType) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const {modes} = modeGroup;

  let subTools = null;

  if (expanded) {
    subTools = (
      <SubTools $left={Boolean(left)}>
        {modes.map((buttonConfig, i) => (
          <ModeButton
            key={i}
            buttonConfig={buttonConfig}
            mode={mode}
            onClick={() => {
              onSetMode(buttonConfig.mode);
              setExpanded(false);
            }}
          />
        ))}
      </SubTools>
    );
  }

  // Get the button config if it is active otherwise, choose the first
  const buttonConfig = modes.find((m) => m.mode === mode) || modes[0];

  return (
    <SubToolsContainer>
      {subTools}
      <ModeButton
        buttonConfig={buttonConfig}
        mode={mode}
        onClick={() => {
          onSetMode(buttonConfig.mode);
          setExpanded(true);
        }}
      />
    </SubToolsContainer>
  );
}

export function Toolbox({
  left = false,
  mode,
  modeConfig,
  geoJson,
  onSetMode,
  onSetModeConfig,
  onSetGeoJson,
  onImport
}: Props) {
  const [showConfig, setShowConfig] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [showExport, setShowExport] = React.useState(false);
  const [showClearConfirmation, setShowClearConfirmation] = React.useState(false);
  const booleanOperation =
    typeof modeConfig?.['booleanOperation'] === 'string'
      ? (modeConfig['booleanOperation'] as string)
      : null;

  return (
    <>
      <Tools $left={Boolean(left)}>
        {MODE_GROUPS.map((modeGroup, i) => (
          <ModeGroupButtons
            left={left}
            key={i}
            modeGroup={modeGroup}
            mode={mode}
            onSetMode={onSetMode}
          />
        ))}

        {/* <box-icon name='current-location' ></box-icon> */}
        <Button
          type="button"
          onClick={() => setShowExport(true)}
          title="Export"
          aria-label="Export"
        >
          <IconImage src={ICONS.export} ariaHidden={true} />
        </Button>
        <Button
          type="button"
          onClick={() => setShowImport(true)}
          title="Import"
          aria-label="Import"
        >
          <IconImage src={ICONS.import} ariaHidden={true} />
        </Button>

        <SubToolsContainer>
          {showConfig && (
            <SubTools $left={Boolean(left)}>
              <Button
                type="button"
                onClick={() => setShowConfig(false)}
                title="Close boolean operation options"
                aria-label="Close boolean operation options"
              >
                <IconImage src={ICONS.chevronRight} ariaHidden={true} />
              </Button>
              <Button
                type="button"
                onClick={() => onSetModeConfig({booleanOperation: 'difference'})}
                $active={booleanOperation === 'difference'}
                title="Subtract"
                aria-label="Subtract"
              >
                <IconImage src={ICONS.minusFront} ariaHidden={true} />
              </Button>
              <Button
                type="button"
                onClick={() => onSetModeConfig({booleanOperation: 'union'})}
                $active={booleanOperation === 'union'}
                title="Union"
                aria-label="Union"
              >
                <IconImage src={ICONS.unite} ariaHidden={true} />
              </Button>
              <Button
                type="button"
                onClick={() => onSetModeConfig({booleanOperation: 'intersection'})}
                $active={booleanOperation === 'intersection'}
                title="Intersect"
                aria-label="Intersect"
              >
                <IconImage src={ICONS.intersect} ariaHidden={true} />
              </Button>
              {/* <Button onClick={() => setShowConfig(false)}>
                <IconImage src={ICONS.chevronRight} ariaHidden={true} />
              </Button> */}
            </SubTools>
          )}
          <Button
            type="button"
            onClick={() => setShowConfig(true)}
            title="Boolean operations"
            aria-label="Boolean operations"
          >
            <IconImage src={ICONS.cog} ariaHidden={true} />
          </Button>
        </SubToolsContainer>

        <SubToolsContainer>
          {showClearConfirmation && (
            <SubTools $left={Boolean(left)}>
              <Button
                type="button"
                onClick={() => {
                  onSetGeoJson({type: 'FeatureCollection', features: []});
                  setShowClearConfirmation(false);
                }}
                $kind="danger"
                title="Clear all features"
              >
                Clear all features
                <IconImage src={ICONS.trash} ariaHidden={true} />
              </Button>
              <Button type="button" onClick={() => setShowClearConfirmation(false)}>
                Cancel
              </Button>
            </SubTools>
          )}
          <Button
            type="button"
            onClick={() => setShowClearConfirmation(true)}
            title="Clear"
            aria-label="Clear"
          >
            <IconImage src={ICONS.trash} ariaHidden={true} />
          </Button>
        </SubToolsContainer>

        {/* zoom in and out */}
      </Tools>

      {/*
      {showImport && (
        <ImportModal
          onImport={(imported) => {
            onImport(imported);
            setShowImport(false);
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {showExport && <ExportModal geoJson={geoJson} onClose={() => setShowExport(false)} />}
      */}
    </>
  );
}
