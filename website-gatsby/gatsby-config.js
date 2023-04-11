const resolve = require('path').resolve;

module.exports = {
  plugins: [
    {
      resolve: `gatsby-theme-ocular`,
      options: {
        logLevel: 1, // Adjusts amount of debug information from ocular-gatsby

        // Folders
        DIR_NAME: __dirname,
        ROOT_FOLDER: `${__dirname}/../`,

        DOCS: require('../docs/table-of-contents.json'),
        DOC_FOLDERS: [
          `${__dirname}/../docs/`,
          `${__dirname}/../modules/`
        ],
        SOURCE: [
          `${__dirname}/static`,
          `${__dirname}/src`
        ],

        PROJECT_TYPE: 'github',

        PROJECT_NAME: 'project-template',
        PROJECT_ORG: 'visgl',
        PROJECT_ORG_LOGO: 'images/visgl-logo.png',
        PROJECT_URL: 'https://github.com/visgl/project-template',
        PROJECT_DESC: 'vis.gl Project Template',
        PATH_PREFIX: '/',

        GA_TRACKING: null,

        // For showing star counts and contributors.
        // Should be like btoa('YourUsername:YourKey') and should be readonly.
        GITHUB_KEY: null,

        HOME_PATH: '/',
        LINK_TO_GET_STARTED: '/docs',
        PAGES: [
          {
            path: '/',
            content: resolve('./src/home.md')
          }
        ],

        PROJECTS: [
          {name: 'deck.gl', url: 'https://deck.gl'},
          {name: 'luma.gl', url: 'https://luma.gl'},
          {name: 'loaders.gl', url: 'https://loaders.gl'},
          {name: 'react-map-gl', url: 'https://visgl.github.io/react-map-gl'}
        ],

        ADDITIONAL_LINKS: [{name: 'Blog', href: 'http://medium.com/vis-gl', index: 3}],

        STYLESHEETS: [''],
        THEME_OVERRIDES: require('./src/theme.json'),

        EXAMPLES: [
          {
            title: 'Minimal Example',
            path: 'examples/minimal/',
            image: 'images/visgl-logo.png',
            componentUrl: resolve('../examples/minimal/app.js')
          }
        ],

        GA_TRACKING: null,

        // For showing star counts and contributors.
        // Should be like btoa('YourUsername:YourKey') and should be readonly.
        GITHUB_KEY: null
      }
    },
    {resolve: 'gatsby-plugin-no-sourcemaps'}
  ]
};
