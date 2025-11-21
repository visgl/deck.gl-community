// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const {themes} = require('prism-react-renderer');
const lightCodeTheme = themes.github;
const darkCodeTheme = themes.dracula;

const webpack = require('webpack');
const {resolve} = require('path');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'deck.gl-community',
  tagline: 'Unofficial layers, basemaps and add-ons for deck.gl',
  url: 'https://deck.gl-community',
  baseUrl: '/deck.gl-community/', // process.env.STAGING ? '/deck.gl-community/' : '/',
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    }
  },
  favicon: '/favicon.ico',
  organizationName: 'visgl', // Usually your GitHub org/user name.
  projectName: 'deck.gl-community', // Usually your repo name.
  trailingSlash: false,
  future: {
    v4: true
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: '../docs',
          sidebarPath: resolve('./src/docs-sidebar.js'),
          // Point to to the website directory in your repo.
          editUrl: 'https://github.com/visgl/deck.gl-community/tree/master/website'
        },
        theme: {
          customCss: [
            resolve('./src/styles.css'),
            resolve('./node_modules/maplibre-gl/dist/maplibre-gl.css')
          ]
        }
      })
    ]
  ],

  themes: [
    [
      '@cmfcmf/docusaurus-search-local',
      /** @type {import('@cmfcmf/docusaurus-search-local').PluginOptions} */
      ({
        indexDocs: true,
        indexBlog: false,
        indexPages: true,
        // highlightSearchTermsOnTargetPage: true
      })
    ]
  ],

  plugins: [
    // Improve build performance by disabling expensive optimizations
    // https://github.com/facebook/docusaurus/discussions/11199
    function disableExpensiveBundlerOptimizationPlugin() {
      return {
        name: "disable-expensive-bundler-optimizations",
        configureWebpack(_config, isServer) {
          return {
            optimization: {
              concatenateModules: false,
            },
          };
        },
      };
    },
    [
      './ocular-docusaurus-plugin',
      {
        debug: true,
        resolve: {
          modules: [resolve('node_modules'), resolve('../node_modules')],
          alias: {
            '@deck.gl-community/bing-maps': resolve('../modules/bing-maps/src'),
            '@deck.gl-community/leaflet': resolve('../modules/leaflet/src'),
            '@deck.gl-community/graph-layers': resolve('../modules/graph-layers/src'),
            '@deck.gl-community/infovis-layers': resolve('../modules/infovis-layers/src'),
            '@deck.gl-community/react': resolve('../modules/react/src'),
            '@deck.gl-community/layers': resolve('../modules/layers/src'),
            '@deck.gl-community/arrow-layers': resolve('../modules/arrow-layers/src'),
            '@deck.gl-community/editable-layers': resolve('../modules/editable-layers/src'),
            '@deck.gl-community/widgets': resolve('../modules/widgets/src'),
            '@deck.gl/aggregation-layers': resolve('../node_modules/@deck.gl/aggregation-layers'),
            '@deck.gl/arcgis': resolve('../node_modules/@deck.gl/arcgis'),
            '@deck.gl/carto': resolve('../node_modules/@deck.gl/carto'),
            '@deck.gl/core': resolve('../node_modules/@deck.gl/core'),
            '@deck.gl/extensions': resolve('../node_modules/@deck.gl/extensions'),
            '@deck.gl/geo-layers': resolve('../node_modules/@deck.gl/geo-layers'),
            '@deck.gl/google-maps': resolve('../node_modules/@deck.gl/google-maps'),
            '@deck.gl/json': resolve('../node_modules/@deck.gl/json'),
            '@deck.gl/layers': resolve('../node_modules/@deck.gl/layers'),
            '@deck.gl/mapbox': resolve('../node_modules/@deck.gl/mapbox'),
            '@deck.gl/mesh-layers': resolve('../node_modules/@deck.gl/mesh-layers'),
            '@deck.gl/react': resolve('../node_modules/@deck.gl/react'),
            '@luma.gl': resolve('../node_modules/@luma.gl'),
            '@math.gl': resolve('../node_modules/@math.gl'),
            '@loaders.gl/csv': resolve('node_modules/@loaders.gl/csv'),
            '@loaders.gl/json': resolve('node_modules/@loaders.gl/json'),
            '@loaders.gl/i3s': resolve('node_modules/@loaders.gl/i3s'),
            '@loaders.gl/las': resolve('node_modules/@loaders.gl/las'),
            '@loaders.gl/obj': resolve('node_modules/@loaders.gl/obj'),
            '@loaders.gl/ply': resolve('node_modules/@loaders.gl/ply'),
            '@loaders.gl': resolve('../node_modules/@loaders.gl'),
            preact: resolve('node_modules/preact'),
            'preact/hooks': resolve('node_modules/preact/hooks'),
            'preact/jsx-runtime': resolve('node_modules/preact/jsx-runtime'),
            'preact/jsx-dev-runtime': resolve('node_modules/preact/jsx-dev-runtime'),
            react: resolve('node_modules/react'),
            'react-dom': resolve('node_modules/react-dom'),
            'styled-react-modal': resolve('node_modules/styled-react-modal')
          }
        },
        plugins: [
          // new webpack.EnvironmentPlugin([
          //   'MapboxAccessToken',
          //   'GoogleMapsAPIKey',
          //   'GoogleMapsMapId'
          // ]),
          // These modules break server side bundling
          new webpack.IgnorePlugin({
            resourceRegExp: /asciify-image/
          })
        ],
        module: {
          rules: [
            // https://github.com/Esri/calcite-components/issues/2865
            {
              test: /\.m?js/,
              resolve: {
                fullySpecified: false
              }
            },
            // widgets module JSX must be traspiled as preact
            {
              test: /\.[jt]sx?$/,
              include: [resolve('../modules/widgets/src')],
              use: [
                {
                  loader: require.resolve('babel-loader'),
                  options: {
                    babelrc: false,
                    configFile: false,
                    presets: [
                      [
                        require.resolve('@babel/preset-typescript'),
                        {isTSX: true, allExtensions: true, allowDeclareFields: true}
                      ]
                    ],
                    plugins: [
                      [
                        require.resolve('@babel/plugin-transform-react-jsx'),
                        {runtime: 'automatic', importSource: 'preact'}
                      ]
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    ],
    [
      resolve('./plugins/gallery-static-plugin'),
      {
        sourceDir: resolve('../examples/gallery'),
        routeBase: '/gallery'
      }
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'examples',
        path: './src/examples',
        routeBasePath: 'examples',
        sidebarPath: resolve('./src/examples-sidebar.js'),
        breadcrumbs: false,
        docItemComponent: resolve('./src/components/example/doc-item-component.jsx')
      }
    ]
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'deck.gl-community',
        logo: {
          alt: 'vis.gl Logo',
          src: 'images/visgl-logo-dark.png',
          srcDark: 'images/visgl-logo-light.png'
        },
        items: [
          {
            to: '/docs',
            position: 'left',
            label: 'Docs'
          },
          {
            to: '/gallery',
            position: 'left',
            label: 'Gallery'
          },
          {
            to: '/examples',
            position: 'left',
            label: 'Examples'
          },
          // {
          //   to: '/showcase',
          //   position: 'left',
          //   label: 'Showcase'
          // },
          {
            to: 'https://medium.com/vis-gl',
            label: 'Blog',
            position: 'left'
          },
          {
            href: 'https://github.com/visgl/deck.gl-community',
            label: 'GitHub',
            position: 'right'
          }
        ]
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Resources',
            items: [
              {
                label: 'Starter templates',
                href: 'https://github.com/visgl/deck.gl/tree/master/examples/get-started'
              },
              {
                label: 'Codepen demos',
                href: 'https://codepen.io/vis-gl/'
              }
            ]
          },
          {
            title: 'Other vis.gl Libraries',
            items: [
              {
                label: 'deck.gl',
                href: 'https://@deck.gl-community/editable-layers'
              },
              {
                label: 'luma.gl',
                href: 'https://luma.gl'
              },
              {
                label: 'loaders.gl',
                href: 'https://loaders.gl'
              },
              {
                label: 'react-map-gl',
                href: 'https://visgl.github.io/react-map-gl'
              }
            ]
          },
          {
            title: 'More',
            items: [
              {
                label: 'Slack workspace',
                href: 'https://join.slack.com/t/deckgl/shared_invite/zt-7oeoqie8-NQqzSp5SLTFMDeNSPxi7eg'
              },
              {
                label: 'vis.gl blog on Medium',
                href: 'https://medium.com/vis-gl'
              },
              {
                label: 'GitHub',
                href: 'https://github.com/visgl/deck.gl-community'
              }
            ]
          }
        ],
        copyright: `Copyright © ${new Date().getFullYear()} OpenJS Foundation`
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme
      }
    })
};

module.exports = config;
