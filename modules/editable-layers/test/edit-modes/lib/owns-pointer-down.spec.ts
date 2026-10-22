// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test} from 'vitest';
import {GeoJsonEditMode, isPointerDownOwned} from '../../../src/edit-modes/geojson-edit-mode';
import {DrawPolygonByDraggingMode} from '../../../src/edit-modes/draw-polygon-by-dragging-mode';
import {DrawPolygonMode} from '../../../src/edit-modes/draw-polygon-mode';
import {DrawRectangleMode} from '../../../src/edit-modes/draw-rectangle-mode';
import {ModifyMode} from '../../../src/edit-modes/modify-mode';
import {ScaleMode} from '../../../src/edit-modes/scale-mode';
import {SnappableMode} from '../../../src/edit-modes/snappable-mode';
import {TransformMode} from '../../../src/edit-modes/transform-mode';
import {TranslateMode} from '../../../src/edit-modes/translate-mode';
import {createClickEvent, createFeatureCollectionProps} from '../test-utils';

const HANDLE = {
  index: 0,
  isGuide: true,
  featureType: 'points',
  object: {properties: {guideType: 'editHandle', editHandleType: 'existing', featureIndex: 0}}
};
const TENTATIVE = {index: 0, isGuide: true, object: {properties: {guideType: 'tentative'}}};
const SELECTED = {index: 0, isGuide: false, featureType: 'polygons', object: {}};
const OTHER = {index: 1, isGuide: false, featureType: 'polygons', object: {}};

const owns = (mode: GeoJsonEditMode, picks: any[], props = {}) =>
  isPointerDownOwned(
    mode,
    () => createClickEvent([0, 0], picks),
    createFeatureCollectionProps({selectedIndexes: [0], ...props})
  );

test.each([
  ['DrawPolygonMode', new DrawPolygonMode(), [[], [TENTATIVE], [SELECTED]], [[HANDLE]]],
  ['DrawRectangleMode', new DrawRectangleMode(), [[]], [[HANDLE]]],
  ['ModifyMode', new ModifyMode(), [[], [SELECTED]], [[HANDLE]]],
  ['ScaleMode', new ScaleMode(), [[], [SELECTED]], [[HANDLE]]],
  ['TranslateMode', new TranslateMode(), [[], [OTHER]], [[SELECTED]]],
  ['SnappableMode(TranslateMode)', new SnappableMode(new TranslateMode()), [[OTHER]], [[SELECTED]]],
  ['TransformMode', new TransformMode(), [[], [OTHER]], [[SELECTED], [HANDLE]]],
  ['DrawPolygonByDraggingMode', new DrawPolygonByDraggingMode(), [], [[]]]
])('%s owns only the presses it drags or handles', (_name, mode, mapPicks, editPicks) => {
  for (const picks of mapPicks) expect(owns(mode, picks)).toBe(false);
  for (const picks of editPicks) expect(owns(mode, picks)).toBe(true);
});

test('drag-to-draw modes and modes with undeclared drag handlers own every press', () => {
  expect(owns(new DrawRectangleMode(), [], {modeConfig: {dragToDraw: true}})).toBe(true);
  class CustomDragMode extends GeoJsonEditMode {
    handleDragging() {}
  }
  class DragBodyModifyMode extends ModifyMode {
    handleStartDragging() {}
  }
  class CustomClickMode extends GeoJsonEditMode {
    handleClick() {}
  }
  expect(owns(new CustomDragMode(), [])).toBe(true);
  expect(owns(new DragBodyModifyMode(), [])).toBe(true);
  expect(owns(new CustomClickMode(), [])).toBe(false);
  expect(owns({handleClick() {}} as any, [])).toBe(true);
});
