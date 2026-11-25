// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mountTraceExample, type TraceExampleProps} from '../../utils/mount-trace-example';
import {LineLayer} from '@deck.gl/layers';
import {TimeDeltaLayer} from '@deck.gl-community/layers/timeline-layers';
import {FastTextLayer} from '@deck.gl-community/layers/common-layers';

export function mountTimeDeltaExample(container: HTMLElement, options: TraceExampleProps = {}) {
  return mountTraceExample(
    container,
    options,
    createTimeDeltaLayers(),
    'Time delta',
    'TimeDeltaLayer interval guides and labels'
  );
}

function createTimeDeltaLayers() {
  return [
    new LineLayer({
      id: 'time-delta-example-range',
      data: [{sourcePosition: [-240, 28], targetPosition: [240, 28]}],
      coordinateSystem: 'cartesian',
      getSourcePosition: datum => datum.sourcePosition,
      getTargetPosition: datum => datum.targetPosition,
      getColor: [99, 102, 241, 160],
      getWidth: 3
    }),
    new TimeDeltaLayer({
      id: 'time-delta-example-header',
      coordinateSystem: 'cartesian',
      header: true,
      startTimeMs: -160,
      endTimeMs: 160,
      y: -38,
      color: [15, 23, 42, 255]
    }),
    new TimeDeltaLayer({
      id: 'time-delta-example-guides',
      coordinateSystem: 'cartesian',
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
      coordinateSystem: 'cartesian',
      getPosition: datum => datum.position,
      getText: datum => datum.label,
      size: 15,
      getColor: [30, 41, 59, 255],
      textAnchor: 'middle',
      alignmentBaseline: 'center'
    })
  ];
}
