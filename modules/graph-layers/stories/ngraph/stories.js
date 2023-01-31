import React from 'react';
import {storiesOf} from '@storybook/react';
import SampleDatasetSelectorHOC from '../../utils/hocs/sample-dataset-selector-hoc';

const stories = storiesOf('Experimental Layouts', module);

// start to add examples
import BasicDoc from './README.md';
import GraphGL, {NODE_TYPE} from '../../src';
import NGraphLayout from './ngraph-layout';

const WithDatasetGraphGL = SampleDatasetSelectorHOC(GraphGL);

stories.add(
  'NGraph',
  () => (
    <WithDatasetGraphGL
      layout={new NGraphLayout()}
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
