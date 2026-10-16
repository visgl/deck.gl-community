// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {ClickSnappingStrategy} from '../../../src/edit-modes/snapping/click-snapping-strategy';
import {DragSnappingStrategy} from '../../../src/edit-modes/snapping/drag-snapping-strategy';
import {createFeatureCollectionProps} from '../test-utils';

test.each([
  new ClickSnappingStrategy(),
  new DragSnappingStrategy()
])('public strategy guide lookup tolerates null mode configuration: %s', strategy => {
  const props = createFeatureCollectionProps();
  props.modeConfig = null;
  props.lastPointerMoveEvent.pointerDownPicks = [
    {
      index: 0,
      isGuide: true,
      object: {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [0, 0]},
        properties: {
          guideType: 'editHandle',
          editHandleType: 'existing',
          featureIndex: 0,
          positionIndexes: []
        }
      }
    }
  ];
  expect(strategy.getSnapGuides(props)).toEqual({type: 'FeatureCollection', features: []});
});
