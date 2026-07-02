import {test, expect, vi} from 'vitest';

import {SELECTION_TYPE, SelectionLayer} from '../../src/editable-layers/selection-layer';

const SELECTION_POLYGON = [
  [
    [-1, -1],
    [3, -1],
    [3, 3],
    [-1, 3],
    [-1, -1]
  ]
];

function makeSelectionLayer(onSelect = vi.fn()) {
  const layer = new SelectionLayer({
    id: 'selection',
    selectionType: SELECTION_TYPE.POLYGON,
    layerIds: ['points'],
    onSelect
  });

  layer.context = {
    deck: {
      pickObjects: vi.fn()
    },
    layerManager: {
      getLayers: vi.fn(() => [])
    }
  } as any;

  return layer;
}

test('polygon selection returns only objects with positions inside the drawn polygon', () => {
  const onSelect = vi.fn();
  const layer = makeSelectionLayer(onSelect);
  const pointLayer = {
    id: 'points',
    props: {
      data: [
        {name: 'inside', position: [1, 1]},
        {name: 'outside', position: [4, 4]},
        {name: 'edge', position: [0, 0]}
      ]
    }
  };
  layer.context.layerManager.getLayers.mockReturnValue([pointLayer]);

  layer._selectPolygonObjects(SELECTION_POLYGON);

  expect(layer.context.deck.pickObjects).not.toHaveBeenCalled();
  expect(onSelect).toHaveBeenCalledWith({
    pickingInfos: [
      {object: pointLayer.props.data[0], layer: pointLayer, index: 0},
      {object: pointLayer.props.data[2], layer: pointLayer, index: 2}
    ]
  });
});

test('polygon selection resolves positions with getPosition accessors', () => {
  const onSelect = vi.fn();
  const layer = makeSelectionLayer(onSelect);
  const data = [
    {name: 'inside', geometry: {coordinates: [2, 2]}},
    {name: 'outside', geometry: {coordinates: [10, 10]}}
  ];
  const pointLayer = {
    id: 'points',
    props: {
      data,
      getPosition: vi.fn(object => object.geometry.coordinates)
    }
  };
  layer.context.layerManager.getLayers.mockReturnValue([pointLayer]);

  layer._selectPolygonObjects(SELECTION_POLYGON);

  expect(pointLayer.props.getPosition).toHaveBeenCalledWith(data[0], {
    index: 0,
    data,
    target: []
  });
  expect(onSelect).toHaveBeenCalledWith({
    pickingInfos: [{object: data[0], layer: pointLayer, index: 0}]
  });
});

test('polygon selection supports GeoJSON feature collection layers', () => {
  const onSelect = vi.fn();
  const layer = makeSelectionLayer(onSelect);
  const data = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {name: 'inside-polygon'},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 2],
              [0, 0]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: {name: 'outside-polygon'},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [10, 10],
              [12, 10],
              [12, 12],
              [10, 12],
              [10, 10]
            ]
          ]
        }
      }
    ]
  };
  const geoJsonLayer = {
    id: 'points',
    props: {data}
  };
  layer.context.layerManager.getLayers.mockReturnValue([geoJsonLayer]);

  layer._selectPolygonObjects(SELECTION_POLYGON);

  expect(onSelect).toHaveBeenCalledWith({
    pickingInfos: [{object: data.features[0], layer: geoJsonLayer, index: 0}]
  });
});

test('polygon selection ignores non-target layers and unsupported data shapes', () => {
  const onSelect = vi.fn();
  const layer = makeSelectionLayer(onSelect);
  layer.context.layerManager.getLayers.mockReturnValue([
    {
      id: 'other',
      props: {
        data: [{name: 'inside-other-layer', position: [1, 1]}]
      }
    },
    {
      id: 'points',
      props: {
        data: {not: 'array'}
      }
    },
    {
      id: 'points',
      props: {
        data: [{name: 'missing-position'}]
      }
    }
  ]);

  layer._selectPolygonObjects(SELECTION_POLYGON);

  expect(onSelect).toHaveBeenCalledWith({pickingInfos: []});
});
