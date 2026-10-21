// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import {MapController, MapView, type Deck} from '@deck.gl/core';
import {mountTreeLabExample} from './app';
import {getCompactTreeLabForest} from './test-utils';

type CameraState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  minZoom: number;
  maxZoom: number;
};

it('switches between hero and whole-forest framing with resettable camera controls', async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  let deck!: Deck<MapView>;
  const errors: string[] = [];
  const cleanup = mountTreeLabExample(parent, {
    data: getCompactTreeLabForest(),
    onDeckInitialized(instance) {
      deck = instance;
      deck.setProps({
        onError: error => errors.push(error.message)
      });
    }
  });
  const cameraButtons = {
    hero: parent.querySelector<HTMLButtonElement>('[data-camera-preset="hero"]')!,
    overview: parent.querySelector<HTMLButtonElement>('[data-camera-preset="overview"]')!
  };
  const resetView = parent.querySelector<HTMLButtonElement>('[name="reset-view"]')!;
  const configured = () => deck.props.initialViewState as CameraState;
  const selectPreset = (preset: 'hero' | 'overview') => {
    cameraButtons[preset].click();
    expect(cameraButtons[preset].getAttribute('aria-pressed')).toBe('true');
    expect(
      cameraButtons[preset === 'hero' ? 'overview' : 'hero'].getAttribute('aria-pressed')
    ).toBe('false');
    const expected = configured();
    expect(errors).toEqual([]);
    return {...expected};
  };
  try {
    await expect.poll(() => deck.getViewports().length, {timeout: 15_000}).toBe(1);
    expect(deck.props.views).toBeInstanceOf(MapView);
    expect((deck.props.views as MapView).props.nearZMultiplier).toBe(0.02);
    expect((deck.props.views as MapView).props.altitude).toBe(3);
    expect(deck.props.controller).toMatchObject({
      type: MapController,
      dragMode: 'pan',
      dragPan: true,
      dragRotate: true,
      inertia: 150,
      scrollZoom: {speed: 0.02, smooth: false},
      doubleClickZoom: true,
      zoomAround: 'pointer',
      touchRotate: true
    });
    const hero = selectPreset('hero');
    const overview = selectPreset('overview');
    // The Hero citrus preset holds a full, tall citrus silhouette at a near-eye-level pitch. Its
    // explicit altitude keeps the subject tight instead of reverting to the former top-down patch.
    expect(hero.pitch).toBe(85);
    expect(hero.bearing).toBe(24);
    expect(hero.zoom - overview.zoom).toBeGreaterThan(6);
    // A close canopy inspection needs substantial reach beyond the Hero preset while retaining a
    // physical camera standoff before the eye enters a crown.
    expect(hero.maxZoom - hero.zoom).toBeCloseTo(4.5, 4);
    expect(hero.zoom - hero.minZoom).toBeGreaterThanOrEqual(4);

    const inspected = selectPreset('hero');
    // MapController owns wheel/pinch mechanics, and its pointer-directed zoom is covered by the
    // shared controller browser tests. Tree Lab's responsibility is to expose that stock
    // controller configuration and to restore its authored preset without waiting on a software
    // GPU frame. This keeps the demo contract test deterministic in CI's serialized GPU suite.
    deck.setProps({initialViewState: {...inspected, zoom: inspected.zoom + 1}});
    resetView.click();
    const reset = configured();
    expect(reset.zoom).toBeCloseTo(inspected.zoom, 4);
    expect(reset.longitude).toBeCloseTo(inspected.longitude, 9);
    expect(reset.latitude).toBeCloseTo(inspected.latitude, 9);
    expect(reset.pitch).toBe(inspected.pitch);
    expect(reset.bearing).toBe(inspected.bearing);
    expect(errors).toEqual([]);
  } finally {
    cleanup();
    parent.remove();
  }
}, 30_000);
