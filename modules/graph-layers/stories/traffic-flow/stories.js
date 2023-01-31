import React from 'react';
import {storiesOf} from '@storybook/react';

const stories = storiesOf('Demo', module);

import TrafficFlow from './app';

stories.add('Traffic Flow', () => <TrafficFlow />, {
  options: {
    showPanel: false,
  },
});
