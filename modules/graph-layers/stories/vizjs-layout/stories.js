import React from 'react';
import {storiesOf} from '@storybook/react';
import {action} from '@storybook/addon-actions';
import {boolean, select} from '@storybook/addon-knobs';
import SampleDatasetSelectorHOC from '../../utils/hocs/sample-dataset-selector-hoc';

const stories = storiesOf('Experimental Layouts', module);

// start to add examples
import BasicDoc from './README.md';
import VizJSExample from './app';

stories.add(
  'Viz.js',
  () => {
    const controlGroup = 'Interactive control';
    const selectedEngine = select(
      'Engine',
      {
        circo: 'circo',
        dot: 'dot',
        fdp: 'fdp',
        neato: 'neato',
        osage: 'osage',
        twopi: 'twopi',
      },
      'dot',
      controlGroup
    );
    const WithDatasetGraphGL = SampleDatasetSelectorHOC(
      VizJSExample,
      data => data
    );
    return (
      <WithDatasetGraphGL
        onNodeClick={action('nodeClicked')}
        selectedEngine={selectedEngine}
        orthogonal={boolean('Orthogonal layout', true, controlGroup)}
        leftToRight={boolean('Left to Right', true, controlGroup)}
      />
    );
  },
  {readme: {sidebar: BasicDoc}}
);
