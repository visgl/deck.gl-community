import React from 'react';
import {storiesOf} from '@storybook/react';
import {number} from '@storybook/addon-knobs';

const stories = storiesOf('Demo', module);

// start to add examples
import BasicDoc from './README.md';
import BubbleChartExample from './app';

stories.add(
  'Bubble Chart',
  () => {
    const opacity = number(
      'Fake Graph Opacity',
      0.3,
      {
        range: true,
        min: 0,
        max: 1,
        step: 0.01,
      },
      'Controls'
    );
    return <BubbleChartExample opacity={opacity} />;
  },
  {readme: {sidebar: BasicDoc}}
);
