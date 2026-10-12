/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import {concat} from './array';
import {SquareSymbolLayer} from './square-symbol-layer';
import type {Vec3, GeographicMark} from './interfaces';
import {base} from './base';
import {layerNames} from './constants';
import {
  CubeLayer,
  type CubeLayerInterpolatedProps,
  type CubeLayerProps
} from './cube-layer/cube-layer';
import {LinearInterpolator_Class} from './deck.gl-classes/linear-interpolator';
import {easing} from './easing';
import {
  type Cube,
  type SymbolMark,
  type PresenterConfig,
  type Stage,
  type StyledLine,
  type VegaTextLayerDatum,
  type Path,
  type Polygon
} from './interfaces';
import {Presenter} from './presenter';
import type {Color} from './legacy-types';
import {type DeckProps, type CompositeLayerProps, Layer} from '@deck.gl/core';
type TransitionSettings = {duration: number; type: 'interpolation'; easing?: (t: number) => number};
import {type TextLayerProps} from '@deck.gl/layers';

export function getLayers(
  presenter: Presenter,
  config: PresenterConfig,
  stage: Stage,
  lightSettings: any /* LightSettings*/,
  lightingMix: number,
  interpolator: LinearInterpolator_Class<CubeLayerInterpolatedProps>,
  guideLines: StyledLine[]
): Layer<any>[] {
  const cubeLayer = newCubeLayer(
    presenter,
    config,
    stage.cubeData,
    presenter.style.highlightColor,
    lightSettings,
    lightingMix,
    interpolator
  );
  const {x, y, z} = stage.axes;
  const lines = concat(stage.gridLines, guideLines);
  const texts = [...stage.textData];
  [x, y, z].forEach(axes => {
    axes.forEach(axis => {
      if (axis.domain) lines.push(axis.domain);
      if (axis.ticks) lines.push(...axis.ticks);
      if (axis.tickText) texts.push(...axis.tickText);
      if (axis.title) texts.push(axis.title);
    });
  });
  let characterSet: string[];
  if (config.getCharacterSet) {
    characterSet = config.getCharacterSet(stage);
  } else {
    // Basic symbols, numbers, and uppercase / lowercase alphabet
    characterSet = new Array(95).fill(1).map((_, i) => String.fromCharCode(32 + i));
  }
  if (stage.facets) {
    stage.facets.forEach(f => {
      if (f.lines) lines.push(...f.lines);
    });
  }
  const lineLayer = newLineLayer(layerNames.lines, lines);
  const textLayer = newTextLayer(
    presenter,
    layerNames.text,
    texts,
    config,
    presenter.style.fontFamily,
    characterSet
  );
  const pathLayer = newPathLayer(
    layerNames.paths,
    stage.pathData?.filter(path => !path.isGeographic)
  );
  const polygonData = stage.polygonData ?? [];
  const polygonLayer = newPolygonLayer(
    layerNames.polygons,
    polygonData.filter(polygon => !polygon.isSymbol && !polygon.isGeographic)
  );
  const squareSymbolLayer = newSquareSymbolLayer(
    layerNames.symbolSquares,
    polygonData.filter(polygon => polygon.isSymbol),
    config
  );
  return [
    textLayer,
    cubeLayer,
    lineLayer,
    pathLayer,
    polygonLayer,
    ...createGeographicLayers(stage, polygonData),
    squareSymbolLayer,
    newSymbolLayer(stage.symbolData ?? [], config)
  ];
}

function createGeographicLayers(stage: Stage, polygons: Polygon[]): Layer[] {
  const marks: GeographicMark[] = stage.geographicData ?? [
    ...polygons.filter(p => p.isGeographic).map(data => ({type: 'polygon' as const, data})),
    ...(stage.pathData ?? [])
      .filter(p => p.isGeographic)
      .map(data => ({type: 'path' as const, data}))
  ];
  const layers: Layer[] = [];
  const counts = {polygon: 0, path: 0};
  for (let index = 0; index < marks.length; ) {
    const type = marks[index].type;
    const batch = [];
    while (index < marks.length && marks[index].type === type) batch.push(marks[index++].data);
    const baseId = type === 'polygon' ? layerNames.geographicPolygons : layerNames.geographicPaths;
    const count = counts[type]++;
    const id = count ? `${baseId}-${count}` : baseId;
    layers.push(
      type === 'polygon'
        ? newPolygonLayer(id, batch as Polygon[], true)
        : newPathLayer(id, batch as Path[], true)
    );
  }
  return layers;
}

