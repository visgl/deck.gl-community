import {describe, it, expect, vi} from 'vitest';
import {DeleteMode} from '../../../src/edit-modes/delete-mode';
import {ClickEvent, ModeProps} from '../../../src/edit-modes/types';
import {FeatureCollection} from '../../../src/utils/geojson-types';

describe('DeleteMode', () => {
  it('should not call onEdit when no features are selected', () => {
    const deleteMode = new DeleteMode();
    const props: ModeProps<FeatureCollection> = {
      data: {type: 'FeatureCollection', features: []},
      selectedIndexes: [],
      lastPointerMoveEvent: {picks: []},
      onEdit: vi.fn()
    };

    deleteMode.handleClick({} as ClickEvent, props);

    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('should call onEdit with correct parameters when one feature is selected', () => {
    const deleteMode = new DeleteMode();
    const props: ModeProps<FeatureCollection> = {
      data: {
        type: 'FeatureCollection',
        features: [
          {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}}
        ]
      },
      selectedIndexes: [],
      lastPointerMoveEvent: {picks: [{index: 0}]},
      onEdit: vi.fn()
    };

    deleteMode.handleClick({} as ClickEvent, props);

    expect(props.onEdit).toHaveBeenCalledWith({
      updatedData: {type: 'FeatureCollection', features: []},
      editType: 'deleteFeature',
      editContext: {featureIndexes: [0]}
    });
  });

  it('should call onEdit with correct parameters when multiple features are selected', () => {
    const deleteMode = new DeleteMode();
    const props: ModeProps<FeatureCollection> = {
      data: {
        type: 'FeatureCollection',
        features: [
          {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}},
          {type: 'Feature', geometry: {type: 'Point', coordinates: [1, 1]}, properties: {}}
        ]
      },
      selectedIndexes: [],
      lastPointerMoveEvent: {picks: [{index: 0}, {index: 1}]},
      onEdit: vi.fn()
    };

    deleteMode.handleClick({} as ClickEvent, props);

    expect(props.onEdit).toHaveBeenCalledWith({
      updatedData: {
        type: 'FeatureCollection',
        features: [
          {type: 'Feature', geometry: {type: 'Point', coordinates: [1, 1]}, properties: {}}
        ]
      },
      editType: 'deleteFeature',
      editContext: {featureIndexes: [0, 1]}
    });
  });
});
