/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

 const layerDocs = require('../../docs/modules/layers/sidebar.json');
 const editorDocs = require('../../docs/modules/editable-layers/sidebar.json');
 const graphGLDocs = require('../../docs/modules/graph-layers/sidebar.json');
 const bingMapsDocs = require('../../docs/modules/bing-maps/sidebar.json');

 
 const sidebars = {
  tutorialSidebar: 
  [
    {
      "type": "category",
      "label": "Overview",
      "items": [
        "README",
        "whats-new",
        "upgrade-guide"
      ]
    },
    {
      "type": "category",
      "label": "API Reference",
      "items": [
        layerDocs,
        editorDocs,
        graphGLDocs,
        bingMapsDocs
      ]
    }
  ]  
};

module.exports = sidebars;
