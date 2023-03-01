const resolve = require('path').resolve;

const DOCS = require('../docs/table-of-contents.json');
const DEPENDENCIES = require('./package.json').dependencies;
// eslint-disable-next-line import/no-extraneous-dependencies
const ALIASES = require('ocular-dev-tools/config/ocular.config')({
  root: resolve(__dirname, '..'),
}).aliases;

// When duplicating example dependencies in website, autogenerate
// aliases to ensure the website version is picked up
// NOTE: module dependencies are automatically injected
// TODO - should this be automatically done by ocular-gatsby?
const dependencyAliases = {};
for (const dependency in DEPENDENCIES) {
  dependencyAliases[dependency] = `${__dirname}/node_modules/${dependency}`;
}

module.exports = {
  logLevel: 4, // Adjusts amount of debug information from ocular-gatsby

  DOC_FOLDERS: [`${__dirname}/../docs/`],
  ROOT_FOLDER: `${__dirname}/../`,
  DIR_NAME: `${__dirname}`,

  DOCS,
  LINK_TO_GET_STARTED: '/docs',

  PROJECT_TYPE: 'github',

  PROJECT_NAME: 'graph.gl',
  PROJECT_ORG: 'uber',
  PROJECT_URL: `https://github.com/uber-web/graph.gl`,
  PROJECT_DESC:
    'WebGL2-Powered Visualization Components for Graph Visualization',
  PATH_PREFIX: `/gatsby`,

  FOOTER_LOGO: '',

  GA_TRACKING: null,

  // For showing star counts and contributors.
  // Should be like btoa('YourUsername:YourKey') and should be readonly.
  GITHUB_KEY: null,

  HOME_PATH: '/',

  HOME_HEADING: 'Graph layers for deck.gl.',

  HOME_RIGHT: null,

  HOME_BULLETS: [
    {
      text: 'Designed for React',
      desc: 'Seemless integration.',
      img: 'icons/icon-react.svg',
    },
    {
      text: 'Totally ready for production',
      img: 'icons/icon-layers.svg',
    },
  ],

  PROJECTS: [
    {
      name: 'deck.gl',
      url: 'https://deck.gl'
    },
    {
      name: 'luma.gl',
      url: 'https://luma.gl'
    },
    {
      name: 'react-map-gl',
      url: 'https://uber.github.io/react-map-gl'
    },
    {
      name: 'react-vis',
      url: 'https://uber.github.io/react-vis'
    }
  ],

  ADDITIONAL_LINKS: [
    {
      index: 4,
      href: 'http://graph.gl/storybook/',
      name: 'Storybook',
    },
  ],

  EXAMPLES: [
    {
      title: 'Simple Graph Viewer',
      image: 'images/graph.png',
      componentUrl: resolve(__dirname, '../examples/simple-graph-viewer/index.js'),
      path: 'examples/simple-graph-viewer',
    },
    {
      title: 'Hive Plot',
      image: 'images/layouts/hive-plot.png',
      componentUrl: resolve(__dirname, '../stories/hive-plot/app.js'),
      path: 'examples/hive-plot',
    },
    {
      title: 'Radial Layout',
      image: 'images/layouts/radial.png',
      componentUrl: resolve(__dirname, '../stories/radial-layout/app.js'),
      path: 'examples/radial-layout',
    },
    {
      title: 'MultiGraph',
      image: 'images/layouts/multi-graph.png',
      componentUrl: resolve(__dirname, '../stories/multi-graph-layout/app.js'),
      path: 'examples/multi-graph',
    },
  ],

  // Avoids duplicate conflicting inputs when importing from examples folders
  // Ocular adds this to gatsby's webpack config
  webpack: {
    resolve: {
      // modules: [resolve(__dirname, './node_modules')],
      alias: Object.assign({}, ALIASES, dependencyAliases),
      // Local aliases need to be set in local gatsby node!
    },
  },
};
