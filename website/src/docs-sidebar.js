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

const reactDocs = require('../../docs/modules/react/sidebar.json');
const reactGraphDocs = require('../../docs/modules/react-graph-layers/sidebar.json');

const sidebars = {
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Overview',
      items: ['README', 'whats-new', 'upgrade-guide']
    },
    {
      type: 'category',
      label: 'Layer Packs',
      items: [layerDocs, editableLayerDocs, graphLayerDocs]
    },
    {
      type: 'category',
      label: 'Basemaps',
      items: [bingMapsDocs]
    },
    {type: 'category', label: 'React Bindings', items: [reactDocs, reactGraphDocs]}
  ]
};

module.exports = sidebars;
