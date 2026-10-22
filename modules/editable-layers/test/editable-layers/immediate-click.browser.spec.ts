import {expect, test} from 'vitest';
import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawPolygonMode} from '../../src/edit-modes/draw-polygon-mode';

test('real canvas clicks update polygon vertices immediately and double-click finishes once', async () => {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    width: '256px',
    height: '256px',
    marginLeft: '35px',
    marginTop: '70px',
    transform: 'scale(0.8)',
    transformOrigin: 'top left'
  });
  document.body.append(canvas);
  let deck: Deck;
  let data: any = {type: 'FeatureCollection', features: []};
  const actions: any[] = [];
  const makeLayer = () =>
    new EditableGeoJsonLayer({
      id: 'draw-polygon',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data,
      mode: DrawPolygonMode,
      selectedFeatureIndexes: [],
      onEdit: action => {
        actions.push(action);
        data = action.updatedData;
        deck.setProps({layers: [makeLayer()]});
      }
    });
  try {
    await new Promise<void>((resolve, reject) => {
      deck = new Deck({
        canvas,
        width: 256,
        height: 256,
        views: new OrthographicView(),
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers: [makeLayer()],
        onAfterRender: () => resolve(),
        onError: reject
      });
    });
    const rect = canvas.getBoundingClientRect();
    const points = [
      [40, 40],
      [160, 40],
      [160, 160]
    ];
    for (const [index, [x, y]] of points.entries()) {
      const event = {
        clientX: Math.round(rect.left + x * (rect.width / canvas.offsetWidth)),
        clientY: Math.round(rect.top + y * (rect.height / canvas.offsetHeight)),
        button: 0,
        bubbles: true
      };
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {...event, pointerId: 1, isPrimary: true, buttons: 1})
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {...event, pointerId: 1, isPrimary: true, buttons: 0})
      );
      canvas.dispatchEvent(new MouseEvent('click', {...event, detail: 1}));
      // This assertion runs synchronously, before a double-click timer could fire.
      expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
        index + 1
      );
      const position = actions.at(-1).editContext.position;
      const expected = deck.getViewports()[0].unproject([x, y]);
      expect(position[0]).toBeCloseTo(expected[0]);
      expect(position[1]).toBeCloseTo(expected[1]);
    }
    const end = {
      clientX: Math.round(rect.left + 160 * (rect.width / canvas.offsetWidth)),
      clientY: Math.round(rect.top + 160 * (rect.height / canvas.offsetHeight)),
      button: 0,
      detail: 2,
      bubbles: true
    };
    canvas.dispatchEvent(new MouseEvent('click', end));
    canvas.dispatchEvent(new MouseEvent('dblclick', end));
    expect(actions.filter(action => action.editType === 'addFeature')).toHaveLength(1);
    expect(data.features).toHaveLength(1);
  } finally {
    deck?.finalize();
    canvas.remove();
  }
}, 20000);
