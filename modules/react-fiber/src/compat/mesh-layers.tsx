import type {Layer} from '@deck.gl/core';
import {
  ScenegraphLayer as DeckScenegraphLayer,
  SimpleMeshLayer as DeckSimpleMeshLayer
} from '@deck.gl/mesh-layers';
import type {ScenegraphLayerProps, SimpleMeshLayerProps} from '@deck.gl/mesh-layers';
import type {ComponentType} from 'react';
import {createLayerComponent} from './layer-wrapper';

type LayerComponent<Props extends object> = ComponentType<Props>;
type LayerConstructor<Props extends object> = new (props: Props) => Layer;

export const ScenegraphLayer: LayerComponent<ScenegraphLayerProps> = createLayerComponent(
  DeckScenegraphLayer as LayerConstructor<ScenegraphLayerProps>
);
export const SimpleMeshLayer: LayerComponent<SimpleMeshLayerProps> = createLayerComponent(
  DeckSimpleMeshLayer as LayerConstructor<SimpleMeshLayerProps>
);
