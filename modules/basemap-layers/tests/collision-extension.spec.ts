/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {LabelCollisionFilterExtension} from '../src/collision-extension';

const COLLISION_PASS = {shaderModuleProps: {collision: {drawToCollisionMap: true}}};
const SCREEN_PASS = {shaderModuleProps: {collision: {drawToCollisionMap: false}}};

/** A layer stub whose `clone` merges props, as deck.gl's does. */
function createLayer(props: Record<string, unknown>) {
  const layer: any = {props};
  layer.clone = vi.fn((overrides: Record<string, unknown>) => ({
    props: {...layer.props, ...overrides}
  }));
  return layer;
}

/** Draws `layer` with the extension, then restores its props, as `Layer._drawLayer` does. */
function draw(layer: any, options: any) {
  const props = layer.props;
  const extension = new LabelCollisionFilterExtension();
  extension.draw.call(layer, options, extension);
  const drawn = layer.props;
  layer.props = props;
  return drawn;
}

describe('LabelCollisionFilterExtension', () => {
  test('draws the collision map with the collision test props', () => {
    const layer = createLayer({sizeScale: 1, collisionTestProps: {sizeScale: 0}});
    expect(draw(layer, COLLISION_PASS).sizeScale).toBe(0);
    expect(layer.props.sizeScale).toBe(1);
  });

  test('merges the props once per props object, not at every draw', () => {
    const layer = createLayer({sizeScale: 1, collisionTestProps: {sizeScale: 0}});
    const first = draw(layer, COLLISION_PASS);
    const second = draw(layer, COLLISION_PASS);
    expect(second).toBe(first);
    expect(layer.clone).toHaveBeenCalledTimes(1);
  });

  test('merges again when the layer has new props', () => {
    const layer = createLayer({sizeScale: 1, collisionTestProps: {sizeScale: 0}});
    draw(layer, COLLISION_PASS);
    layer.props = {sizeScale: 2, collisionTestProps: {padding: [1, 1, 1, 1]}};
    const drawn = draw(layer, COLLISION_PASS);
    expect(layer.clone).toHaveBeenCalledTimes(2);
    expect(drawn).toMatchObject({sizeScale: 2, padding: [1, 1, 1, 1]});
  });

  test('leaves the props of other passes alone', () => {
    const layer = createLayer({sizeScale: 1, collisionTestProps: {sizeScale: 0}});
    const props = layer.props;
    expect(draw(layer, SCREEN_PASS)).toBe(props);
    expect(layer.clone).not.toHaveBeenCalled();
  });

  test('leaves the props of other passes alone after a collision pass', () => {
    const layer = createLayer({sizeScale: 1, collisionTestProps: {sizeScale: 0}});
    const props = layer.props;
    draw(layer, COLLISION_PASS);
    expect(draw(layer, SCREEN_PASS)).toBe(props);
  });
});
