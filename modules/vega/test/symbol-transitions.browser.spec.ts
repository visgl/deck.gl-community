import {expect, it} from 'vitest';
import {parse, type Spec} from 'vega';
import {ViewGl} from '../src';
import spec from '../../../examples/vega/geospatial/spec.json';

it('renders geoshapes and interpolates circle and square exit buffers on the GPU', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:720px;height:400px';
  document.body.append(host);
  const errors: Error[] = [];
  const view = new ViewGl(parse(spec as unknown as Spec), {
    presenterConfig: {
      transitionDurations: {position: 1000, size: 1000, color: 1000, view: 0},
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
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(layer('LAYER_GEOGRAPHIC_POLYGONS').props.data).toHaveLength(3);
    deck.redraw('geospatial picking');
    expect(
      deck
        .pickObjects({x: 0, y: 0, width: 720, height: 400})
        .some(p => p.layer.id === 'LAYER_GEOGRAPHIC_POLYGONS')
    ).toBe(true);
    const timeline = layer('LAYER_SYMBOLS').context.timeline;
    timeline.pause();
    const read = (l: any, name: string) => {
      const attr = l.getAttributeManager().getAttributes()[name];
      const bytes = attr.getBuffer().readSyncWebGL();
      return attr.value instanceof Uint8Array
        ? bytes
        : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    };
    const advance = (l: any, time: number) => {
      timeline.setTime(time);
      l.getAttributeManager().attributeTransitionManager.run();
      deck.redraw('GPU symbol transitions');
    };
    await view.signal('count', 1).runAsync();
    await expect.poll(() => layer('LAYER_SYMBOLS').props.data[1]?.radius).toBe(0);
    await expect
      .poll(() =>
        layer('LAYER_SYMBOLS')
          ?.getAttributeManager()
          ?.attributeTransitionManager.hasAttribute('instanceRadius')
      )
      .toBe(true);
    const start = timeline.getTime();
    advance(layer('LAYER_SYMBOLS'), start + 400);
    const radius = read(layer('LAYER_SYMBOLS'), 'instanceRadius')[1];
    expect(radius).toBeGreaterThan(0);
    expect(radius).toBeLessThan(Math.sqrt(160 / Math.PI));
    const intermediateAlpha = read(layer('LAYER_SYMBOLS'), 'instanceFillColors')[7];
    expect(intermediateAlpha).toBeGreaterThan(0);
    expect(intermediateAlpha).toBeLessThan(255);
    await view.signal('count', 0).runAsync();
    await expect.poll(() => layer('LAYER_SYMBOLS').props.data[0]?.radius).toBe(0);
    await expect.poll(() => Boolean(layer('LAYER_SYMBOLS')?.getAttributeManager())).toBe(true);
    advance(layer('LAYER_SYMBOLS'), start + 400);
    expect(read(layer('LAYER_SYMBOLS'), 'instanceRadius')[1]).toBeCloseTo(radius, 2);
    advance(layer('LAYER_SYMBOLS'), start + 1500);
    expect(read(layer('LAYER_SYMBOLS'), 'instanceRadius')[1]).toBeCloseTo(0);
    await view.signal('count', 6).signal('shape', 'square').runAsync();
    await expect.poll(() => layer('LAYER_SYMBOL_SQUARES').props.data.length).toBe(6);
    timeline.play();
    await new Promise(resolve => setTimeout(resolve, 1100));
    timeline.pause();
    const squares = () => layer('LAYER_SYMBOL_SQUARES');
    expect(squares()).toBeTruthy();
    await view.signal('count', 0).runAsync();
    await expect
      .poll(() => layer('LAYER_SYMBOL_SQUARES').props.data.every((p: any) => p.datum === undefined))
      .toBe(true);
    await expect
      .poll(() =>
        squares()?.getAttributeManager()?.attributeTransitionManager.hasAttribute('instanceRadius')
      )
      .toBe(true);
    const squareStart = timeline.getTime();
    advance(squares(), squareStart + 400);
    const squareRadius = read(squares(), 'instanceRadius')[0];
    expect(squareRadius).toBeGreaterThan(0);
    expect(squareRadius).toBeLessThan(Math.sqrt(160) / 2);
    advance(squares(), squareStart + 1100);
    expect(read(squares(), 'instanceRadius')[0]).toBeCloseTo(0);
    await view.signal('count', 6).signal('reverse', true).signal('angle', 45).runAsync();
    await expect.poll(() => layer('LAYER_SYMBOL_SQUARES').props.data[0]?.datum?.id).toBe(0);
    expect(layer('LAYER_SYMBOL_SQUARES').props.data.map((p: any) => p.datum.id)).toEqual([
      0, 1, 2, 3, 4, 5
    ]);
    await expect
      .poll(() =>
        squares()?.getAttributeManager()?.attributeTransitionManager.hasAttribute('instanceRadius')
      )
      .toBe(true);
    const reentry = timeline.getTime();
    advance(squares(), reentry + 400);
    expect(read(squares(), 'instanceRadius')[0]).toBeGreaterThan(0);
    expect(read(squares(), 'instanceAngles')[0]).toBeLessThan(0);
    advance(squares(), reentry + 1100);
    expect(read(squares(), 'instanceRadius')[0]).toBeCloseTo(Math.sqrt(160) / 2);
    expect(errors).toEqual([]);
  } finally {
    view.finalize();
    host.remove();
  }
}, 60000);
