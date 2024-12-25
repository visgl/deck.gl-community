// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// This configuration object determines which deck.gl classes are accessible in Playground

// deck.gl
import {MapView, FirstPersonView, OrbitView, OrthographicView} from '@deck.gl/core';
import {COORDINATE_SYSTEM} from '@deck.gl/core';
import * as Layers from '@deck.gl/layers';
import * as AggregationLayers from '@deck.gl/aggregation-layers';
import * as GeoLayers from '@deck.gl/geo-layers';
import * as MeshLayers from '@deck.gl/mesh-layers';

import * as CommunityLayers from '@deck.gl-community/layers';
import * as EditableLayers from '@deck.gl-community/editable-layers';
import * as GraphLayers from '@deck.gl-community/graph-layers';
// import * as ArrowLayers from '@deck.gl-community/arrow-layers';

import {registerLoaders} from '@loaders.gl/core';
import {CSVLoader} from '@loaders.gl/csv';
import {DracoWorkerLoader} from '@loaders.gl/draco';
import {Tiles3DLoader, CesiumIonLoader} from '@loaders.gl/3d-tiles';

const LOADERS = [
  CSVLoader,
  DracoWorkerLoader
]

// Note: deck already registers JSONLoader...
registerLoaders(LOADERS);

/**
 * Configuration for the deck.gl/json converter.
 * Registers deck.gl and deck.gl-community classes with the JSON converter
 */
export const JSON_CONFIGURATION = {
  // Classes that should be instantiatable by JSON converter
  classes: {
    // Support `@deck.gl/core` Views
    MapView,
    FirstPersonView,
    OrbitView,
    OrthographicView,

    // a map of all layers that should be exposes as JSONLayers
    ...Layers,
    ...AggregationLayers,
    ...GeoLayers,
    ...MeshLayers,

    // community layer modules
    ...CommunityLayers,
    ...EditableLayers,
    ...GraphLayers,
    // ArrowLayers,
  },

  // Functions that should be executed by JSON converter
  functions: {},

  // Enumerations that should be available to JSON parser
  // Will be resolved as `<enum-name>.<enum-value>`
  enumerations: {
    COORDINATE_SYSTEM,
  },

  // Constants that should be resolved with the provided values by JSON converter
  constants: {
    Tiles3DLoader,
    CesiumIonLoader
  }
};
