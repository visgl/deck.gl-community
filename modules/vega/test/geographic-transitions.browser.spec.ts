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
    const outline = () => layers().find(layer => layer.id === 'LAYER_GEOGRAPHIC_POLYGONS-stroke');
    const readStyle = (layer: any, name: string) => {
      const attribute = layer.getAttributeManager().getAttributes()[name];
      const accessor = attribute.getAccessor();
      const bytes = attribute.getBuffer().readSyncWebGL();
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const offset = (accessor.offset || 0) + attribute.byteOffset;
      return accessor.type === 'float32'
        ? data.getFloat32(offset, true) * (accessor.normalized ? 255 : 1)
        : data.getUint8(offset);
    };
    const timeline = fill().context.timeline;
    timeline.pause();
    const start = timeline.getTime();
    const oldFill = readPositions(fill())[0];
    const outlineIndex = readPositions(outline()).findIndex(
      value => Math.abs(value - oldFill) < 0.01
    );
    expect(outlineIndex).toBeGreaterThan(0);
    const oldOutline = readPositions(outline())[outlineIndex];
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
    await expect
      .poll(() =>
        Boolean(
          outline().getAttributeManager().attributeTransitionManager.transitions.vertexPositions
        )
      )
      .toBe(true);
    advance(start + 500);
    const middleOutline = readPositions(outline())[outlineIndex];
    const middleFill = readPositions(fill())[0];
    const middleRoute = readPositions(route())[routeIndex];
    advance(start + 1100);
    const targetFill = readPositions(fill())[0];
    const targetOutline = readPositions(outline())[outlineIndex];
    expect(targetOutline).not.toBeCloseTo(oldOutline, 2);
    expect(middleOutline).toBeCloseTo((oldOutline + targetOutline) / 2, 1);
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
    expect(Array.from(readPositions(outline())).every(Number.isFinite)).toBe(true);
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
    expect(readPositions(outline())[outlineIndex]).toBeCloseTo(oldOutline, 2);
    expect(errors).toEqual([]);
    expect(view.presenter.stage.polygonData[0].positions).toHaveLength(2);
    durations.position = 0;
    const previousData = fill().props.data;
    await view.signal('projectionType', 'equalEarth').runAsync();
    await expect.poll(() => fill().props.data === previousData).toBe(false);
    expect(
      fill().getAttributeManager().attributeTransitionManager.hasAttribute('vertexPositions')
    ).toBeFalsy();
    expect(
      outline().getAttributeManager().attributeTransitionManager.hasAttribute('vertexPositions')
    ).toBeFalsy();
    expect(
      readPositions(outline()).some(
        value => Math.abs(value - view.presenter.stage.polygonData[0].positions[0][0][0]) < 0.01
      )
    ).toBe(true);
    expect(readPositions(fill())[0]).toBeCloseTo(
      view.presenter.stage.polygonData[0].positions[0][0][0],
      2
    );
    const styleLayers = () => [fill(), outline(), outline(), route(), route()];
    const attributes = [
      'fillColors',
      'instanceColors',
      'instanceStrokeWidths',
      'instanceColors',
      'instanceStrokeWidths'
    ];
    const readStyles = () => styleLayers().map((layer, i) => readStyle(layer, attributes[i]));
    const originalStyles = readStyles();
    const replaceStyles = (
      fillRed: number,
      outlineRed: number,
      polygonWidth: number,
      routeRed: number,
      routeWidth: number
    ) => {
      const geographicData = view.presenter.stage.geographicData.map(mark =>
        mark.type === 'polygon'
          ? {
              type: 'polygon' as const,
              data: {
                ...mark.data,
                fillColor: [fillRed, 90, 155, 255] as [number, number, number, number],
                strokeColor: [outlineRed, 70, 30, 255] as [number, number, number, number],
                strokeWidth: polygonWidth
              }
            }
          : {
              type: 'path' as const,
              data: {
                ...mark.data,
                strokeColor: [routeRed, 140, 45, 255] as [number, number, number, number],
                strokeWidth: routeWidth
              }
            }
      );
      view.presenter.rePresent({geographicData}, {transitionDurations: durations});
    };
    const styleStart = timeline.getTime();
    replaceStyles(35, 210, 6, 230, 10);
    await expect.poll(() => fill().props.data[0].fillColor[0]).toBe(35);
    const targets = [35, 210, 6, 230, 10];
    advance(styleStart + 500);
    readStyles().forEach((value, i) =>
      expect(value).toBeCloseTo((originalStyles[i] + targets[i]) / 2, 1)
    );
    advance(styleStart + 1100);
    readStyles().forEach((value, i) => expect(value).toBeCloseTo(targets[i], 2));
    durations.color = 0;
    durations.size = 0;
    replaceStyles(80, 40, 3, 110, 1);
    await expect.poll(() => fill().props.data[0].fillColor[0]).toBe(80);
    readStyles().forEach((value, i) => expect(value).toBeCloseTo([80, 40, 3, 110, 1][i], 2));
    styleLayers().forEach((layer, i) =>
      expect(
        layer.getAttributeManager().attributeTransitionManager.hasAttribute(attributes[i])
      ).toBeFalsy()
    );
    expect(errors).toEqual([]);
  } finally {
    view.finalize();
    host.remove();
  }
}, 60000);
