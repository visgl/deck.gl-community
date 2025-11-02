// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ExampleStyles} from '../control-panelt';

const lesMiserablesStyle: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 9,
      fill: '#60a5fa',
      stroke: '#1d4ed8',
      strokeWidth: 1.5,
      opacity: 0.9
    },
    {
      type: 'label',
      text: (node) => String(node.getId?.() ?? node.id ?? ''),
      color: '#0f172a',
      fontSize: 14,
      offset: [0, 18],
      textAnchor: 'middle',
      alignmentBaseline: 'top',
      scaleWithZoom: false
    }
  ],
  edgeStyle: {
    stroke: '#bfdbfe',
    strokeWidth: 1,
    decorators: []
  }
};

export default lesMiserablesStyle;
