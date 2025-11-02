// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ExampleStyles} from '../control-panelt';

type SimpleStyleOptions = {
  fill: string;
  stroke?: string;
  radius?: number;
  opacity?: number;
  edgeStroke?: string;
  edgeWidth?: number;
};

export const createSimpleCircleStyle = ({
  fill,
  stroke = '#1f2937',
  radius = 6,
  opacity = 0.9,
  edgeStroke = '#94a3b8',
  edgeWidth = 1
}: SimpleStyleOptions): ExampleStyles => ({
  nodeStyle: [
    {
      type: 'circle',
      radius,
      fill,
      stroke,
      strokeWidth: 1.5,
      opacity
    }
  ],
  edgeStyle: {
    stroke: edgeStroke,
    strokeWidth: edgeWidth,
    decorators: []
  }
});
