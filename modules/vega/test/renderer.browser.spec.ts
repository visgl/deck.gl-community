import {expect, it, vi} from 'vitest';
import {Presenter} from '../src/presenter';
import {outerSize} from '../src/html-helpers';
import {getLayers} from '../src/layers';
import {createStage, defaultPresenterConfig} from '../src/defaults';
import {parse, type Spec} from 'vega';
import {ViewGl, base} from '../src/index';
import {createExample} from '../demo/example';
import {createVegaView} from '../../../examples/vega/create-vega-view';

it.each([
  '2d',
  '3d'
] as const)('renders, updates and picks %s cuboids, then releases the canvas', async viewMode => {
  const host = document.createElement('div');
  host.style.cssText = 'width:320px;height:240px;position:relative';
  document.body.appendChild(host);
  const spec: Spec = {
    width: 200,
    height: 160,
    padding: 0,
    data: [{name: 'table', values: [{x: 20, height: 100}]}],
    marks: [
      {
        type: 'rect',
        from: {data: 'table'},
        encode: {
          update: {
            x: {field: 'x'},
            y: {value: 10},
            width: {value: 80},
            height: {field: 'height'},
            fill: {value: '#ff0000'}
          }
        }
      }
    ]
  };
  expect(base.deck.VERSION).toMatch(/^9\.4\./);
  Object.assign(spec.marks[0].encode.update, {depth: {value: 24}, z: {value: 3}});
  const errors: Error[] = [];
  const view = new ViewGl(parse(spec), {
    getView: () => viewMode,
    presenterConfig: {
      transitionDurations: {color: 0, position: 0, size: 0, view: 0},
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
    await expect
      .poll(
        () => {
          deck.redraw(true);
          const cubeLayer = deck.props.layers.find(
            (layer: any) => layer?.id === 'LAYER_CUBES'
          ) as any;
          const pipeline = cubeLayer?.getModels()[0]?.pipeline;
          if (pipeline?.linkStatus === 'error') {
            const gl = (deck.device as any).gl;
            throw new Error(
              `${gl.getShaderInfoLog(pipeline.vs.handle)}\n${gl.getShaderSource(pipeline.vs.handle)}`
            );
          }
          return pipeline?.linkStatus;
        },
        {timeout: 10000}
      )
      .toBe('success');
    expect(host.querySelector('canvas')).not.toBeNull();
    expect(await view.presenter.canvasToDataURL()).toMatch(/^data:image\/png/);
    const picks = deck.pickObjects({x: 0, y: 0, width: 320, height: 240});
    expect(picks.some(pick => pick.object?.ordinal === 0)).toBe(true);
    view.change(
      'table',
      (await import('vega'))
        .changeset()
        .remove(() => true)
        .insert({x: 50, height: 60})
    );
    await view.runAsync();
    await expect
      .poll(() => view.presenter.getCubeData().find(cube => !cube.isEmpty)?.position[0])
      .toBe(50);
    deck.redraw(true);
    expect(errors).toEqual([]);
  } finally {
    view.finalize();
    expect(host.querySelector('canvas')).toBeNull();
    host.remove();
  }
}, 20000);

it('animates positions and sizes when the example changes layout', async () => {
  const host = document.createElement('div');
  host.style.width = '700px';
  document.body.appendChild(host);
  const example = createExample(host);
  try {
    await expect
      .poll(() => example.view.presenter.deckgl?.isInitialized, {timeout: 15000})
      .toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    // Keep the transition active while assertions run, even on a busy CI host.
    const cubeLayer = example.view.presenter.deckgl.props.layers.find(
      (entry: any) => entry.id === 'LAYER_CUBES'
    ) as any;
    cubeLayer.context.timeline.pause();
    const select = host.querySelector('select');
    select.value = 'scatter';
    select.dispatchEvent(new Event('change'));
    await expect
      .poll(
        () => {
          const layer = example.view.presenter.deckgl.props.layers.find(
            (entry: any) => entry.id === 'LAYER_CUBES'
          ) as any;
          return (
            layer
              ?.getAttributeManager()
              ?.attributeTransitionManager?.hasAttribute('instancePositions') &&
            layer.getAttributeManager().attributeTransitionManager.hasAttribute('instanceSizes')
          );
        },
        {timeout: 10000}
      )
      .toBe(true);
    const cubes = example.view.presenter.getCubeData();
    expect(cubes).toHaveLength(180);
    expect(cubes[10].ordinal).toBe(10);
    expect(cubes[10].size[0]).toBe(9);
    const toggle = host.querySelector('input');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await expect.poll(() => example.view.presenter.getCubeData()[10].size[2]).toBe(12.05);
    expect(example.view.presenter.stage.view).toBe('3d');
  } finally {
    example.finalize();
    host.remove();
  }
}, 60000);

it('cancels only pending animation callbacks and clears finished timers', () => {
  vi.useFakeTimers();
  const presenter = Object.create(Presenter.prototype) as Presenter;
  const canceled = vi.fn();
  const handler = vi.fn();
  try {
    presenter.animationQueue(handler, 100, {animationCanceled: canceled});
    presenter.animationQueue(handler, 100, {animationCanceled: canceled});
    expect(canceled).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);
    presenter.animationCancel();
    expect(canceled).toHaveBeenCalledTimes(1);
    presenter.animationQueue(handler, 100, {animationCanceled: canceled});
    presenter.animationCancel();
    expect(canceled).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it('counts padding and borders once when measuring outer size', () => {
  const el = document.createElement('div');
  el.style.cssText =
    'width:100px;height:50px;padding:10px;border:2px solid;margin:3px;box-sizing:content-box';
  document.body.appendChild(el);
  try {
    expect(outerSize(el)).toEqual({width: 130, height: 80});
  } finally {
    el.remove();
  }
});

it('forwards text alpha cutoff to the glyph sublayer', () => {
  const presenter = {style: {highlightColor: [0, 0, 0, 0]}} as Presenter;
  const layers = getLayers(
    presenter,
    {...defaultPresenterConfig, getTextHighlightAlphaCutoff: () => 0.4},
    createStage('2d'),
    null,
    0,
    null,
    []
  );
  const textLayer = layers.find(layer => layer.constructor.layerName === 'TextLayer');
  expect(textLayer.props._subLayerProps.characters.alphaCutoff).toBe(0.4);
});

it('keeps duplicate IDs and shared records distinct across rectangle marks', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:320px;height:240px;position:relative';
  document.body.appendChild(host);
  const spec: Spec = {
    width: 200,
    height: 160,
    data: [
      {
        name: 'table',
        values: [
          {id: 0, x: 20},
          {id: 0, x: 100}
        ]
      }
    ],
    marks: ['#ff0000', '#0000ff'].map((fill, index) => ({
      type: 'rect' as const,
      from: {data: 'table'},
      encode: {
        update: {
          x: {field: 'x'},
          y: {value: index * 70},
          width: {value: 40},
          height: {value: 40},
          fill: {value: fill}
        }
      }
    }))
  };
  const example = createVegaView(host, spec);
  try {
    await example.ready;
    const getCubes = () =>
      (example.view.presenter.getCubeData() ?? []).filter(cube => !cube.isEmpty);
    await expect.poll(() => getCubes().length, {timeout: 15000}).toBe(4);
    expect(new Set(getCubes().map(cube => cube.ordinal)).size).toBe(4);
    const positions = getCubes().map(cube => [...cube.position]);
    example.view.change(
      'table',
      (await import('vega')).changeset().modify(() => true, 'x', 50)
    );
    await example.view.runAsync();
    expect(getCubes().map(cube => cube.ordinal)).toEqual([0, 1, 2, 3]);
    expect(getCubes().map(cube => cube.position[1])).toEqual(
      positions.map(position => position[1])
    );
    await expect.poll(() => getCubes().every(cube => cube.position[0] === 50)).toBe(true);
  } finally {
    example.finalize();
    host.remove();
  }
}, 30000);
