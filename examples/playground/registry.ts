// deck.gl-community
// SPDX-License-Identifier: MIT
import {Layer} from '@deck.gl/core';
import {DOTLoaderWithParser} from '@loaders.gl/graphs/dot-loader';
import * as layers from '@deck.gl/layers';
import * as aggregation from '@deck.gl/aggregation-layers';
import * as geo from '@deck.gl/geo-layers';
import * as mesh from '@deck.gl/mesh-layers';
import * as editable from '@deck.gl-community/editable-layers';
import * as experimental from '@deck.gl-community/experimental';
import * as communityGeo from '@deck.gl-community/layers/geo-layers';
import {H3Grid} from '@deck.gl-community/layers/global-grid-layers/h3';
import {A5Grid} from '@deck.gl-community/layers/global-grid-layers/a5';
import * as communityWind from '@deck.gl-community/layers/wind-layers';
import * as communityGrids from '@deck.gl-community/layers/global-grid-layers';
import * as graph from '@deck.gl-community/graph-layers';
import * as communityLayers from '@deck.gl-community/layers';
import * as timeline from '@deck.gl-community/layers/timeline-layers';
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
    ...editable,
    ...experimental,
    ...communityGeo,
    ...communityWind,
    ...communityGrids,
    ...graph,
    ...communityLayers,
    ...timeline,
    GridLayer: aggregation.GridLayer
  }).filter(
    ([name, type]) =>
      !ABSTRACT_LAYERS.has(name) && typeof type === 'function' && type.prototype instanceof Layer
  )
) as Record<string, PlaygroundLayerConstructor>;

/** The website opts into every public concrete layer; the library registers none implicitly. */
export function createPlaygroundRegistry(
  constants: PlaygroundRegistry['constants'] = {}
): PlaygroundRegistry {
  return {
    layers: {
      ...LAYERS,
      GraphGridLayer: {type: graph.GridLayer, schema: GraphGridLayerSchema}
    },
    functions: {
      D3ForceLayout: props => new graph.D3ForceLayout(props),
      RadialLayout: props => new graph.RadialLayout(props)
    },
    constants: {
      ...Object.fromEntries(
        Object.entries(editable).filter(
          ([name, value]) => name.endsWith('Mode') && typeof value === 'function'
        )
      ),
      A5Grid,
      H3Grid,
      S2Grid: communityGrids.S2Grid,
      GeohashGrid: communityGrids.GeohashGrid,
      QuadkeyGrid: communityGrids.QuadkeyGrid,
      DOTLoader: DOTLoaderWithParser,
      SimpleLayout: new graph.SimpleLayout(),
      ...constants
    }
  };
}
