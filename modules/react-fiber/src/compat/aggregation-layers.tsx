import type {Layer} from '@deck.gl/core';
import {
  ContourLayer as DeckContourLayer,
  GridLayer as DeckGridLayer,
  HeatmapLayer as DeckHeatmapLayer,
  HexagonLayer as DeckHexagonLayer,
  ScreenGridLayer as DeckScreenGridLayer
} from '@deck.gl/aggregation-layers';
import type {
  ContourLayerProps,
  GridLayerProps,
  HeatmapLayerProps,
  HexagonLayerProps,
  ScreenGridLayerProps
} from '@deck.gl/aggregation-layers';
import type {ComponentType} from 'react';
import {createLayerComponent} from './layer-wrapper';

type LayerComponent<Props extends object> = ComponentType<Props>;
type LayerConstructor<Props extends object> = new (props: Props) => Layer;

export const ScreenGridLayer: LayerComponent<ScreenGridLayerProps> = createLayerComponent(
  DeckScreenGridLayer as LayerConstructor<ScreenGridLayerProps>
);
export const HexagonLayer: LayerComponent<HexagonLayerProps> = createLayerComponent(
  DeckHexagonLayer as LayerConstructor<HexagonLayerProps>
);
export const ContourLayer: LayerComponent<ContourLayerProps> = createLayerComponent(
  DeckContourLayer as LayerConstructor<ContourLayerProps>
);
export const GridLayer: LayerComponent<GridLayerProps> = createLayerComponent(
  DeckGridLayer as LayerConstructor<GridLayerProps>
);
export const HeatmapLayer: LayerComponent<HeatmapLayerProps> = createLayerComponent(
  DeckHeatmapLayer as LayerConstructor<HeatmapLayerProps>
);
