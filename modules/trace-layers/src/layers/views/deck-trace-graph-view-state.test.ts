import {describe, expect, it} from 'vitest';

import {encodeProcessRef, encodeProcessThreadRef} from '../../trace';
import {getTraceBounds} from './deck-trace-graph-view-state';

import type {TraceLayout} from '../../trace';

const processLayouts: TraceLayout['processLayouts'] = [
  {
    processRef: encodeProcessRef(0),
    yOffset: 0,
    yHeight: 2,
    labelY: 0,
    collapsedActivityY: 0,
    backgroundPolygonInfinite: new Float32Array(),
    contentStartY: 0,
    threadLayouts: []
  },
  {
    processRef: encodeProcessRef(1),
    yOffset: 2.5,
    yHeight: 3,
    labelY: 2.5,
    collapsedActivityY: 0,
    backgroundPolygonInfinite: new Float32Array(),
    contentStartY: 2.5,
    threadLayouts: []
  }
];

const traceLayout = {
  traceGraph: {} as TraceLayout['traceGraph'],
  processLayouts,
  processLayoutMapByRef: new Map(
    processLayouts.map(processLayout => [processLayout.processRef, processLayout])
  ),
  renderRows: [],
  threadLayoutMapByRef: new Map([
    [
      encodeProcessThreadRef(0, 0),
      {
        visible: true,
        yPosition: 0.5
      }
    ],
    [
      encodeProcessThreadRef(1, 0),
      {
        visible: true,
        yPosition: 3.5
      }
    ]
  ]),
  currentBounds: [
    [0, 0],
    [4, 5]
  ]
} as const satisfies TraceLayout;

describe('getTraceBounds', () => {
  it('computes bounds for a trace layout with horizontal padding', () => {
    expect(
      getTraceBounds({
        traceLayout,
        minTimeMs: 100,
        maxTimeMs: 200,
        horizontalPaddingFraction: 0.2
      })
    ).toEqual([
      [-10, 0],
      [110, 5.5]
    ]);
  });

  it('excludes graph-global run event rows from main timeline bounds', () => {
    expect(
      getTraceBounds({
        traceLayout: {
          ...traceLayout,
          globalEventRow: {
            yPosition: -40
          }
        },
        minTimeMs: 0,
        maxTimeMs: 100
      })
    ).toEqual([
      [0, 0],
      [100, 5.5]
    ]);
  });

  it('falls back to stream positions when span geometry is missing', () => {
    const layoutWithoutBlocks: TraceLayout = {
      traceGraph: {} as TraceLayout['traceGraph'],
      processLayouts: [],
      processLayoutMapByRef: new Map(),
      renderRows: [],
      threadLayoutMapByRef: new Map([
        [
          encodeProcessThreadRef(0, 0),
          {
            visible: true,
            yPosition: 2
          }
        ],
        [
          encodeProcessThreadRef(0, 1),
          {
            visible: true,
            yPosition: 7
          }
        ]
      ]),
      currentBounds: [
        [0, 2],
        [10, 7]
      ]
    };

    expect(
      getTraceBounds({
        traceLayout: layoutWithoutBlocks,
        minTimeMs: 0,
        maxTimeMs: 10,
        horizontalPaddingFraction: 0
      })
    ).toEqual([
      [0, 2],
      [10, 7]
    ]);
  });
});
