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
  const sendPointer = async (type: string, x: number, y: number, pointerType: string) => {
    const rect = canvas.getBoundingClientRect();
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType,
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: rect.left + x,
      clientY: rect.top + y
    });
    (type === 'pointerdown' ? canvas : window).dispatchEvent(event);
    await frame();
  };
  return {
    original,
    mode,
    errors,
    edits,
    sendPointer,
    getData: () => data,
    cleanup: () => {
      deck.finalize();
      parent.remove();
    }
  };
}

test.each([
  ['mouse', 'pointerup', 'addFeature'],
  ['touch', 'pointerup', 'addFeature'],
  ['mouse', 'pointercancel', 'cancelFeature']
])('native %s drag ending with %s survives layer replacement', async (pointerType, end, editType) => {
  const scene = await createGestureScene();
  try {
    await scene.sendPointer('pointerdown', 30, 30, pointerType);
    await scene.sendPointer('pointermove', 70, 30, pointerType);
    await scene.sendPointer('pointermove', 180, 30, pointerType);
    // onEdit replaces the layer, as React does on each tentative edit.
    await expect.poll(() => scene.original.getCurrentLayer()).not.toBe(scene.original);
    await scene.sendPointer('pointermove', 180, 180, pointerType);
    await scene.sendPointer(end, 30, 180, pointerType);
    expect(scene.getData().features).toHaveLength(end === 'pointerup' ? 1 : 0);
    expect(scene.edits.filter(type => type === editType)).toHaveLength(1);
    expect(scene.mode.getClickSequence()).toEqual([]);
    expect(scene.original.state.isDraggingWithPrimaryButton).toBe(false);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.cleanup();
  }
});
