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
    //   type: 'category',
    //   label: 'Declarative',
    //   items: [
    //     {
    //       type: 'link',
    //       label: 'Playground',
    //       href: `playground`
    //     }
    //   ]
    // }
    {
      type: 'category',
      label: '@deck.gl-community/graph-layers',
      items: [
        "graph-layers/graph-viewer"
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
    {
      type: 'category',
      label: '@deck.gl-community/bing-maps',
      items: [
        "bing-maps/get-started"
      ]
    },
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
