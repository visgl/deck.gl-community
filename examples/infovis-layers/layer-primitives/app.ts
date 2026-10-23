// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  COORDINATE_SYSTEM,
  Deck,
  OrthographicView,
  type Color,
  type OrthographicViewState,
  type Position,
  type ViewStateChangeParameters,
  type Widget
} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';
import {MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {EXAMPLE_PANEL_STYLE} from '../../utils/panel-theme';
import {
  AnimationLayer,
  BlockLayer,
  FastTextLayer,
  TimeDeltaLayer
} from '@deck.gl-community/infovis-layers';
import type {Device} from '@luma.gl/core';

type InfovisLayerHighlight = 'all' | 'animation-layer' | 'block-layer' | 'time-delta-layer';

/** Props accepted by the infovis layer primitives example. */
export type InfovisLayerPrimitivesExampleProps = {
  /** Layer family emphasized by the example. @defaultValue 'all' */
  highlight?: InfovisLayerHighlight;
  /** Whether to render the info panel. @defaultValue true */
  showInfoOverlay?: boolean;
  /** Optional rendering device supplied by the website example host. */
  device?: Device;
  /** Optional widgets supplied by the website example host. */
  widgets?: Widget[];
  /** Camera state preserved when the website recreates the graphics backend. */
  initialViewState?: OrthographicViewState;
  /** Reports camera changes to the website example host. */
  onViewStateChange?: <ViewStateT extends OrthographicViewState>(
    params: ViewStateChangeParameters<ViewStateT>
  ) => ViewStateT;
  /** Receives the deck instance so the host can attach its managed canvas. */
  onDeckInitialized?: (deck: Deck<OrthographicView>) => void;
};

type TraceBlock = {
  position: Position;
  size: [number, number];
  label: string;
  color: Color;
};

const TRACE_BLOCKS: TraceBlock[] = [
  {position: [-250, 22], size: [126, 54], label: 'parse', color: [37, 99, 235, 220]},
  {position: [-62, -32], size: [154, 54], label: 'layout', color: [14, 165, 233, 220]},
  {position: [156, 22], size: [124, 54], label: 'draw', color: [16, 185, 129, 220]}
];

/**
 * Mounts a compact trace-style scene that exercises the infovis block, animation, and time-delta layers.
 */
export function mountInfovisLayerPrimitivesExample(
  container: HTMLElement,
  options: InfovisLayerPrimitivesExampleProps = {}
): () => void {
  const {highlight = 'all', showInfoOverlay = true} = options;
  const rootElement = createRoot(container);
  const infoWidget = showInfoOverlay
    ? new BoxPanelWidget({
        id: 'infovis-layer-info',
        title: 'Layer primitives',
        placement: 'top-left',
        widthPx: 344,
        offsetPx: 16,
        collapsible: true,
        style: EXAMPLE_PANEL_STYLE,
        panel: new MarkdownPanel({
          id: 'infovis-layer-description',
          title: '',
          markdown: 'AnimationLayer, BlockLayer, and TimeDeltaLayer'
        })
      })
    : null;

  const deck = new Deck({
    device: options.device,
    parent: rootElement,
    views: new OrthographicView({id: 'infovis-layer-primitives', flipY: false}),
    initialViewState: options.initialViewState ?? {
      target: [0, 0, 0],
      zoom: 0
    },
    onViewStateChange: options.onViewStateChange,
    controller: true,
    widgets: [...(options.widgets ?? []), ...(infoWidget ? [infoWidget] : [])],
    layers: createLayers(highlight)
  });
  options.onDeckInitialized?.(deck);

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

function createLayers(highlight: InfovisLayerHighlight) {
  const blockLayer = new BlockLayer<TraceBlock>({
    id: `${highlight}-example-blocks`,
    data: TRACE_BLOCKS,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    sizeUnits: 'common',
    lineWidthUnits: 'pixels',
    getPosition: datum => datum.position,
    getSize: datum => datum.size,
    getFillColor: datum => datum.color,
    getLineColor: [15, 23, 42, 240],
    getLineWidth: 2
  });
  const labelLayer = new FastTextLayer<TraceBlock>({
    id: `${highlight}-example-labels`,
    data: TRACE_BLOCKS,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    getPosition: datum => [datum.position[0] + datum.size[0] / 2, datum.position[1] + 27],
    getText: datum => datum.label,
    size: 17,
    getColor: [255, 255, 255, 255],
    textAnchor: 'middle',
    alignmentBaseline: 'center'
  });
  const animatedBlocks = new AnimationLayer({
    id: 'animation-layer-example',
    layer: blockLayer.clone({opacity: 1}),
    repeat: Number.POSITIVE_INFINITY,
    frames: {
      type: 'sequence',
      frames: [
        {duration: 900, props: {opacity: 0.35}},
        {duration: 900, props: {opacity: 1}}
      ]
    }
  });
  const timeDeltaLayers = createTimeDeltaLayers();

  if (highlight === 'animation-layer') {
    return [animatedBlocks, labelLayer];
  }
  if (highlight === 'block-layer') {
    return [blockLayer, labelLayer];
  }
  if (highlight === 'time-delta-layer') {
    return timeDeltaLayers;
  }
  return [animatedBlocks, labelLayer, ...timeDeltaLayers];
}

function createTimeDeltaLayers() {
  return [
    new LineLayer({
      id: 'time-delta-example-range',
      data: [{sourcePosition: [-240, 28], targetPosition: [240, 28]}],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getSourcePosition: datum => datum.sourcePosition,
      getTargetPosition: datum => datum.targetPosition,
      getColor: [99, 102, 241, 160],
      getWidth: 3
    }),
    new TimeDeltaLayer({
      id: 'time-delta-example-header',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      header: true,
      startTimeMs: -160,
      endTimeMs: 160,
      y: -38,
      color: [15, 23, 42, 255]
    }),
    new TimeDeltaLayer({
      id: 'time-delta-example-guides',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      header: false,
      startTimeMs: -160,
      endTimeMs: 160,
      yMin: -88,
      yMax: 72,
      color: [99, 102, 241, 210]
    }),
    new FastTextLayer({
      id: 'time-delta-example-labels',
      data: [
        {position: [-160, 54], label: 'selection start'},
        {position: [160, 54], label: 'selection end'}
      ],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: datum => datum.position,
      getText: datum => datum.label,
      size: 15,
      getColor: [30, 41, 59, 255],
      textAnchor: 'middle',
      alignmentBaseline: 'center'
    })
  ];
}

function createRoot(container: HTMLElement): HTMLDivElement {
  const rootElement = container.ownerDocument.createElement('div');
  rootElement.style.position = 'relative';
  rootElement.style.width = '100%';
  rootElement.style.height = '100%';
  rootElement.style.overflow = 'hidden';
  rootElement.style.background = 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)';
  container.replaceChildren(rootElement);
  return rootElement;
}
