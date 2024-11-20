/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

const bingMapsDocs = require('../../docs/modules/bing-maps/sidebar.json');

const layerDocs = require('../../docs/modules/layers/sidebar.json');
const editableLayerDocs = require('../../docs/modules/editable-layers/sidebar.json');
const graphLayerDocs = require('../../docs/modules/graph-layers/sidebar.json');
const arrowLayerDocs = require('../../docs/modules/arrow-layers/sidebar.json');

const reactDocs = require('../../docs/modules/react/sidebar.json');

const experimentalDocs = require('../../docs/modules/experimental/sidebar.json');

const sidebars = {
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Overview',
      items: ['README', 'whats-new', 'upgrade-guide', 'CONTRIBUTING']
    },
    {
      type: 'category',
      label: 'Layers',
      items: [layerDocs, editableLayerDocs, graphLayerDocs, arrowLayerDocs, experimentalDocs]
    },
    {
      type: 'category',
      label: 'Basemaps',
      items: [bingMapsDocs]
    },
    {type: 'category', label: 'React Bindings', items: [reactDocs]}
  ]
};

module.exports = sidebars;