function newSquareSymbolLayer(id: string, data: Polygon[], config: PresenterConfig) {
  const points = (item: Polygon) => item.positions as Vec3[];
  return new SquareSymbolLayer({
    id,
    data,
    coordinateSystem: base.deck.COORDINATE_SYSTEM.CARTESIAN,
    radiusUnits: 'common',
    lineWidthUnits: 'pixels',
    pickable: true,
    stroked: true,
    filled: true,
    getPosition: item =>
      points(item)
        .reduce((sum, p) => sum.map((v, i) => v + (p[i] || 0)) as Vec3, [0, 0, 0])
        .map(v => v / points(item).length) as Vec3,
    getRadius: item =>
      Math.hypot(points(item)[1][0] - points(item)[0][0], points(item)[1][1] - points(item)[0][1]) /
      2,
    getAngle: item =>
      item.angle ??
      Math.atan2(points(item)[1][1] - points(item)[0][1], points(item)[1][0] - points(item)[0][0]),
    getFillColor: item => item.fillColor,
    getLineColor: item => item.strokeColor,
    getLineWidth: item => item.strokeWidth,
    transitions: {
      getPosition: getTiming(config.transitionDurations.position, easing),
      getRadius: config.transitionDurations.size
        ? {...getTiming(config.transitionDurations.size, easing), enter: () => [0]}
        : undefined,
      getAngle: getTiming(config.transitionDurations.position, easing),
      getFillColor: getTiming(config.transitionDurations.color),
      getLineColor: getTiming(config.transitionDurations.color),
      getLineWidth: getTiming(config.transitionDurations.size)
    }
  });
}

function newSymbolLayer(data: SymbolMark[], config: PresenterConfig) {
  return new base.layers.ScatterplotLayer<SymbolMark>({
    id: layerNames.symbols,
    data,
    coordinateSystem: base.deck.COORDINATE_SYSTEM.CARTESIAN,
    transitions: {
      getPosition: getTiming(config.transitionDurations.position, easing),
      getRadius: config.transitionDurations.size
        ? {...getTiming(config.transitionDurations.size, easing), enter: () => [0]}
        : undefined,
      getFillColor: getTiming(config.transitionDurations.color),
      getLineColor: getTiming(config.transitionDurations.color),
      getLineWidth: getTiming(config.transitionDurations.size)
    },
    radiusUnits: 'common',
    lineWidthUnits: 'pixels',
    pickable: true,
    stroked: true,
    filled: true,
    getPosition: item => item.position,
    getRadius: item => item.radius,
    getFillColor: item => item.fillColor,
    getLineColor: item => item.strokeColor,
    getLineWidth: item => item.strokeWidth
  });
}

function newCubeLayer(
  presenter: Presenter,
  config: PresenterConfig,
  cubeData: Cube[],
  highlightColor: Color,
  lightSettings: any /* LightSettings*/,
  lightingMix: number,
  interpolator?: LinearInterpolator_Class<CubeLayerInterpolatedProps>
) {
  const getPosition = getTiming(config.transitionDurations.position, easing);
  const getSize = getTiming(config.transitionDurations.size, easing);
  const getColor = getTiming(config.transitionDurations.color);
  const cubeLayerProps: CubeLayerProps = {
    interpolator,
    lightingMix,
    id: layerNames.cubes,
    data: cubeData,
    coordinateSystem: base.deck.COORDINATE_SYSTEM.CARTESIAN,
    pickable: true,
    autoHighlight: true,
    highlightColor,
    onClick: (o, e) => {
      config.onCubeClick(e && e.srcEvent, o.object as Cube);
    },
    onHover: (o, e) => {
      if (o.index === -1) {
        presenter.deckgl.interactiveState.onCube = false;
        config.onCubeHover(e && e.srcEvent, null);
      } else {
        presenter.deckgl.interactiveState.onCube = true;
        config.onCubeHover(e && e.srcEvent, o.object as Cube);
      }
    },
    // lightSettings,
    transitions: {
      getPosition,
      getColor,
      getSize: typeof getSize === 'object' ? {...getSize, enter: () => [0, 0, 0]} : getSize
    }
  };
  return new CubeLayer(cubeLayerProps);
}

function newLineLayer(id: string, data: StyledLine[]) {
  return new base.layers.LineLayer({
    id,
    data,
    widthUnits: 'pixels',
    coordinateSystem: base.deck.COORDINATE_SYSTEM.CARTESIAN,
    getColor: (o: StyledLine) => o.color,
    getWidth: (o: StyledLine) => o.strokeWidth
  });
}

