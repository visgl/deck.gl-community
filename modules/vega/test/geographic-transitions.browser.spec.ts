import {expect, it} from 'vitest';
import {parse, type Spec} from 'vega';
import {ViewGl} from '../src';
import spec from '../../../examples/vega/geospatial/spec.json';

it('animates projected polygons and routes on the GPU and survives interrupted clipping changes', async () => {
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
    const layers = (): any[] => deck.layerManager.getLayers();
    const fill = () => layers().find(layer => layer.id === 'LAYER_GEOGRAPHIC_POLYGONS-fill');
    const route = () => layers().find(layer => layer.id === 'LAYER_GEOGRAPHIC_PATHS-1');
    await expect
      .poll(
        () => Boolean(fill()?.getAttributeManager()?.getAttributes().vertexPositions?.getBuffer()),
        {timeout: 15000}
      )
      .toBe(true);
    const readPositions = (layer: any) => {
      const bytes = layer
        .getAttributeManager()
        .getAttributes()
        .vertexPositions.getBuffer()
        .readSyncWebGL();
      return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    };
    await expect
      .poll(
        () =>
          readPositions(route()).some(
            value => Math.abs(value - route().props.data[0].positions[0][0]) < 0.01
          ),
        {timeout: 15000}
      )
      .toBe(true);
    const timeline = fill().context.timeline;
    timeline.pause();
    const start = timeline.getTime();
    const oldFill = readPositions(fill())[0];
    const routeIndex = readPositions(route()).findIndex(
      value => Math.abs(value - route().props.data[0].positions[0][0]) < 0.01
    );
    expect(routeIndex).toBeGreaterThan(0);
    const oldRoute = readPositions(route())[routeIndex];
    const advance = (time: number) => {
      timeline.setTime(time);
      for (const layer of layers()) layer.getAttributeManager()?.attributeTransitionManager.run();
      deck.redraw('geographic transition readback');
    };
    const previousFillData = fill().props.data;
    await view.signal('projectionType', 'equalEarth').runAsync();
    await expect.poll(() => fill().props.data === previousFillData).toBe(false);
    await expect
      .poll(() =>
        Boolean(fill().getAttributeManager().attributeTransitionManager.transitions.vertexPositions)
      )
      .toBe(true);
    advance(start + 500);
    const middleFill = readPositions(fill())[0];
    const middleRoute = readPositions(route())[routeIndex];
    advance(start + 1100);
    const targetFill = readPositions(fill())[0];
    const targetRoute = readPositions(route())[routeIndex];
    expect(targetFill).not.toBeCloseTo(oldFill, 2);
    expect(targetRoute).not.toBeCloseTo(oldRoute, 2);
    expect(middleFill).toBeCloseTo((oldFill + targetFill) / 2, 1);
    expect(middleRoute).toBeCloseTo((oldRoute + targetRoute) / 2, 1);
    const equalEarthData = fill().props.data;
    await view.signal('projectionType', 'orthographic').signal('longitude', 85).runAsync();
    await expect.poll(() => fill().props.data === equalEarthData).toBe(false);
    await expect
      .poll(() =>
        Boolean(fill().getAttributeManager().attributeTransitionManager.transitions.vertexPositions)
      )
      .toBe(true);
    advance(start + 1400);
    expect(Array.from(readPositions(fill())).every(Number.isFinite)).toBe(true);
    const orthographicData = fill().props.data;
    await view.signal('projectionType', 'mercator').signal('longitude', 0).runAsync();
    await expect.poll(() => fill().props.data === orthographicData).toBe(false);
    await expect
      .poll(() =>
        Boolean(fill().getAttributeManager().attributeTransitionManager.transitions.vertexPositions)
      )
      .toBe(true);
    advance(start + 3000);
    expect(readPositions(fill())[0]).toBeCloseTo(oldFill, 2);
    expect(errors).toEqual([]);
    expect(view.presenter.stage.polygonData[0].positions).toHaveLength(2);
    durations.position = 0;
    const previousData = fill().props.data;
    await view.signal('projectionType', 'equalEarth').runAsync();
    await expect.poll(() => fill().props.data === previousData).toBe(false);
    expect(
      fill().getAttributeManager().attributeTransitionManager.hasAttribute('vertexPositions')
    ).toBeFalsy();
    expect(readPositions(fill())[0]).toBeCloseTo(
      view.presenter.stage.polygonData[0].positions[0][0][0],
      2
    );
  } finally {
    view.finalize();
    host.remove();
  }
}, 60000);
