import {expect, it} from 'vitest';
import {parse, type Spec} from 'vega';
import {ViewGl, base} from '../src/index';
import {createExample} from '../demo/example';

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
    await expect.poll(() => view.presenter.getCubeData()[0]?.position[0]).toBe(50);
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
    const select = host.querySelector('select');
    select.value = 'scatter';
    select.dispatchEvent(new Event('change'));
    await expect
      .poll(() => {
        const layer = example.view.presenter.deckgl.props.layers.find(
          (entry: any) => entry.id === 'LAYER_CUBES'
        ) as any;
        return (
          layer
            ?.getAttributeManager()
            .attributeTransitionManager?.hasAttribute('instancePositions') &&
          layer.getAttributeManager().attributeTransitionManager.hasAttribute('instanceSizes')
        );
      })
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
