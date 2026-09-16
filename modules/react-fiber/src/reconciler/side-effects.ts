import {FirstPersonView, MapView, OrbitView, OrthographicView, _GlobeView} from '@deck.gl/core';
import {
  ArcLayer,
  BitmapLayer,
  ColumnLayer,
  GeoJsonLayer,
  GridCellLayer,
  IconLayer,
  LineLayer,
  PathLayer,
  PointCloudLayer,
  PolygonLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
  TextLayer
} from '@deck.gl/layers';
import {
  A5Layer,
  GeohashLayer,
  GreatCircleLayer,
  H3ClusterLayer,
  H3HexagonLayer,
  MVTLayer,
  QuadkeyLayer,
  S2Layer,
  TerrainLayer,
  Tile3DLayer,
  TileLayer,
  TripsLayer,
  _WMSLayer
} from '@deck.gl/geo-layers';
import {ScenegraphLayer, SimpleMeshLayer} from '@deck.gl/mesh-layers';

import {extend} from './extend';

/**
 * Registers the built-in constructors for the legacy typed JSX syntax.
 *
 * The universal `<layer>` and `<view>` elements remain the preferred API and
 * do not require this catalogue. This registration is kept for applications
 * that still import the compatibility side-effects entrypoint.
 */
extend({
  FirstPersonView,
  MapView,
  OrbitView,
  OrthographicView,
  GlobeView: _GlobeView,
  ArcLayer,
  BitmapLayer,
  ColumnLayer,
  GeoJsonLayer,
  GridCellLayer,
  IconLayer,
  LineLayer,
  PathLayer,
  PointCloudLayer,
  PolygonLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
  TextLayer,
  A5Layer,
  GeohashLayer,
  GreatCircleLayer,
  H3ClusterLayer,
  H3HexagonLayer,
  MVTLayer,
  QuadkeyLayer,
  S2Layer,
  TerrainLayer,
  Tile3DLayer,
  TileLayer,
  TripsLayer,
  WMSLayer: _WMSLayer,
  ScenegraphLayer,
  SimpleMeshLayer
});

/**
 * @deprecated This file is deprecated and will be removed in v3.
 *
 * Layer registration is no longer needed with the new <layer> element.
 * Remove this import and use:
 *
 * import { ScatterplotLayer } from '@deck.gl/layers';
 * <layer layer={new ScatterplotLayer({ id: 'points', data })} />
 *
 * This provides better type safety, enables code-splitting, and eliminates
 * the need for manual layer registration.
 */

if (process.env.NODE_ENV === 'development') {
  console.warn(
    '@deck.gl-community/react-fiber/reconciler/side-effects is deprecated and will be removed in v3.\n' +
      'Layer registration is no longer needed. Remove this import and use:\n' +
      '  import { ScatterplotLayer } from "@deck.gl/layers";\n' +
      '  <layer layer={new ScatterplotLayer({ id: "points", data })} />\n' +
      'See migration guide for more details.'
  );
}
