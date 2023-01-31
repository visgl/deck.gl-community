import React from 'react';
import {storiesOf} from '@storybook/react';
import {action} from '@storybook/addon-actions';

// graph.gl
import GraphGL, {D3ForceLayout, JSONLoader, NODE_TYPE} from '../../src';
// data
import SAMPLE_GRAPH_DATASETS from '../../utils/data/sample-datasets';
const graph = JSONLoader({json: SAMPLE_GRAPH_DATASETS['Random (20, 40)']()});

// create category
const stories = storiesOf('Interactions', module);

const Hint = ({children}) => (
  <h3 style={{position: 'absolute', top: '10px', left: '120px'}}>{children}</h3>
);

const shareProps = {
  graph,
  layout: new D3ForceLayout(),
  edgeStyle: {
    stroke: '#000',
    strokeWidth: 1,
  },
  nodeStyle: [
    {
      type: NODE_TYPE.CIRCLE,
      radius: 10,
      fill: 'red',
    },
  ],
};

stories.add('Node event callbacks', () => (
  <div>
    <Hint>Try to mouse over or click on a node</Hint>
    <GraphGL
      {...shareProps}
      nodeEvents={{
        onClick: action('node clicked'),
        onMouseEnter: action('node mouseEnter'),
        onHover: action('node hovered'),
        onMouseLeave: action('node mouseLeave'),
      }}
    />
  </div>
));

stories.add('enableDragging', () => (
  <div>
    <Hint>Try to drag a node after the layout is completed</Hint>
    <GraphGL {...shareProps} enableDragging />
  </div>
));

stories.add('resumeLayoutAfterDragging', () => (
  <div>
    <Hint>Try to drag a node</Hint>
    <GraphGL {...shareProps} enableDragging resumeLayoutAfterDragging />
  </div>
));

stories.add('Node :hover selector', () => (
  <div>
    <Hint>Try to mouse over a node</Hint>
    <GraphGL
      {...shareProps}
      nodeStyle={[
        {
          type: NODE_TYPE.CIRCLE,
          radius: 10,
          fill: 'red',

          ':hover': {
            radius: 15,
            fill: 'steelblue',
          },
        },
      ]}
    />
  </div>
));

stories.add('Node :dragging selector', () => (
  <div>
    <Hint>Try to drag a node</Hint>
    <GraphGL
      {...shareProps}
      nodeStyle={[
        {
          type: NODE_TYPE.CIRCLE,
          radius: 10,
          fill: 'red',

          ':dragging': {
            radius: 15,
            fill: 'gold',
          },
        },
      ]}
      enableDragging
    />
  </div>
));

stories.add('Edge event callbacks', () => (
  <div>
    <Hint>Try to mouse over or click on a edge</Hint>
    <GraphGL
      {...shareProps}
      edgeStyle={{
        stroke: '#000',
        strokeWidth: 5,
      }}
      edgeEvents={{
        onClick: action('edge clicked'),
        onHover: action('edge hovered'),
      }}
    />
  </div>
));
