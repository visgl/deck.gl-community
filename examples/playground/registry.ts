// deck.gl-community
// SPDX-License-Identifier: MIT
import {Layer} from '@deck.gl/core';
import * as layers from '@deck.gl/layers';
import * as aggregation from '@deck.gl/aggregation-layers';
import * as geo from '@deck.gl/geo-layers';
import * as mesh from '@deck.gl/mesh-layers';
import * as arrow from '@deck.gl-community/arrow-layers';
import * as basemap from '@deck.gl-community/basemap-layers';
import * as editable from '@deck.gl-community/editable-layers';
import * as experimental from '@deck.gl-community/experimental';
import * as communityGeo from '@deck.gl-community/geo-layers';
import * as graph from '@deck.gl-community/graph-layers';
import * as infovis from '@deck.gl-community/infovis-layers';
import * as communityLayers from '@deck.gl-community/layers';
import * as three from '@deck.gl-community/three';
import * as timeline from '@deck.gl-community/timeline-layers';
import {
  GraphGridLayerSchema,
  type PlaygroundLayerConstructor,
  type PlaygroundRegistry
} from '@deck.gl-community/playground';

// Abstract upstream bases are exported for subclassing, not standalone rendering.
const ABSTRACT_LAYERS = new Set(['_AggregationLayer', '_GeoCellLayer']);
const LAYERS = Object.fromEntries(
  Object.entries({
    ...layers,
    ...aggregation,
    ...geo,
    ...mesh,
    ...arrow,
    ...basemap,
    ...editable,
    ...experimental,
    ...communityGeo,
    ...graph,
    ...infovis,
    ...communityLayers,
    ...three,
    ...timeline,
    GridLayer: aggregation.GridLayer
  }).filter(
    ([name, type]) =>
      !ABSTRACT_LAYERS.has(name) && typeof type === 'function' && type.prototype instanceof Layer
  )
) as Record<string, PlaygroundLayerConstructor>;

/** The website opts into every public concrete layer; the library registers none implicitly. */
export function createPlaygroundRegistry(): PlaygroundRegistry {
  return {
    layers: {
      ...LAYERS,
      GraphGridLayer: {type: graph.GridLayer, schema: GraphGridLayerSchema}
    },
    constants: {
      ...Object.fromEntries(
        Object.entries(editable).filter(
          ([name, value]) => name.endsWith('Mode') && typeof value === 'function'
        )
      ),
      A5Grid: communityGeo.A5Grid,
      H3Grid: communityGeo.H3Grid,
      S2Grid: communityGeo.S2Grid,
      GeohashGrid: communityGeo.GeohashGrid,
      QuadkeyGrid: communityGeo.QuadkeyGrid,
      SimpleLayout: new graph.SimpleLayout()
    }
  };
}
