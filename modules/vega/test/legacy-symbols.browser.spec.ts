import {expect, it} from 'vitest';
import {Presenter} from '../src';
import {createStage} from '../src/defaults';
import type {Polygon} from '../src/interfaces';
it('removes converted legacy squares when polygonData is replaced', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:320px;height:240px';
  document.body.append(host);
  const presenter = new Presenter(host);
  const config = {transitionDurations: {position: 0, size: 0, color: 0, view: 0}};
  const square: Polygon = {
    isSymbol: true,
    ordinal: 0,
    datum: {id: 0},
    positions: [
      [20, -20, 0],
      [40, -20, 0],
      [40, -40, 0],
      [20, -40, 0]
    ],
    fillColor: [255, 0, 0, 255],
    strokeColor: [0, 0, 0, 255],
    strokeWidth: 1,
    depth: 0
  };
  const stage = createStage('2d');
  stage.polygonData = [square];
  try {
    presenter.present(stage, 200, 300, config);
    const symbols = () =>
      (presenter.deckgl.props.layers as any[]).find(layer => layer?.id === 'LAYER_SYMBOLS');
    await expect.poll(() => Boolean(symbols()?.getAttributeManager()), {timeout: 15000}).toBe(true);
    expect(symbols().props.data[0].radius).toBe(10);
    presenter.rePresent({polygonData: []}, config);
    await expect.poll(() => symbols().props.data[0].radius).toBe(0);
    expect(symbols().props.data[0].isEmpty).toBe(true);
    presenter.deckgl.redraw('legacy square removal');
    expect(
      presenter.deckgl.pickObjects({
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        layerIds: ['LAYER_SYMBOLS']
      })
    ).toEqual([]);
  } finally {
    presenter.finalize();
    host.remove();
  }
}, 30000);
