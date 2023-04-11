/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

 const bingMapsDocs = require('../../docs/modules/bing-maps/table-of-contents.json');
 const graphGLDocs = require('../../docs/modules/graph-gl/table-of-contents.json');

 
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
      "label": "Submodule API Reference",
      "items": [
        bingMapsDocs,
        graphGLDocs
      ]
    }
  ]  
};

module.exports = sidebars;
