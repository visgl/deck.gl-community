// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, expect, test, vi} from 'vitest';
import {Matrix4} from '@math.gl/core';
import type {DeckProps} from '@deck.gl/core';
import {mountTerrainContractExample} from './app';

const mocks = vi.hoisted(() => ({props: {} as DeckProps, setProps: vi.fn(), finalize: vi.fn()}));
vi.mock('@deck.gl/core', () => ({
  OrbitView: class {},
  COORDINATE_SYSTEM: {CARTESIAN: 0},
  Deck: class {
    constructor(props: DeckProps) {
      mocks.props = props;
    }
    setProps = mocks.setProps;
    finalize = mocks.finalize;
  }
}));
vi.mock('@deck.gl/layers', () => ({
  PolygonLayer: class {
    constructor(readonly props: unknown) {}
  }
}));
vi.mock(
  '@deck.gl-community/geo-layers',
  async () => import('../../../modules/geo-layers/src/terrain/terrain-query')
);

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

test('updates display geometry without altering physical elevation, then releases its DOM and renderer', () => {
  const container = document.createElement('div');
  document.body.append(container);
  cleanup = mountTerrainContractExample(container);
  const slider = container.querySelector<HTMLInputElement>('input')!;
  const hover = mocks.props.onHover;
  if (typeof hover !== 'function') throw new Error('Missing terrain hover handler');
  const viewport = {
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    viewProjectionMatrix: new Matrix4().ortho({
      left: 0,
      right: 2000,
      bottom: 0,
      top: 2000,
      near: -1000,
      far: 1000
    })
  };
  Reflect.apply(hover, null, [{viewport, x: 100, y: 100}]);
  expect(container.textContent).toContain('Physical elevation: 15.00 m. Displayed Z: 60.00 m.');
  slider.value = '0';
  slider.dispatchEvent(new Event('input'));
  expect(mocks.setProps).toHaveBeenCalledOnce();
  Reflect.apply(hover, null, [{viewport, x: 100, y: 100}]);
  expect(container.textContent).toContain('Physical elevation: 15.00 m. Displayed Z: 0.00 m.');
  cleanup();
  cleanup = undefined;
  expect(mocks.finalize).toHaveBeenCalledOnce();
  expect(container.children).toHaveLength(0);
});
