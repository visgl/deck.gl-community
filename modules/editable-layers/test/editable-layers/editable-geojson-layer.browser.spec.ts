// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, test} from 'vitest';
import {DrawPolygonByDraggingMode} from '../../src/edit-modes/draw-polygon-by-dragging-mode';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import type {FeatureCollection} from '../../src/utils/geojson-types';

async function createGestureScene() {
  const parent = document.createElement('div');
  parent.style.width = '240px';
  parent.style.height = '240px';
  document.body.append(parent);
  const mode = new DrawPolygonByDraggingMode();
  let data: FeatureCollection = {type: 'FeatureCollection', features: []};
  const errors: Error[] = [];
  const edits: string[] = [];
  let deck: Deck;
  const createLayer = () =>
    new EditableGeoJsonLayer({
      id: 'gesture-browser-test',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data,
      mode,
      selectedFeatureIndexes: [],
      onEdit: action => {
        data = action.updatedData;
        edits.push(action.editType);
        deck.setProps({layers: [createLayer()]});
      }
    });
  const original = createLayer();
  deck = new Deck({
    parent,
    width: 240,
    height: 240,
    views: new OrthographicView(),
    initialViewState: {target: [0, 0, 0], zoom: 0},
    controller: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    layers: [original],
    onError: error => errors.push(error)
  });
  await expect.poll(() => original.state?.mode).toBe(mode);
  const canvas = parent.querySelector('canvas')!;
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const sendPointer = async (
    type: string,
    x: number,
    y: number,
    pointerType = 'mouse',
    button = 0
  ) => {
    const rect = canvas.getBoundingClientRect();
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType,
      isPrimary: true,
      button: type === 'pointermove' ? -1 : button,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : [1, 4, 2][button],
      clientX: rect.left + x,
      clientY: rect.top + y
    });
    (type === 'pointerdown' ? canvas : window).dispatchEvent(event);
    await frame();
  };
  return {
    deck,
    parent,
    original,
    mode,
    errors,
    edits,
    frame,
    sendPointer,
    getData: () => data,
    replace: async () => {
      const replacement = createLayer();
      deck.setProps({layers: [replacement]});
      await expect.poll(() => original.getCurrentLayer()).toBe(replacement);
      return replacement;
    },
    cleanup: () => {
      deck.finalize();
      parent.remove();
    }
  };
}

test.each([
  'mouse',
  'touch'
])('native %s pointer drag survives deck.gl layer replacement', async pointerType => {
  const scene = await createGestureScene();
  try {
    await scene.sendPointer('pointerdown', 30, 30, pointerType);
    await scene.sendPointer('pointermove', 70, 30, pointerType);
    expect(scene.original.state.isDraggingWithPrimaryButton).toBe(true);
    const replacement = await scene.replace();
    expect(replacement.state).toBe(scene.original.state);
    await scene.sendPointer('pointermove', 180, 30, pointerType);
    await scene.sendPointer('pointermove', 180, 180, pointerType);
    await scene.sendPointer('pointerup', 30, 180, pointerType);
    expect(scene.getData().features).toHaveLength(1);
    expect(scene.edits.filter(type => type === 'addFeature')).toHaveLength(1);
    expect(replacement.state.isDraggingWithPrimaryButton).toBe(false);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.cleanup();
  }
});

test('native pointercancel discards the tentative polygon after replacement', async () => {
  const scene = await createGestureScene();
  try {
    await scene.sendPointer('pointerdown', 30, 30);
    await scene.sendPointer('pointermove', 70, 30);
    await scene.replace();
    await scene.sendPointer('pointermove', 180, 30);
    await scene.sendPointer('pointermove', 180, 180);
    await scene.sendPointer('pointercancel', 30, 180);
    expect(scene.getData().features).toHaveLength(0);
    expect(scene.edits).toContain('cancelFeature');
    expect(scene.mode.getClickSequence()).toEqual([]);
    expect(scene.original.state.isDraggingWithPrimaryButton).toBe(false);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.cleanup();
  }
});

test.each([1, 2])('native button %i drag leaves map gestures available', async button => {
  const scene = await createGestureScene();
  try {
    const before = scene.deck.getViewports()[0].target;
    const receivedMoves: unknown[] = [];
    // This listener runs after the editable layer and receives uncancelled map gestures.
    (scene.deck as any).eventManager.on('panmove', event => receivedMoves.push(event), {
      priority: 0
    });
    await scene.sendPointer('pointerdown', 30, 30, 'mouse', button);
    await scene.sendPointer('pointermove', 70, 30, 'mouse', button);
    await scene.replace();
    await scene.sendPointer('pointermove', 180, 30, 'mouse', button);
    await scene.sendPointer('pointermove', 180, 180, 'mouse', button);
    await scene.sendPointer('pointerup', 30, 180, 'mouse', button);
    expect(scene.getData().features).toHaveLength(0);
    expect(scene.edits).toEqual([]);
    expect(receivedMoves.length).toBeGreaterThan(0);
    if (button === 1) {
      expect(scene.deck.getViewports()[0].target).not.toEqual(before);
    }
    const contextMenu = new MouseEvent('contextmenu', {button: 2, bubbles: true, cancelable: true});
    scene.parent.querySelector('canvas')!.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.cleanup();
  }
});
