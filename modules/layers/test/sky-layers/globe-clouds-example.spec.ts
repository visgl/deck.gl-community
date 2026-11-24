// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test, vi} from 'vitest';
import {createGlobeCloudScene} from '../../../../examples/layers/globe-clouds/app';

vi.mock('@deck.gl/core', async importOriginal => ({
  ...(await importOriginal<object>()),
  Deck: class {
    props: any;
    constructor(props: any) {
      this.props = props;
    }
    setProps(props: any): void {
      this.props = {...this.props, ...props};
    }
    redraw(): void {}
    finalize(): void {}
  }
}));

test('globe pause disables continuous drawing and resume resets the clock', () => {
  vi.stubGlobal('window', {matchMedia: () => ({matches: false})});
  try {
    const scene = createGlobeCloudScene({clientWidth: 800, clientHeight: 600} as HTMLDivElement);
    scene.setAnimate(false);
    expect(scene.deck.props._animate).toBe(false);
    scene.setAnimate(true);
    expect(scene.deck.props._animate).toBe(true);
    scene.finalize();
  } finally {
    vi.unstubAllGlobals();
  }
});

test('Center restores the globe camera after a controller movement', () => {
  vi.stubGlobal('window', {matchMedia: () => ({matches: false})});
  try {
    const scene = createGlobeCloudScene({clientWidth: 800, clientHeight: 600} as HTMLDivElement);
    const initial = scene.deck.props.viewState as any;
    (scene.deck.props.onViewStateChange as any)({
      viewState: {...initial, longitude: initial.longitude + 5, zoom: initial.zoom - 1}
    });
    scene.centerView();
    expect(scene.deck.props.viewState).toEqual(initial);
    scene.finalize();
  } finally {
    vi.unstubAllGlobals();
  }
});
