const sidebars = {
  examplesSidebar: [
    {type: 'doc', label: 'Overview', id: 'index'},
    {
      type: 'category',
      label: '@deck.gl-community/editable-layers',
      items: [
        'editable-layers/getting-started',
        'editable-layers/editor',
        'editable-layers/editor-react',
        'editable-layers/3d-tiles',
        'editable-layers/advanced',
        'editable-layers/sf',
        'editable-layers/no-map',
        'editable-layers/editable-h3-cluster-layer'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/graph-layers',
      items: [
        'graph-layers/simple-graph',
        'graph-layers/multi-graph',
        'graph-layers/radial',
        'graph-layers/hive-plot',
        'graph-layers/dag',
        'graph-layers/marker-layer'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/common-layers',
      items: [
        'layers/animated-blocks',
        'layers/path-outline-and-markers',
        'layers/flame-trail',
        'layers/edge-markers',
        'layers/source-layers',
        'layers/volumetric-video'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/effect-layers',
      items: [
        'layers/weather',
        'layers/soft-shadows',
        'layers/city-scene',
        'layers/flow-particles',
        'layers/point-glow',
        'layers/fireflies',
        'layers/hdr-night-lighting',
        'layers/global-illumination',
        'layers/light-shafts',
        'layers/depth-of-field',
        'layers/scene-buffers',
        'layers/pattern-fills',
        'layers/styled-paths',
        'layers/sketch-edges'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/sky-layers',
      items: ['layers/globe-clouds', 'layers/sky-layers', 'sky-layers/procedural-sky', 'sky-layers/skybox-map-view', 'sky-layers/skybox-globe', 'sky-layers/skybox-first-person']
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/geo-layers',
      items: [
        'geo-layers/satellite-orbits',
        'geo-layers/shared-tile-2d-layer'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/global-grid-layers',
      items: ['geo-layers/global-grid-layer']
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/timeline-layers',
      items: [
        'timeline-layers/time-delta-layer',
        'timeline-layers/timeline-layer',
        'timeline-layers/horizon-graph-layer',
        'timeline-layers/multi-horizon-graph-layer'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/vegetation-layers',
      items: ['vegetation-layers/seasonal-farm', 'vegetation-layers/grass-layer']
    },
    {
      type: 'category',
      label: '@deck.gl-community/layers/wind-layers',
      items: [
        'geo-layers/wind',
        'layers/wind-garden',
        'layers/wind-atlas'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/experimental',
      items: ['experimental/ambient-occlusion']
    },
    {
      type: 'category',
      label: '@deck.gl-community/leaflet',
      items: [
        'leaflet/get-started',
        'leaflet/scripting'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/panels',
      items: ['widgets/widget-panels']
    },
    {
      type: 'category',
      label: '@deck.gl-community/widgets',
      items: [
        'widgets/canvas-chrome',
        'widgets/deck-panel',
        'widgets/html-overlays',
        'widgets/overlays',
        'widgets/pan-and-zoom-controls',
        'widgets/standalone-widgets'
      ]
    },
    {
      type: 'category',
      label: '@deck.gl-community/react',
      items: ['react/multi-canvas']
    },
    {
      type: 'category',
      label: '@deck.gl-community/playground',
      items: [
        'playground',
        {
          type: 'category',
          label: 'Vega layers',
          items: [
            'vega/geospatial',
            'vega/map-to-stacks',
            'vega/mark-transitions',
            'vega/unit-layouts'
          ]
        }
      ]
    }
  ]
};

module.exports = sidebars;
