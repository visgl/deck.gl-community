import type {Layer} from '@deck.gl/core';
import {CollisionFilterExtension} from '@deck.gl/extensions';

/**
 * The props each layer draws the collision map with: its props merged with `collisionTestProps`,
 * by the props object they were made from. A layer's props object is replaced, never changed,
 * when the layer updates, so an entry stays valid for as long as its key is alive.
 */
const collisionPassProps = new WeakMap<object, object>();

/**
 * `CollisionFilterExtension`, which draws the collision map with the layer's props merged with its
 * `collisionTestProps`. deck.gl merges them by cloning the layer at every draw of the collision
 * pass, which is every frame while the view moves, for every label sublayer. The merged props are
 * kept instead, and made again only when the layer's props change.
 */
export class LabelCollisionFilterExtension extends CollisionFilterExtension {
  draw(this: Layer<any>, options: any): void {
    if (!options.shaderModuleProps?.collision?.drawToCollisionMap) {
      return;
    }
    const props = this.props;
    const merged = collisionPassProps.get(props);
    if (merged) {
      this.props = merged as any;
      return;
    }
    CollisionFilterExtension.prototype.draw.call(this, options);
    collisionPassProps.set(props, this.props);
  }
}
