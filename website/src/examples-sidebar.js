/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
 
const sidebars = {
  examplesSidebar: [
    {
      type: 'doc',
      label: 'Overview',
      id: 'index'
    },
    // {
    //   type: 'doc',
    //   label: 'Playground',
    //   id: "playground"
    // },
    {
      type: 'category',
      label: '@deck.gl-community/graph-layers',
      items: [
        "graph-layers/graph-viewer",
        "graph-layers/graph-viewer-radial",
        "graph-layers/graph-viewer-multi-graph",
        "graph-layers/graph-viewer-hive",
        "graph-layers/graph-viewer-dag"
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/infovis-layers',
      items: [
        "infovis-layers/horizon-graph-layer"
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/editable-layers',
      items: [
        "editable-layers/editor",
        "editable-layers/advanced"
      ]
    },
    // {
    //   type: 'category',
    //   label: '@deck.gl-community/arrow-layers',
    //   items: [
    //     "graph-layers/graph-viewer"
    //   ]
    // },

    // TODO - need BING map key
    // {
    //   type: 'category',
    //   label: '@deck.gl-community/bing-maps',
    //   items: [
    //     "bing-maps/get-started"
    //   ]
    // },

    // TODO - unclear why not rendering
    {
      type: 'category',
      label: '@deck.gl-community/leaflet',
      items: [
        "leaflet/get-started"
      ]
    },
  ]
};

module.exports = sidebars;
