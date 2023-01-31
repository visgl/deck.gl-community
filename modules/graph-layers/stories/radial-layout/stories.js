import React from 'react';
import {storiesOf} from '@storybook/react';

const stories = storiesOf('Experimental Layouts', module);

// start to add examples
import BasicDoc from './README.md';
import BasicRadialExample from './app';

stories.add('Radial Layout', () => <BasicRadialExample />, {
  readme: {sidebar: BasicDoc},
});
