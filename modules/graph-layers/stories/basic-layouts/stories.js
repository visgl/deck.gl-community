import React from 'react';
import {storiesOf} from '@storybook/react';

// graph.gl
import GraphGL, {
  JSONLoader,
  NODE_TYPE,
  D3ForceLayout,
  SimpleLayout,
} from '../../src';

import FetchS3GraphHOC from '../../utils/hocs/fetch-s3-graph-hoc';
import SampleDatasetSelectorHOC from '../../utils/hocs/sample-dataset-selector-hoc';

const stories = storiesOf('Basic Layouts', module);

// start to add examples
import SimpleDoc from '../../docs/api-reference/simple-layout.md';
import D3Doc from '../../docs/api-reference/d3-layout.md';

stories.add(
  'Simple',
  () => {
    const graphLoader = data => JSONLoader({json: data});
    const WithDataGraphGL = FetchS3GraphHOC(
      'pre-layout-graph.json',
      graphLoader
    )(GraphGL);
    return (
      <WithDataGraphGL
        layout={new SimpleLayout()}
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
        }}
        enableDragging
      />
    );
  },
  {readme: {sidebar: SimpleDoc}}
);

stories.add(
  'D3',
  () => {
    const WithDatasetGraphGL = SampleDatasetSelectorHOC(GraphGL);
    return (
      <WithDatasetGraphGL
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
        }}
        enableDragging
      />
    );
  },
  {readme: {sidebar: D3Doc}}
);
