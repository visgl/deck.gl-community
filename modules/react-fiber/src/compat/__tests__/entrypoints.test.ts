import {describe, expect, it} from 'vitest';
import * as aggregationLayers from '../aggregation-layers';
import * as geoLayers from '../geo-layers';
import * as layers from '../layers';
import * as meshLayers from '../mesh-layers';
import * as compat from '../index';

describe('compat entrypoint export matrices', () => {
  it('exports only the approved root compatibility API', () => {
    expect(Object.keys(compat).sort()).toEqual([
      'DeckGL',
      'FirstPersonView',
      'GlobeView',
      'MapView',
      'OrbitView',
      'OrthographicView'
    ]);
  });

  it('exports the approved layer family wrappers and no aggregation internals', () => {
    expect(Object.keys(layers).sort()).toEqual([
      'ArcLayer',
      'BitmapLayer',
      'ColumnLayer',
      'GeoJsonLayer',
      'GridCellLayer',
      'IconLayer',
      'LineLayer',
      'PathLayer',
      'PointCloudLayer',
      'PolygonLayer',
      'ScatterplotLayer',
      'SolidPolygonLayer',
      'TextLayer'
    ]);
    expect(Object.keys(aggregationLayers).sort()).toEqual([
      'ContourLayer',
      'GridLayer',
      'HeatmapLayer',
      'HexagonLayer',
      'ScreenGridLayer'
    ]);
    expect(aggregationLayers).not.toHaveProperty('_AggregationLayer');
    expect(aggregationLayers).not.toHaveProperty('WebGLAggregator');
  });

  it('exports the approved geo and mesh wrappers', () => {
    expect(Object.keys(geoLayers).sort()).toEqual([
      'GeohashLayer',
      'GreatCircleLayer',
      'H3ClusterLayer',
      'H3HexagonLayer',
      'MVTLayer',
      'QuadkeyLayer',
      'S2Layer',
      'TerrainLayer',
      'Tile3DLayer',
      'TileLayer',
      'TripsLayer',
      'WMSLayer'
    ]);
    expect(Object.keys(meshLayers).sort()).toEqual(['ScenegraphLayer', 'SimpleMeshLayer']);
  });
});
