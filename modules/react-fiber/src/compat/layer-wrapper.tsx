import type {Layer} from '@deck.gl/core';
import type {ComponentType} from 'react';

type LayerConstructor<Props extends object> = new (props: Props) => Layer;

/** @internal Lowers a compat layer component to the native reconciler primitive. */
export function createLayerComponent<Props extends object>(
  LayerConstructor: LayerConstructor<Props>
): ComponentType<Props> {
  function LayerComponent(props: Props) {
    return <layer layer={new LayerConstructor(props)} />;
  }

  return LayerComponent;
}
