// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test} from 'vitest';
import {GeoJsonEditMode} from '../../../src/edit-modes/geojson-edit-mode';
import {CompositeMode} from '../../../src/edit-modes/composite-mode';
import {DrawLineStringMode} from '../../../src/edit-modes/draw-line-string-mode';
import {DrawPolygonByDraggingMode} from '../../../src/edit-modes/draw-polygon-by-dragging-mode';
import {DrawPolygonMode} from '../../../src/edit-modes/draw-polygon-mode';
import {DrawRectangleMode} from '../../../src/edit-modes/draw-rectangle-mode';
import {DuplicateMode} from '../../../src/edit-modes/duplicate-mode';
import {ExtrudeMode} from '../../../src/edit-modes/extrude-mode';
import {MeasureDistanceMode} from '../../../src/edit-modes/measure-distance-mode';
import {ModifyMode} from '../../../src/edit-modes/modify-mode';
import {ResizeCircleMode} from '../../../src/edit-modes/resize-circle-mode';
import {RotateMode} from '../../../src/edit-modes/rotate-mode';
import {ScaleMode} from '../../../src/edit-modes/scale-mode';
import {SnappableMode} from '../../../src/edit-modes/snappable-mode';
import {TransformMode} from '../../../src/edit-modes/transform-mode';
import {TranslateMode} from '../../../src/edit-modes/translate-mode';
import {Pick} from '../../../src/edit-modes/types';
import {createClickEvent, createFeatureCollectionProps} from '../test-utils';

const handle = (editHandleType = 'existing'): Pick => ({
  index: 0,
  isGuide: true,
  featureType: 'points',
  object: {
    type: 'Feature',
    properties: {guideType: 'editHandle', editHandleType, featureIndex: 0, positionIndexes: [0]},
    geometry: {type: 'Point', coordinates: [0, 0]}
  }
});
const tentativeLine: Pick = {
  index: 0,
  isGuide: true,
  featureType: 'linestrings',
  object: {type: 'Feature', properties: {guideType: 'tentative'}, geometry: null}
};
const feature = (index: number, featureType = 'polygons'): Pick => ({
  index,
  isGuide: false,
  featureType,
  object: {}
});

const press = (mode: GeoJsonEditMode, picks: Pick[], overrides = {}) =>
  mode.ownsPointerDown(createClickEvent([0, 0], picks), createFeatureCollectionProps(overrides));

test.each([
  ['DrawPolygonMode on the map', new DrawPolygonMode(), [], {}, false],
  ['DrawPolygonMode on its tentative line', new DrawPolygonMode(), [tentativeLine], {}, false],
  ['DrawPolygonMode on a feature', new DrawPolygonMode(), [feature(0)], {}, false],
  ['DrawPolygonMode on a vertex handle', new DrawPolygonMode(), [handle()], {}, true],
  ['DrawLineStringMode on the map', new DrawLineStringMode(), [], {}, false],
  ['MeasureDistanceMode on the map', new MeasureDistanceMode(), [], {}, false],
  ['click-to-draw DrawRectangleMode', new DrawRectangleMode(), [], {}, false],
  [
    'drag-to-draw DrawRectangleMode',
    new DrawRectangleMode(),
    [],
    {modeConfig: {dragToDraw: true}},
    true
  ],
  ['DrawPolygonByDraggingMode on the map', new DrawPolygonByDraggingMode(), [], {}, true],
  ['ModifyMode on the map', new ModifyMode(), [], {selectedIndexes: [0]}, false],
  ['ModifyMode on a line', new ModifyMode(), [feature(0, 'linestrings')], {}, false],
  ['ModifyMode on a point', new ModifyMode(), [feature(0, 'points')], {}, true],
  ['ModifyMode on an edit handle', new ModifyMode(), [handle('intermediate')], {}, true],
  ['ExtrudeMode on an edit handle', new ExtrudeMode(), [handle('intermediate')], {}, true],
  [
    'TranslateMode on the selection',
    new TranslateMode(),
    [feature(0)],
    {selectedIndexes: [0]},
    true
  ],
  [
    'TranslateMode on another feature',
    new TranslateMode(),
    [feature(1)],
    {selectedIndexes: [0]},
    false
  ],
  [
    'DuplicateMode on the selection',
    new DuplicateMode(),
    [feature(0)],
    {selectedIndexes: [0]},
    true
  ],
  ['ScaleMode on a scale handle', new ScaleMode(), [handle('scale')], {selectedIndexes: [0]}, true],
  ['ScaleMode on the selection', new ScaleMode(), [feature(0)], {selectedIndexes: [0]}, false],
  ['RotateMode on the rotate handle', new RotateMode(), [handle('rotate')], {}, true],
  ['RotateMode on the map', new RotateMode(), [], {}, false],
  [
    'ResizeCircleMode on an edit handle',
    new ResizeCircleMode(),
    [handle('intermediate')],
    {},
    true
  ],
  ['ResizeCircleMode on the map', new ResizeCircleMode(), [], {}, false],
  ['TransformMode on any feature', new TransformMode(), [feature(1)], {selectedIndexes: [0]}, true],
  ['TransformMode on the map', new TransformMode(), [], {selectedIndexes: [0]}, false],
  [
    'snapping TranslateMode on the selection',
    new SnappableMode(new TranslateMode()),
    [feature(0)],
    {selectedIndexes: [0], modeConfig: {enableSnapping: true}},
    true
  ],
  [
    'snapping TranslateMode on the map',
    new SnappableMode(new TranslateMode()),
    [],
    {selectedIndexes: [0], modeConfig: {enableSnapping: true}},
    false
  ],
  [
    'CompositeMode on a handle',
    new CompositeMode([new DrawLineStringMode(), new ModifyMode()]),
    [handle()],
    {},
    true
  ],
  [
    'CompositeMode on the map',
    new CompositeMode([new DrawLineStringMode(), new ModifyMode()]),
    [],
    {},
    false
  ]
])('%s owns the press: %#', (_name, mode, picks, overrides, owned) => {
  expect(press(mode, picks, overrides)).toBe(owned);
});

test('custom modes that handle drags keep owning every press', () => {
  class CustomDragMode extends GeoJsonEditMode {
    handleDragging() {}
  }
  class CustomPolygonDragMode extends DrawPolygonMode {
    handleStartDragging() {}
  }
  class CustomClickMode extends GeoJsonEditMode {
    handleClick() {}
  }
  class CustomModifyMode extends ModifyMode {
    handleDragging() {}
  }
  expect(press(new CustomDragMode(), [])).toBe(true);
  expect(press(new CustomPolygonDragMode(), [])).toBe(true);
  // Modes without drag handlers, or inheriting a built-in rule, leave the map its presses.
  expect(press(new CustomClickMode(), [])).toBe(false);
  expect(press(new CustomClickMode(), [handle()])).toBe(true);
  expect(press(new CustomModifyMode(), [])).toBe(false);
  expect(press(new CustomModifyMode(), [handle()])).toBe(true);
});
