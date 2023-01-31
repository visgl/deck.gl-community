import React from 'react';
import {storiesOf} from '@storybook/react';
import {action} from '@storybook/addon-actions';
import {color, number} from '@storybook/addon-knobs';
import SampleDatasetSelectorHOC from '../../utils/hocs/sample-dataset-selector-hoc';

const stories = storiesOf('Demo', module);

// start to add examples
import BasicDoc from './README.md';
import GraphBuilder from './app';
const WithDatasetGraphGL = SampleDatasetSelectorHOC(GraphBuilder, data => data);

stories.add(
  'GraphBuilder',
  () => {
    const nodeCustomizations = 'Node customizations';
    const edgeCustomizations = 'Edge customizations';

    // node customizations
    const nodeSize = number(
      'Node size',
      30,
      {range: true, min: 1, max: 100},
      nodeCustomizations
    );

    // edge customizations
    const edgeWidth = number(
      'Edge width',
      1.5,
      {range: true, min: 1, max: 20},
      edgeCustomizations
    );

    return (
      <WithDatasetGraphGL
        nodeSize={nodeSize}
        nodeColor={color('Node color', '#7743CE', nodeCustomizations)}
        edgeWidth={edgeWidth}
        edgeColor={color('Edge color', '#777777', edgeCustomizations)}
        onNodeClick={action('nodeClicked')}
        onEdgeClick={action('edgeClicked')}
      />
    );
  },
  {readme: {sidebar: BasicDoc}}
);
