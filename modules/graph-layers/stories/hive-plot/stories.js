import React from 'react';
import {storiesOf} from '@storybook/react';

const stories = storiesOf('Experimental Layouts', module);

// start to add examples
import BasicDoc from './README.md';
import HivePlotExample from './app';
stories.add('Hive Plot', () => <HivePlotExample />, {
  readme: {sidebar: BasicDoc},
});
