import React from 'react';
import {storiesOf} from '@storybook/react';

// graph.gl
import GraphGL, {NODE_TYPE} from '../../src';
import SampleDatasetSelectorHOC from '../../utils/hocs/sample-dataset-selector-hoc';
const WithDatasetGraphGL = SampleDatasetSelectorHOC(GraphGL);
import ColaLayout from './cola-layout';

const stories = storiesOf('Experimental Layouts', module);

// start to add examples
import BasicDoc from './README.md';

stories.add(
  'Cola.js',
  () => (
    <WithDatasetGraphGL
      layout={new ColaLayout()}
      nodeStyle={[
        {
          type: NODE_TYPE.CIRCLE,
          radius: 10,
          fill: 'rgb(236, 81, 72)',
        },
      ]}
      edgeStyle={{
        stroke: 'rgb(236, 81, 72)',
        strokeWidth: 2,
      }}
    />
  ),
  {readme: {sidebar: BasicDoc}}
);