function newPathLayer(id: string, data: Path[], geographic = false) {
  if (!data) return null;

  return new base.layers.PathLayer<Path>({
    id,
    data,
    billboard: true,
    widthScale: 1,
    widthMinPixels: 0,
    pickable: true,
    widthUnits: 'pixels',
    coordinateSystem: base.deck.COORDINATE_SYSTEM.CARTESIAN,
    parameters: geographic ? {depthWriteEnabled: false, depthCompare: 'always'} : undefined,
    getPath: o => o.positions,
    getColor: o => o.strokeColor,
    getWidth: o => o.strokeWidth
  });
}

function newPolygonLayer(id: string, data: Polygon[], isSymbol = false) {
  if (!data) return null;

  const newlayer = new base.layers.PolygonLayer<Polygon>({
    id,
    data,
    coordinateSystem: base.deck.COORDINATE_SYSTEM.CARTESIAN,
    parameters: isSymbol ? {depthWriteEnabled: false, depthCompare: 'always'} : undefined,
    getPolygon: o => o.positions,
    getFillColor: o => o.fillColor,
    getLineColor: o => o.strokeColor,
    wireframe: false,
    filled: true,
    stroked: true,
    pickable: true,
    extruded: !isSymbol,
    lineWidthUnits: isSymbol ? 'pixels' : 'meters',
    getElevation: o => o.depth,
    getLineWidth: o => o.strokeWidth
  });
  return newlayer;
}

function newTextLayer(
  presenter: Presenter,
  id: string,
  data: VegaTextLayerDatum[],
  config: PresenterConfig,
  fontFamily: string,
  characterSet: string[]
) {
  let alphaCutoff = config.getTextHighlightAlphaCutoff && config.getTextHighlightAlphaCutoff();
  if (alphaCutoff === undefined) {
    alphaCutoff = 0.1;
  }
  const props: TextLayerProps<VegaTextLayerDatum> & Pick<CompositeLayerProps, '_subLayerProps'> = {
    id,
    data,
    characterSet,
    _subLayerProps: {characters: {alphaCutoff}},
    coordinateSystem: base.deck.COORDINATE_SYSTEM.CARTESIAN,
    sizeUnits: 'pixels',
    autoHighlight: true,
    pickable: true,
    highlightColor: p => {
      if (config.getTextHighlightColor) {
        return config.getTextHighlightColor(p.object);
      }
      return [0, 0, 0, 0];
    },
    onClick: (o, e) => {
      const pe: Partial<PointerEvent> = e && e.srcEvent;
      if (config.onTextClick)
        config.onTextClick(pe as PointerEvent, o.object as VegaTextLayerDatum);
    },
    onHover: (o, e) => {
      if (o.index === -1) {
        presenter.deckgl.interactiveState.onText = false;
      } else {
        presenter.deckgl.interactiveState.onText = config.onTextHover
          ? config.onTextHover(e && e.srcEvent, o.object as VegaTextLayerDatum)
          : true;
      }
    },
    getColor: config.getTextColor || (o => o.color),
    getTextAnchor: o => o.textAnchor,
    getSize: o => o.size,
    getAngle: o => o.angle,
    fontSettings: {
      sdf: false,
      fontSize: 128,
      buffer: 3
    }
  };
  if (fontFamily) {
    props.fontFamily = fontFamily;
  }

  return new base.layers.TextLayer(props);
}

function getTiming(duration: number, easingFunction?: (t: number) => number) {
  let timing: TransitionSettings;
  if (duration) {
    timing = {
      duration,
      type: 'interpolation'
    };
    if (easingFunction) {
      timing.easing = easingFunction;
    }
  }
  return timing;
}

export function getCubeLayer(deckProps: Partial<DeckProps<import('@deck.gl/core').OrbitView[]>>) {
  const findLayer = (layers: unknown): Layer | undefined => {
    if (Array.isArray(layers)) {
      for (const entry of layers) {
        const found = findLayer(entry);
        if (found) return found;
      }
    } else if (layers instanceof base.deck.Layer && layers.id === layerNames.cubes) return layers;
    return undefined;
  };
  return findLayer(deckProps.layers);
}

export function getCubes(deckProps: Partial<DeckProps<import('@deck.gl/core').OrbitView[]>>) {
  const cubeLayer = getCubeLayer(deckProps);
  if (!cubeLayer) return undefined;
  const cubeLayerProps = cubeLayer.props as unknown as CubeLayerProps;
  return cubeLayerProps.data;
}
