// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView, type Color, type Position} from '@deck.gl/core';
import {LineLayer, TextLayer} from '@deck.gl/layers';
import {AnimationLayer, BlockLayer, TimeDeltaLayer} from '@deck.gl-community/infovis-layers';

type InfovisLayerHighlight = 'all' | 'animation-layer' | 'block-layer' | 'time-delta-layer';

/** Props accepted by the infovis layer primitives example. */
export type InfovisLayerPrimitivesExampleProps = {
  /** Layer family emphasized by the example. @defaultValue 'all' */
  highlight?: InfovisLayerHighlight;
  /** Whether to render the title overlay. @defaultValue true */
  showInfoOverlay?: boolean;
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
  {highlight = 'all', showInfoOverlay = true}: InfovisLayerPrimitivesExampleProps = {}
): () => void {
  const rootElement = createRoot(container);
  if (showInfoOverlay) {
    rootElement.appendChild(createInfoOverlay(rootElement.ownerDocument));
  }

  const deck = new Deck({
    parent: rootElement,
    views: new OrthographicView({id: 'infovis-layer-primitives', flipY: false}),
    initialViewState: {
      target: [0, 0, 0],
      zoom: 0
    },
    controller: true,
    layers: createLayers(highlight)
  });

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
  const labelLayer = new TextLayer<TraceBlock>({
    id: `${highlight}-example-labels`,
    data: TRACE_BLOCKS,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    getPosition: datum => [datum.position[0] + datum.size[0] / 2, datum.position[1] + 27],
    getText: datum => datum.label,
    getSize: 17,
    getColor: [255, 255, 255, 255],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center'
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
    new TextLayer({
      id: 'time-delta-example-labels',
      data: [
        {position: [-160, 54], label: 'selection start'},
        {position: [160, 54], label: 'selection end'}
      ],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: datum => datum.position,
      getText: datum => datum.label,
      getSize: 15,
      getColor: [30, 41, 59, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center'
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

function createInfoOverlay(document: Document): HTMLDivElement {
  const infoElement = document.createElement('div');
  infoElement.textContent = 'AnimationLayer, BlockLayer, and TimeDeltaLayer';
  Object.assign(infoElement.style, {
    position: 'absolute',
    top: '16px',
    left: '16px',
    zIndex: '1',
    maxWidth: 'min(360px, calc(100% - 32px))',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.88)',
    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
    color: '#0f172a',
    font: '600 14px/1.4 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '10px 12px',
    pointerEvents: 'none'
  });
  return infoElement;
}
