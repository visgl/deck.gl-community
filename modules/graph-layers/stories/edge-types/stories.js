import React from 'react';
import {storiesOf} from '@storybook/react';

// graph.gl
import GraphGL, {
  D3ForceLayout,
  NODE_TYPE,
  EDGE_DECORATOR_TYPE,
} from '../../src';
import FetchS3GraphHOC from '../../utils/hocs/fetch-s3-graph-hoc';

// create category
const stories = storiesOf('Edge Types', module);

import EdgeLabelDoc from './edge-label.md';

const WithPreLayoutDataGraphGL = FetchS3GraphHOC('pre-layout-graph.json')(
  GraphGL
);

stories
  .add(
    'Label Decorator',
    () => (
      <WithPreLayoutDataGraphGL
        layout={new D3ForceLayout()}
        nodeStyle={[
          {
            type: NODE_TYPE.CIRCLE,
            radius: 10,
            fill: 'blue',
            opacity: 1,
          },
        ]}
        edgeStyle={{
          stroke: 'black',
          strokeWidth: 2,
          decorators: [
            {
              type: EDGE_DECORATOR_TYPE.LABEL,
              text: edge => edge.id,
              color: '#000',
              fontSize: 18,
            },
          ],
        }}
      />
    ),
    {readme: {sidebar: EdgeLabelDoc}}
  )
  .add('FlowPath Decorator', () => (
    <WithPreLayoutDataGraphGL
      layout={new D3ForceLayout()}
      nodeStyle={[
        {
          type: NODE_TYPE.CIRCLE,
          radius: 10,
          fill: 'blue',
          opacity: 1,
        },
      ]}
      edgeStyle={{
        stroke: 'black',
        strokeWidth: 2,
        decorators: [
          {
            type: EDGE_DECORATOR_TYPE.FLOW,
            color: '#00f',
            speed: 1,
            tailLength: 15,
            width: 5,
          },
        ],
      }}
    />
  ));
