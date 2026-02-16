import {test, expect} from 'vitest';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawPointMode} from '../../src/edit-modes/draw-point-mode';

test('Propagates update triggers to geojson layer', () => {
  const editableLayer = new EditableGeoJsonLayer({
    id: 'test',
    data: null,
    mode: DrawPointMode,
    selectedFeatureIndexes: [],
    updateTriggers: {
      getLineColor: ['lineColor'],
      getFillColor: ['fillColor'],
      getPointRadius: ['radius'],
      getLineWidth: ['width']
    }
  });
  // Avoid the need for deck.gl-initialized state
  editableLayer.createGuidesLayers = () => [];
  editableLayer.createTooltipsLayers = () => [];

  const [geoJsonLayer, ..._rest] = editableLayer.renderLayers();
  const {updateTriggers} = geoJsonLayer.props;
  expect(updateTriggers.getLineColor.flat()).toContain('lineColor');
  expect(updateTriggers.getFillColor.flat()).toContain('fillColor');
  expect(updateTriggers.getPointRadius.flat()).toContain('radius');
  expect(updateTriggers.getLineWidth.flat()).toContain('width');
});
