// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, WebMercatorViewport, type MapViewState, type PickingInfo} from '@deck.gl/core';
import {
  DependencyArrowLayer,
  PathDirection,
  PathOutlineLayer,
  PathMarkerLayer
} from '@deck.gl-community/layers';
import {MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

const ROUTE_OUTLINE_COLOR: [number, number, number, number] = [255, 255, 255, 245];
const TRAIL_OUTLINE_COLOR: [number, number, number, number] = [255, 255, 255, 235];
const DEPENDENCY_OUTLINE_COLOR: [number, number, number, number] = [255, 255, 255, 235];
const DEPENDENCY_MARKER_COLOR: [number, number, number, number] = [15, 23, 42, 170];

type TransitRoute = {
  name: string;
  path: [number, number][];
  color: [number, number, number, number];
  markerColor: [number, number, number, number];
  width: number;
  direction: {forward: boolean; backward: boolean};
};

const TRANSIT_ROUTES: TransitRoute[] = [
  {
    name: 'Embarcadero Loop',
    path: [
      [-122.3959, 37.7946],
      [-122.4024, 37.7981],
      [-122.4091, 37.8033],
      [-122.4156, 37.8085],
      [-122.4209, 37.8118]
    ],
    color: [17, 138, 178, 220],
    markerColor: [12, 82, 112, 235],
    width: 4,
    direction: {forward: true, backward: false}
  },
  {
    name: 'Mission Flyer',
    path: [
      [-122.423, 37.7818],
      [-122.4168, 37.7778],
      [-122.4099, 37.7719],
      [-122.405, 37.7659],
      [-122.4011, 37.7587]
    ],
    color: [245, 101, 101, 220],
    markerColor: [153, 27, 27, 235],
    width: 4,
    direction: {forward: true, backward: true}
  },
  {
    name: 'Twin Peaks Shuttle',
    path: [
      [-122.4468, 37.7681],
      [-122.4406, 37.7647],
      [-122.4338, 37.7633],
      [-122.4262, 37.7648],
      [-122.4193, 37.7675]
    ],
    color: [94, 234, 212, 220],
    markerColor: [13, 99, 89, 235],
    width: 5,
    direction: {forward: true, backward: false}
  }
];

type WaterfrontSegment = {
  name: string;
  path: [number, number][];
  color: [number, number, number, number];
  width: number;
  dashArray?: [number, number];
  zLevel?: number;
};

const WATERFRONT_SEGMENTS: WaterfrontSegment[] = [
  {
    name: 'Bay Trail',
    path: [
      [-122.3933, 37.7936],
      [-122.3908, 37.7985],
      [-122.3879, 37.8041],
      [-122.3849, 37.8096]
    ],
    color: [129, 140, 248, 220],
    width: 6,
    dashArray: [2.8, 2.6],
    zLevel: 1
  },
  {
    name: 'Presidio Promenade',
    path: [
      [-122.454, 37.8053],
      [-122.4474, 37.8037],
      [-122.4412, 37.8002],
      [-122.4366, 37.7971],
      [-122.431, 37.7948]
    ],
    color: [96, 165, 250, 220],
    width: 7,
    dashArray: [3.2, 2.8],
    zLevel: 0
  },
  {
    name: 'Panhandle Path',
    path: [
      [-122.4525, 37.7737],
      [-122.445, 37.7747],
      [-122.4376, 37.7759],
      [-122.4307, 37.7767],
      [-122.424, 37.7769]
    ],
    color: [56, 189, 248, 220],
    width: 5,
    dashArray: [2.7, 2.5],
    zLevel: 0
  }
];

type DependencyLink = {
  name: string;
  path: [number, number][];
  color: [number, number, number, number];
  markerColor: [number, number, number, number];
};

const DEPENDENCY_LINKS: DependencyLink[] = [
  {
    name: 'Ferry handoff',
    path: [
      [-122.4209, 37.8118],
      [-122.423, 37.7818]
    ],
    color: [15, 23, 42, 125],
    markerColor: [15, 23, 42, 185]
  },
  {
    name: 'Station transfer',
    path: [
      [-122.423, 37.7818],
      [-122.4262, 37.7648]
    ],
    color: [124, 58, 237, 125],
    markerColor: [88, 28, 135, 185]
  }
];

type LayerDatum = TransitRoute | WaterfrontSegment | DependencyLink;

const ROUTE_BOUNDS: [[number, number], [number, number]] = [
  [-122.456, 37.756],
  [-122.382, 37.814]
];

function getInitialViewState(container: HTMLElement): MapViewState {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  const isTallPane = height / width > 1.45;
  const tallPaneBottomPadding = Math.max(24, Math.min(Math.floor(height * 0.56), height - 120));
  const padding = isTallPane
    ? {
        top: 88,
        right: 36,
        bottom: tallPaneBottomPadding,
        left: 36
      }
    : {
        top: 88,
        right: 80,
        bottom: 80,
        left: 80
      };
  const viewport = new WebMercatorViewport({width, height}).fitBounds(ROUTE_BOUNDS, {
    padding,
    maxZoom: isTallPane ? 12.25 : 12.15
  });
  return {
    longitude: viewport.longitude,
    latitude: viewport.latitude,
    zoom: viewport.zoom,
    pitch: 0,
    bearing: 0
  };
}

/**
 * Mounts the path outline and marker example without React.
 */
type PathOutlineAndMarkersExampleOptions = {
  showInfoWidget?: boolean;
};

export function mountPathOutlineAndMarkersExample(
  container: HTMLElement,
  options: PathOutlineAndMarkersExampleOptions = {}
): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  rootElement.style.position = 'relative';
  rootElement.style.width = '100%';
  rootElement.style.height = '100%';
  container.replaceChildren(rootElement);

  const deck = new Deck({
    parent: rootElement,
    width: '100%',
    height: '100%',
    initialViewState: getInitialViewState(rootElement),
    controller: true,
    parameters: {clearColor: [0.96, 0.97, 1, 1]},
    widgets:
      options.showInfoWidget === false
        ? []
        : [
            new BoxPanelWidget({
              id: 'path-outline-and-markers-info',
              placement: 'top-left',
              widthPx: 300,
              title: 'Path Outline and Markers',
              collapsible: true,
              defaultOpen: false,
              panel: new MarkdownPanel({
                id: 'path-outline-and-markers-info-panel',
                title: '',
                markdown:
                  'Demonstrates `PathOutlineLayer` for outlined dashed routes, `PathMarkerLayer` for directional markers, and `DependencyArrowLayer` for routed handoff links.\n\nHover a path to inspect each route or trail.'
              })
            })
          ],
    layers: [
      new PathOutlineLayer<WaterfrontSegment>({
        id: 'trail-outlines',
        data: WATERFRONT_SEGMENTS,
        pickable: true,
        autoHighlight: false,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        widthScale: 1.35,
        outlineWidthScale: 1.18,
        getOutlineColor: TRAIL_OUTLINE_COLOR,
        getWidth: d => d.width,
        getColor: d => d.color,
        getDashArray: d => d.dashArray ?? null,
        dashJustified: false,
        getZLevel: d => d.zLevel ?? 0,
        parameters: {depthCompare: 'always', depthWriteEnabled: false}
      }),
      new PathMarkerLayer<TransitRoute>({
        id: 'transit-routes',
        data: TRANSIT_ROUTES,
        pickable: true,
        autoHighlight: false,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        widthScale: 1.85,
        outlineWidthScale: 1.22,
        getOutlineColor: ROUTE_OUTLINE_COLOR,
        getWidth: d => d.width,
        getColor: d => d.color,
        getMarkerColor: d => d.markerColor,
        getMarkerOutlineColor: ROUTE_OUTLINE_COLOR,
        getMarkerSize: [0.26, 0.18],
        markerOutlineWidthScale: 1.2,
        getDirection: d => d.direction,
        getMarkerPercentages: (object, {lineLength}) => {
          if (object.direction.backward) {
            return [0.42];
          }
          return lineLength > 180 ? [0.42, 0.7] : [0.5];
        },
        sizeScale: 74,
        parameters: {depthCompare: 'always', depthWriteEnabled: false}
      }),
      new DependencyArrowLayer<DependencyLink>({
        id: 'route-dependencies',
        data: DEPENDENCY_LINKS,
        pickable: true,
        autoHighlight: false,
        mode: 'line',
        widthUnits: 'pixels',
        getPath: d => d.path,
        getColor: d => d.color,
        getOutlineColor: DEPENDENCY_OUTLINE_COLOR,
        getWidth: 1.5,
        outlineWidthScale: 3.6,
        getDirection: PathDirection.FORWARD,
        getMarkerPlacements: [0.62],
        getMarkerColor: d => d.markerColor ?? DEPENDENCY_MARKER_COLOR,
        getMarkerSize: [1.8, 0.9],
        markerSizeScale: 7,
        getArcHeight: 0.04,
        getArcTilt: 35,
        parameters: {depthCompare: 'always', depthWriteEnabled: false}
      })
    ],
    getTooltip: (info: PickingInfo<LayerDatum>) => getTooltip(info)
  });
  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

function getTooltip(info: PickingInfo<LayerDatum>) {
  const {object, layer, index} = info;
  if (!object) {
    return null;
  }

  if (typeof (object as LayerDatum).name === 'string') {
    return {text: (object as LayerDatum).name};
  }

  if (Array.isArray(object) && layer?.props?.data) {
    const data = layer.props.data as LayerDatum[];
    const datum = data[index];
    if (datum && typeof datum.name === 'string') {
      return {text: datum.name};
    }
  }

  return null;
}
