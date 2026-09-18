import type {Layer} from '@deck.gl/core';
import {
  ArcLayer as DeckArcLayer,
  BitmapLayer as DeckBitmapLayer,
  ColumnLayer as DeckColumnLayer,
  GeoJsonLayer as DeckGeoJsonLayer,
  GridCellLayer as DeckGridCellLayer,
  IconLayer as DeckIconLayer,
  LineLayer as DeckLineLayer,
  PathLayer as DeckPathLayer,
  PointCloudLayer as DeckPointCloudLayer,
  PolygonLayer as DeckPolygonLayer,
  ScatterplotLayer as DeckScatterplotLayer,
  SolidPolygonLayer as DeckSolidPolygonLayer,
  TextLayer as DeckTextLayer
} from '@deck.gl/layers';
import type {
  ArcLayerProps,
  BitmapLayerProps,
  ColumnLayerProps,
  GeoJsonLayerProps,
  GridCellLayerProps,
  IconLayerProps,
  LineLayerProps,
  PathLayerProps,
  PointCloudLayerProps,
  PolygonLayerProps,
  ScatterplotLayerProps,
  SolidPolygonLayerProps,
  TextLayerProps
} from '@deck.gl/layers';
import type {ComponentType} from 'react';
import {createLayerComponent} from './layer-wrapper';

type LayerComponent<Props extends object> = ComponentType<Props>;
type LayerConstructor<Props extends object> = new (props: Props) => Layer;

export const ArcLayer: LayerComponent<ArcLayerProps> = createLayerComponent(
  DeckArcLayer as LayerConstructor<ArcLayerProps>
);
export const BitmapLayer: LayerComponent<BitmapLayerProps> = createLayerComponent(
  DeckBitmapLayer as LayerConstructor<BitmapLayerProps>
);
export const IconLayer: LayerComponent<IconLayerProps> = createLayerComponent(
  DeckIconLayer as LayerConstructor<IconLayerProps>
);
export const LineLayer: LayerComponent<LineLayerProps> = createLayerComponent(
  DeckLineLayer as LayerConstructor<LineLayerProps>
);
export const PointCloudLayer: LayerComponent<PointCloudLayerProps> = createLayerComponent(
  DeckPointCloudLayer as LayerConstructor<PointCloudLayerProps>
);
export const ScatterplotLayer: LayerComponent<ScatterplotLayerProps> = createLayerComponent(
  DeckScatterplotLayer as LayerConstructor<ScatterplotLayerProps>
);
export const ColumnLayer: LayerComponent<ColumnLayerProps> = createLayerComponent(
  DeckColumnLayer as LayerConstructor<ColumnLayerProps>
);
export const GridCellLayer: LayerComponent<GridCellLayerProps> = createLayerComponent(
  DeckGridCellLayer as LayerConstructor<GridCellLayerProps>
);
export const PathLayer: LayerComponent<PathLayerProps> = createLayerComponent(
  DeckPathLayer as LayerConstructor<PathLayerProps>
);
export const PolygonLayer: LayerComponent<PolygonLayerProps> = createLayerComponent(
  DeckPolygonLayer as LayerConstructor<PolygonLayerProps>
);
export const GeoJsonLayer: LayerComponent<GeoJsonLayerProps> = createLayerComponent(
  DeckGeoJsonLayer as LayerConstructor<GeoJsonLayerProps>
);
export const TextLayer: LayerComponent<TextLayerProps> = createLayerComponent(
  DeckTextLayer as LayerConstructor<TextLayerProps>
);
export const SolidPolygonLayer: LayerComponent<SolidPolygonLayerProps> = createLayerComponent(
  DeckSolidPolygonLayer as LayerConstructor<SolidPolygonLayerProps>
);
