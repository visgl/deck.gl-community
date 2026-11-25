// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mountTraceExample, type TraceExampleProps} from '../../utils/mount-trace-example';
import type {Color, Position} from '@deck.gl/core';
import {AnimationLayer, BlockLayer, FastTextLayer} from '@deck.gl-community/layers/common-layers';

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

export function mountAnimatedBlocksExample(
  container: HTMLElement,
  options: TraceExampleProps & {highlight?: 'block-layer' | 'animation-layer'} = {}
) {
  const {highlight = 'animation-layer'} = options;
  const blockLayer = new BlockLayer<TraceBlock>({
    id: `${highlight}-example-blocks`,
    data: TRACE_BLOCKS,
    coordinateSystem: 'cartesian',
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
    coordinateSystem: 'cartesian',
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
  return mountTraceExample(
    container,
    options,
    [highlight === 'block-layer' ? blockLayer : animatedBlocks, labelLayer],
    'Animated blocks',
    'AnimationLayer, BlockLayer, and FastTextLayer'
  );
}
