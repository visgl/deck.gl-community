import {expect, it} from 'vitest';
import {parse, type Spec} from 'vega';
import {ViewGl} from '../src';
import spec from '../../../examples/vega/geospatial/spec.json';

it('morphs one GPU glyph per record, keeps exits stationary and preserves geographic paint order', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:720px;height:400px';
  document.body.append(host);
  const errors: Error[] = [];
  const durations = {position: 1000, size: 1000, color: 1000, view: 0};
  const view = new ViewGl(parse(spec as unknown as Spec), {
    presenterConfig: {
      transitionDurations: durations,
      preStage: (_, props) => {
        props.onError = error => errors.push(error);
      }
    }
  });
  try {
    view.renderer('deck.gl').initialize(host);
    await view.runAsync();
    const deck = view.presenter.deckgl;
    await expect.poll(() => Boolean(deck?.isInitialized), {timeout: 15000}).toBe(true);
    const layer = (id: string): any => (deck.props.layers as any[]).find(l => l?.id === id);
    const symbols = () => layer('LAYER_SYMBOLS');
    await expect
      .poll(
        () => {
          deck.redraw('geographic picking');
          return deck
            .pickObjects({
              x: 0,
              y: 0,
              width: 720,
              height: 400,
              layerIds: ['LAYER_GEOGRAPHIC_POLYGONS']
            })
            .some(p => p.layer.id === 'LAYER_GEOGRAPHIC_POLYGONS');
        },
        {timeout: 15000}
      )
      .toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const timeline = symbols().context.timeline;
    timeline.pause();
    const read = (name: string, index = 0) => {
      const attribute = symbols().getAttributeManager().getAttributes()[name];
      const bytes = attribute.getBuffer().readSyncWebGL();
      const values =
        attribute.value instanceof Uint8Array
          ? bytes
          : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      return values[index];
    };
    const advance = (time: number) => {
      timeline.setTime(time);
      symbols().getAttributeManager().attributeTransitionManager.run();
      deck.redraw('GPU glyph readback');
    };
    const waitTransition = async (name: string) => {
      await expect
        .poll(() => symbols()?.getAttributeManager()?.attributeTransitionManager.hasAttribute(name))
        .toBe(true);
    };
    const initial = [...symbols().props.data[0].position];
    await view.signal('longitude', 25).runAsync();
    await expect.poll(() => symbols().props.data[0].position).not.toEqual(initial);
    await waitTransition('instancePositions');
    advance(timeline.getTime() + 1100);
    const movedX = read('instancePositions');
    await view.signal('shape', 'square').runAsync();
    await expect.poll(() => symbols().props.data[0].shape).toBe('square');
    await waitTransition('instanceShapes');
    const morphStart = timeline.getTime();
    advance(morphStart + 400);
    expect(read('instanceShapes')).toBeGreaterThan(0);
    expect(read('instanceShapes')).toBeLessThan(1);
    expect(read('instancePositions')).toBeCloseTo(movedX, 3);
    expect(symbols().props.data).toHaveLength(6);
    const shifted = symbols().props.data.map((item: any) => ({
      ...item,
      position: [item.position[0] + 20, item.position[1], item.position[2]]
    }));
    view.presenter.rePresent(
      {symbolData: shifted},
      {transitionDurations: {...durations, position: 0}}
    );
    await expect.poll(() => symbols().props.data[0].position[0]).toBeCloseTo(movedX + 20, 3);
    await expect.poll(() => Boolean(symbols()?.getAttributeManager())).toBe(true);
    advance(morphStart + 1500);
    expect(read('instancePositions')).toBeCloseTo(movedX + 20, 3);
    expect(read('instanceShapes')).toBeCloseTo(1);
    expect(symbols().props.data).toHaveLength(6);

    const geographicIds = () =>
      (deck.props.layers as any[])
        .filter(l => l?.id?.startsWith('LAYER_GEOGRAPHIC'))
        .map(l => l.id);
    const order = geographicIds();
    const polygons = view.presenter.stage.polygonData.map(p =>
      p.isGeographic
        ? {...p, fillColor: [20, 180, 100, 255] as [number, number, number, number]}
        : p
    );
    view.presenter.rePresent({polygonData: polygons}, {transitionDurations: durations});
    await expect
      .poll(() => layer('LAYER_GEOGRAPHIC_POLYGONS').props.data[0].fillColor)
      .toEqual([20, 180, 100, 255]);
    expect(geographicIds()).toEqual(order);
    expect(order).toEqual([
      'LAYER_GEOGRAPHIC_PATHS',
      'LAYER_GEOGRAPHIC_POLYGONS',
      'LAYER_GEOGRAPHIC_PATHS-1'
    ]);

    await view.signal('count', 1).runAsync();
    await expect.poll(() => symbols().props.data[1].radius).toBe(0);
    await waitTransition('instanceRadius');
    const exitPosition = [...symbols().props.data[1].position];
    const exitStart = timeline.getTime();
    advance(exitStart + 400);
    const radius = read('instanceRadius', 1);
    expect(radius).toBeGreaterThan(0);
    expect(radius).toBeLessThan(Math.sqrt(160) / 2);
    expect(read('instanceFillColors', 7)).toBeGreaterThan(0);
    await view.signal('longitude', -25).signal('count', 0).runAsync();
    await expect.poll(() => symbols().props.data.every((item: any) => item.isEmpty)).toBe(true);
    expect(symbols().props.data[1].position).toEqual(exitPosition);
    await expect.poll(() => Boolean(symbols()?.getAttributeManager())).toBe(true);
    advance(exitStart + 400);
    expect(read('instanceRadius', 1)).toBeCloseTo(radius, 2);
    advance(exitStart + 1500);
    expect(read('instanceRadius', 1)).toBeCloseTo(0);
    expect(read('instanceFillColors', 7)).toBeCloseTo(0);
    await view.signal('count', 6).signal('reverse', true).signal('angle', 45).runAsync();
    await expect.poll(() => symbols().props.data[0]?.datum?.id).toBe(0);
    expect(symbols().props.data.map((item: any) => item.datum.id)).toEqual([0, 1, 2, 3, 4, 5]);
    await waitTransition('instanceRadius');
    const reentry = timeline.getTime();
    advance(reentry + 400);
    expect(read('instanceRadius')).toBeGreaterThan(0);
    expect(read('instanceAngles')).toBeLessThan(0);
    advance(reentry + 1100);
    expect(read('instanceRadius')).toBeCloseTo(Math.sqrt(160) / 2);
    expect(errors).toEqual([]);
  } finally {
    view.finalize();
    host.remove();
  }
}, 60000);
