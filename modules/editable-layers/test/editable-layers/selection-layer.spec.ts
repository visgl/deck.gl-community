import {expect, test, vi} from 'vitest';
import {SelectionLayer} from '../../src/editable-layers/selection-layer';

test('rectangle selection excludes guides and deduplicates feature picks', () => {
  const onSelect = vi.fn();
  const feature = {layer: {id: 'features'}, index: 0, object: {type: 'Feature'}};
  const layer = new SelectionLayer({id: 'selection', layerIds: ['features'], onSelect});
  layer.context = {
    viewport: {project: coordinates => coordinates},
    deck: {
      pickObjects: vi.fn(() => [
        feature,
        {layer: feature.layer, index: 3, isGuide: true},
        {layer: feature.layer, index: 7, object: {properties: {guideType: 'editHandle'}}},
        {...feature}
      ])
    }
  } as any;
  layer._selectRectangleObjects([
    [
      [10, 20],
      [10, 40],
      [30, 40],
      [30, 20],
      [10, 20]
    ]
  ]);
  expect(onSelect).toHaveBeenCalledWith({pickingInfos: [feature]});
});

test('polygon picking waits for the blocker draw, then completes once without a delay', async () => {
  const onSelect = vi.fn();
  const feature = {layer: {id: 'features'}, index: 0, object: {type: 'Feature'}};
  const layer = new SelectionLayer({
    id: 'selection',
    layerIds: ['features'],
    selectionType: 'polygon',
    onSelect
  });
  layer.state = {} as any;
  vi.spyOn(layer, 'setState').mockImplementation(update => Object.assign(layer.state, update));
  layer.context = {
    viewport: {project: coordinates => coordinates},
    deck: {pickObjects: vi.fn(() => [feature, {layer: {id: 'selection'}, index: 0}])}
  } as any;
  layer._selectPolygonObjects([
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0]
    ]
  ]);
  expect(layer.context.deck.pickObjects).not.toHaveBeenCalled();
  const blocker = layer.renderLayers()[1];
  blocker.props.onRendered();
  blocker.props.onRendered();
  await Promise.resolve();
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith({pickingInfos: [feature]});
  expect(layer.state.pendingPolygonSelection).toBeNull();
});

test('finalizing cancels a queued polygon selection', async () => {
  const onSelect = vi.fn();
  const layer = new SelectionLayer({
    id: 'selection',
    layerIds: [],
    selectionType: 'polygon',
    onSelect
  });
  layer.state = {} as any;
  vi.spyOn(layer, 'setState').mockImplementation(update => Object.assign(layer.state, update));
  layer.context = {viewport: {project: c => c}, deck: {pickObjects: vi.fn()}} as any;
  layer._selectPolygonObjects([
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0]
    ]
  ]);
  layer.renderLayers()[1].props.onRendered();
  layer.finalizeState();
  await Promise.resolve();
  expect(onSelect).not.toHaveBeenCalled();
});
