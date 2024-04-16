import {describe, test, expect} from 'vitest';
import ElevatedEditHandleLayer from '../../../src/editable-layers/elevated-edit-handle-layer';

describe('ElevatedEditHandleLayer tests', () => {
  test('renderLayers()', () => {
    const layer = new ElevatedEditHandleLayer();
    const render = layer.renderLayers();
    expect(Array.isArray(render)).toBeTruthy();
    expect(render.length).toBe(2);
  });
});
