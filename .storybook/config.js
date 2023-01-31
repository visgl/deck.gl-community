import React from 'react';
import {configure, addDecorator, addParameters, storiesOf} from '@storybook/react';
import {withInfo} from '@storybook/addon-info';
import {withKnobs} from '@storybook/addon-knobs';
import {addReadme} from 'storybook-readme';
import '@babel/polyfill';

import Theme from './theme';

// To expand the container to the entire page.
const StoryContainer = story => (
  <div style={{width: '100vw', height: '100vh'}}>{story()}</div>
);

const req = require.context('../stories', true, /stories.js$/);

// automatically import all files ending in *.stories.js
// function loadStories() {
//   req.keys().forEach(filename => req(filename));
// }

// NOTE: here we manually load each stories.js to ensure the deterministic order
function loadStories() {
  [
    // basic
    "./basic-layouts/stories.js",
    "./node-types/stories.js",
    "./edge-types/stories.js",
    "./interactions/stories.js",
    // demo
    "./graph-builder/stories.js",
    "./traffic-flow/stories.js",
    "./bubble-chart/stories.js",
    // experimental
    "./cola/stories.js",
    "./hive-plot/stories.js",
    "./multi-graph-layout/stories.js",
    "./ngraph/stories.js",
    "./radial-layout/stories.js",
    "./vizjs-layout/stories.js"
  ].forEach(filename => req(filename));
}

// See all options for withOptions:
// https://www.npmjs.com/package/@storybook/addon-options
addParameters({
  options: {
    theme: Theme,
    panelPosition: 'right',
    showSearchBox: false,
    showPanel: true,
    selectedAddonPanel: 'README',
    sortStoriesByKind: true,
  },
});

addDecorator(addReadme);

addDecorator(StoryContainer);

// See all options for withInfo:
// https://github.com/storybooks/storybook/tree/master/addons/info#options-and-defaults
addDecorator(
  withInfo({
    maxPropArrayLength: 3,
    propTablesExclude: [StoryContainer],
    source: false,
  })
);

// See all options for withKnobs:
// https://www.npmjs.com/package/@storybook/addon-knobs#withknobs-options
addDecorator(withKnobs);

configure(loadStories, module);
