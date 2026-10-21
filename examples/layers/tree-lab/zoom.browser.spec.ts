// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import {MapController, MapView, type Deck, type WebMercatorViewport} from '@deck.gl/core';
import {mountTreeLabExample} from './app';

type CameraState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  minZoom: number;
  maxZoom: number;
};

function distanceMeters(
  a: Pick<CameraState, 'longitude' | 'latitude'>,
  b: Pick<CameraState, 'longitude' | 'latitude'>
): number {
  // The forest is centered at the equator, where MapView's degree-to-metre conversion is stable.
  return Math.hypot((a.longitude - b.longitude) * 111_319.5, (a.latitude - b.latitude) * 111_319.5);
}

it('switches between hero and whole-forest framing with resettable pointer-directed inspection', async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  let deck!: Deck<MapView>;
  let frames = 0;
  const errors: string[] = [];
  const cleanup = mountTreeLabExample(parent, {
    onDeckInitialized(instance) {
      deck = instance;
      deck.setProps({
        onError: error => errors.push(error.message),
        onAfterRender: () => {
          frames++;
        }
      });
    }
  });
  const cameraButtons = {
    hero: parent.querySelector<HTMLButtonElement>('[data-camera-preset="hero"]')!,
    overview: parent.querySelector<HTMLButtonElement>('[data-camera-preset="overview"]')!
  };
  const resetView = parent.querySelector<HTMLButtonElement>('[name="reset-view"]')!;
  const viewport = () => deck.getViewports()[0] as WebMercatorViewport;
  const current = () => ({
    longitude: viewport().longitude,
    latitude: viewport().latitude,
    zoom: viewport().zoom
  });
  const configured = () => deck.props.initialViewState as CameraState;
  const selectPreset = async (preset: 'hero' | 'overview') => {
    const previousFrames = frames;
    cameraButtons[preset].click();
    await expect.poll(() => frames, {timeout: 10_000}).toBeGreaterThan(previousFrames);
    expect(cameraButtons[preset].getAttribute('aria-pressed')).toBe('true');
    expect(
      cameraButtons[preset === 'hero' ? 'overview' : 'hero'].getAttribute('aria-pressed')
    ).toBe('false');
    const expected = configured();
    await expect.poll(() => current().zoom, {timeout: 10_000}).toBeCloseTo(expected.zoom, 4);
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
    const hero = await selectPreset('hero');
    const overview = await selectPreset('overview');
    // The Hero citrus preset holds a full, tall citrus silhouette at a near-eye-level pitch. Its
    // explicit altitude keeps the subject tight instead of reverting to the former top-down patch.
    expect(hero.pitch).toBe(85);
    expect(hero.bearing).toBe(24);
    expect(hero.zoom - overview.zoom).toBeGreaterThan(6);
    // A close canopy inspection needs substantial reach beyond the Hero preset while retaining a
    // physical camera standoff before the eye enters a crown.
    expect(hero.maxZoom - hero.zoom).toBeCloseTo(4.5, 4);
    expect(hero.zoom - hero.minZoom).toBeGreaterThanOrEqual(4);

    const inspected = await selectPreset('hero');
    const canvas = deck.getCanvas()!;
    const bounds = canvas.getBoundingClientRect();
    const before = current();
    const previousFrames = frames;
    // Scroll on a particular crown, rather than the canvas center. This moves the camera target
    // as well as zoom so an operator can inspect nearby and distant canopy resolution together.
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width * 0.78,
        clientY: bounds.top + bounds.height * 0.32,
        deltaY: -240
      })
    );
    await expect.poll(() => frames, {timeout: 10_000}).toBeGreaterThan(previousFrames);
    await expect.poll(() => current().zoom, {timeout: 10_000}).toBeGreaterThan(before.zoom + 0.5);
    await expect
      .poll(() => distanceMeters(current(), before), {timeout: 10_000})
      .toBeGreaterThan(1);

    const closeUp = current();
    const zoomOutFrames = frames;
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width * 0.78,
        clientY: bounds.top + bounds.height * 0.32,
        deltaY: 240
      })
    );
    await expect.poll(() => frames, {timeout: 10_000}).toBeGreaterThan(zoomOutFrames);
    await expect.poll(() => current().zoom, {timeout: 10_000}).toBeLessThan(closeUp.zoom - 0.5);

    const resetFrames = frames;
    resetView.click();
    await expect.poll(() => frames, {timeout: 10_000}).toBeGreaterThan(resetFrames);
    await expect.poll(() => current().zoom, {timeout: 10_000}).toBeCloseTo(inspected.zoom, 4);
    await expect
      .poll(() => distanceMeters(current(), inspected), {timeout: 10_000})
      .toBeLessThan(0.1);
    expect(errors).toEqual([]);
  } finally {
    cleanup();
    parent.remove();
  }
}, 60_000);
