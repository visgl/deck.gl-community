import type {Layer} from '@deck.gl/core';
import {
  GeohashLayer as DeckGeohashLayer,
  GreatCircleLayer as DeckGreatCircleLayer,
  H3ClusterLayer as DeckH3ClusterLayer,
  H3HexagonLayer as DeckH3HexagonLayer,
  MVTLayer as DeckMVTLayer,
  QuadkeyLayer as DeckQuadkeyLayer,
  S2Layer as DeckS2Layer,
  TerrainLayer as DeckTerrainLayer,
  Tile3DLayer as DeckTile3DLayer,
  TileLayer as DeckTileLayer,
  TripsLayer as DeckTripsLayer,
  _WMSLayer as DeckWMSLayer
} from '@deck.gl/geo-layers';
import type {
  GeohashLayerProps,
  GreatCircleLayerProps,
  H3ClusterLayerProps,
  H3HexagonLayerProps,
  MVTLayerProps,
  QuadkeyLayerProps,
  S2LayerProps,
  TerrainLayerProps,
  Tile3DLayerProps,
  TileLayerProps,
  TripsLayerProps,
  WMSLayerProps
} from '@deck.gl/geo-layers';
import type {ComponentType} from 'react';
import {createLayerComponent} from './layer-wrapper';

type LayerComponent<Props extends object> = ComponentType<Props>;
type LayerConstructor<Props extends object> = new (props: Props) => Layer;

export const S2Layer: LayerComponent<S2LayerProps> = createLayerComponent(
  DeckS2Layer as LayerConstructor<S2LayerProps>
);
export const QuadkeyLayer: LayerComponent<QuadkeyLayerProps> = createLayerComponent(
  DeckQuadkeyLayer as LayerConstructor<QuadkeyLayerProps>
);
export const TileLayer: LayerComponent<TileLayerProps> = createLayerComponent(
  DeckTileLayer as LayerConstructor<TileLayerProps>
);
export const H3ClusterLayer: LayerComponent<H3ClusterLayerProps> = createLayerComponent(
  DeckH3ClusterLayer as LayerConstructor<H3ClusterLayerProps>
);
export const H3HexagonLayer: LayerComponent<H3HexagonLayerProps> = createLayerComponent(
  DeckH3HexagonLayer as LayerConstructor<H3HexagonLayerProps>
);
export const Tile3DLayer: LayerComponent<Tile3DLayerProps> = createLayerComponent(
  DeckTile3DLayer as LayerConstructor<Tile3DLayerProps>
);
export const TerrainLayer: LayerComponent<TerrainLayerProps> = createLayerComponent(
  DeckTerrainLayer as LayerConstructor<TerrainLayerProps>
);
export const GeohashLayer: LayerComponent<GeohashLayerProps> = createLayerComponent(
  DeckGeohashLayer as LayerConstructor<GeohashLayerProps>
);
export const GreatCircleLayer: LayerComponent<GreatCircleLayerProps> = createLayerComponent(
  DeckGreatCircleLayer as LayerConstructor<GreatCircleLayerProps>
);
export const TripsLayer: LayerComponent<TripsLayerProps> = createLayerComponent(
  DeckTripsLayer as LayerConstructor<TripsLayerProps>
);
export const MVTLayer: LayerComponent<MVTLayerProps> = createLayerComponent(
  DeckMVTLayer as LayerConstructor<MVTLayerProps>
);
export const WMSLayer: LayerComponent<WMSLayerProps> = createLayerComponent(
  DeckWMSLayer as LayerConstructor<WMSLayerProps>
);

/** @deprecated Use MVTLayer. */
export const mVTLayer = MVTLayer;
/** @deprecated Use WMSLayer. */
export const wMSLayer = WMSLayer;
