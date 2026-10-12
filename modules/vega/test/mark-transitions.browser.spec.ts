import {expect, it} from 'vitest';
import {parse, changeset, type Spec} from 'vega';
import {ViewGl} from '../src';
import {createStage} from '../src/defaults';

it('renders and picks symbols, and animates exits without losing ordinal identity', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:500px;height:320px';
  document.body.append(host);
  const errors: Error[] = [];
  const spec: Spec = {
    width: 300,
    height: 220,
    padding: 0,
    signals: [
      {name: 'count', value: 3},
      {name: 'shape', value: 'circle'},
      {name: 'reverse', value: false}
    ],
    data: [
      {
        name: 'table',
        values: [
          {id: 0, x: 30},
          {id: 1, x: 100},
          {id: 2, x: 170}
        ],
        transform: [
          {type: 'filter', expr: 'datum.id < count'},
          {
            type: 'collect',
            sort: {field: 'id', order: {signal: "reverse ? 'descending' : 'ascending'"}}
          }
        ]
      }
    ],
    marks: [
      {
        type: 'symbol',
        from: {data: 'table'},
        encode: {
          update: {
            x: {field: 'x'},
            y: {value: 40},
            size: {value: 400},
            shape: {signal: 'shape'},
            fill: {value: 'red'}
          }
        }
      },
      {
        type: 'rect',
        sort: {field: 'datum.x', order: {signal: "reverse ? 'descending' : 'ascending'"}},
        from: {data: 'table'},
        encode: {
          update: {
            x: {field: 'x'},
            y: {value: 100},
            width: {value: 30},
            height: {value: 30},
            fill: {value: 'blue'}
          }
        }
      }
    ]
  };
  const view = new ViewGl(parse(spec), {
    presenterConfig: {
      onSceneRectAssignCubeOrdinal: (datum: {id: number}) => datum.id,
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
    await new Promise(resolve => setTimeout(resolve, 1100));
    const symbolLayer = () =>
      deck.props.layers.find((layer: any) => layer?.id === 'LAYER_SYMBOLS') as any;
    expect(symbolLayer().props.data).toHaveLength(3);
    expect(symbolLayer().props.lineWidthUnits).toBe('pixels');
    deck.redraw('symbol picking');
    expect(
      deck
        .pickObjects({x: 0, y: 0, width: 500, height: 320})
        .some(pick => pick.layer?.id === 'LAYER_SYMBOLS' && (pick.object as any)?.datum?.id === 1)
    ).toBe(true);
    const initial = view.presenter
      .getCubeData()
      .map(cube => ({ordinal: cube.ordinal, position: [...cube.position]}));
    const timeline = symbolLayer().context.timeline;
    timeline.pause();
    await view.signal('count', 1).runAsync();
    await expect.poll(() => view.presenter.getCubeData()[1]?.isEmpty).toBe(true);
    expect(view.presenter.getCubeData()[1]).toMatchObject({
      ordinal: 1,
      position: initial[1].position,
      size: [0, 0, 0],
      color: [0, 0, 0, 0]
    });
    const cubeLayer = () =>
      deck.props.layers.find((layer: any) => layer?.id === 'LAYER_CUBES') as any;
    await expect
      .poll(() =>
        cubeLayer()?.getAttributeManager().attributeTransitionManager.hasAttribute('instanceSizes')
      )
      .toBe(true);
    const exitStart = timeline.getTime();
    const readAttribute = (name: string, index: number) => {
      const attribute = cubeLayer().getAttributeManager().getAttributes()[name];
      const bytes = attribute.getBuffer().readSyncWebGL();
      const values =
        attribute.value instanceof Uint8Array
          ? bytes
          : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      return values[index];
    };
    const advanceExit = (time: number) => {
      timeline.setTime(time);
      cubeLayer().getAttributeManager().attributeTransitionManager.run();
      deck.redraw('exit buffer validation');
    };
    advanceExit(exitStart + 350);
    const intermediateSize = readAttribute('instanceSizes', 3);
    const intermediateAlpha = readAttribute('instanceColors', 7);
    expect(intermediateSize).toBeGreaterThan(0);
    expect(intermediateSize).toBeLessThan(30);
    expect(intermediateAlpha).toBeGreaterThan(0);
    expect(intermediateAlpha).toBeLessThan(255);
    await view.signal('count', 0).runAsync();
    await expect.poll(() => view.presenter.getCubeData().every(cube => cube.isEmpty)).toBe(true);
    advanceExit(exitStart + 350);
    expect(readAttribute('instanceSizes', 3)).toBeCloseTo(intermediateSize, 2);
    expect(readAttribute('instanceColors', 7)).toBeCloseTo(intermediateAlpha, 2);
    advanceExit(exitStart + 1350);
    expect(readAttribute('instanceSizes', 3)).toBe(0);
    expect(readAttribute('instanceColors', 7)).toBe(0);
    await view.signal('count', 3).signal('shape', 'square').runAsync();
    await expect.poll(() => view.presenter.getCubeData().every(cube => !cube.isEmpty)).toBe(true);
    expect(view.presenter.getCubeData().map(cube => cube.ordinal)).toEqual([0, 1, 2]);
    await expect
      .poll(() => symbolLayer().props.data.every((item: any) => item.radius === 0))
      .toBe(true);
    const polygons = deck.props.layers.find(
      (layer: any) => layer?.id === 'LAYER_SYMBOL_SQUARES'
    ) as any;
    expect(polygons.props.data).toHaveLength(3);
    expect(polygons.props.extruded).toBe(false);
    expect(polygons.props.lineWidthUnits).toBe('pixels');
    timeline.play();
    await new Promise(resolve => setTimeout(resolve, 1100));
    deck.redraw('square picking');
    expect(
      deck
        .pickObjects({x: 0, y: 0, width: 500, height: 320})
        .some(
          pick => pick.layer?.id === 'LAYER_SYMBOL_SQUARES' && (pick.object as any)?.datum?.id === 1
        )
    ).toBe(true);
    const previousCubeData = view.presenter.getCubeData();
    await view.signal('reverse', true).runAsync();
    // Vega skips a redraw when a sort changes no geometry; exercise the renderer explicitly.
    view.dirty(view.scenegraph().root.items[0]);
    await view.runAsync();
    await expect.poll(() => view.presenter.getCubeData()).not.toBe(previousCubeData);
    await expect.poll(() => view.data('table')[0].id).toBe(2);
    expect(
      view.presenter.getCubeData().map(cube => ({ordinal: cube.ordinal, position: cube.position}))
    ).toEqual(initial);
    expect(cubeLayer().props.transitions.getSize.enter()).toEqual([0, 0, 0]);
    expect(errors).toEqual([]);
  } finally {
    view.finalize();
    host.remove();
  }
}, 30000);

it('keeps default ordinals stable when Vega scene items reorder and share tuples', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:400px;height:300px;position:relative';
  document.body.append(host);
  const spec: Spec = {
    width: 200,
    height: 160,
    signals: [{name: 'reverse', value: false}],
    data: [
      {
        name: 'table',
        values: [{x: 20}, {x: 80}],
        transform: [
          {
            type: 'collect',
            sort: {
              field: 'x',
              order: {signal: "reverse ? 'descending' : 'ascending'"}
            }
          }
        ]
      }
    ],
    marks: [
      {
        type: 'rect',
        sort: {field: 'datum.x', order: {signal: "reverse ? 'descending' : 'ascending'"}},
        from: {data: 'table'},
        encode: {
          update: {
            x: {field: 'x'},
            y: {value: 10},
            width: {value: 20},
            height: {value: 20},
            fill: {value: 'red'}
          }
        }
      },
      {
        type: 'rect',
        sort: {field: 'datum.x', order: {signal: "reverse ? 'descending' : 'ascending'"}},
        from: {data: 'table'},
        encode: {
          update: {
            x: {field: 'x'},
            y: {value: 80},
            width: {value: 20},
            height: {value: 20},
            fill: {value: 'blue'}
          }
        }
      }
    ]
  };
  const view = new ViewGl(parse(spec));
  try {
    view.renderer('deck.gl').initialize(host);
    await view.runAsync();
    await expect.poll(() => view.presenter.getCubeData().length).toBe(4);
    const before = view.presenter
      .getCubeData()
      .map(cube => ({ordinal: cube.ordinal, position: [...cube.position]}));
    await view
      .change(
        'table',
        changeset().modify(tuple => tuple.x === 20, 'x', 30)
      )
      .runAsync();
    await expect.poll(() => view.presenter.getCubeData()[0].position[0]).toBe(30);
    expect(view.presenter.getCubeData().map(cube => cube.ordinal)).toEqual(
      before.map(cube => cube.ordinal)
    );
    expect(view.presenter.getCubeData()[2].position[0]).toBe(30);
    const updated = view.presenter
      .getCubeData()
      .map(cube => ({ordinal: cube.ordinal, position: [...cube.position]}));
    const previousCubeData = view.presenter.getCubeData();
    await view.signal('reverse', true).runAsync();
    // Vega skips a redraw when a sort changes no geometry; exercise the renderer explicitly.
    view.dirty(view.scenegraph().root.items[0]);
    await view.runAsync();
    await expect.poll(() => view.presenter.getCubeData()).not.toBe(previousCubeData);
    await expect.poll(() => view.data('table')[0].x).toBe(80);
    await expect
      .poll(() =>
        view.presenter.getCubeData().map(cube => ({ordinal: cube.ordinal, position: cube.position}))
      )
      .toEqual(updated);
    const moved = view.presenter.getCubeData().map(cube => ({
      ...cube,
      position: [cube.position[0] + 10, cube.position[1], cube.position[2]] as [
        number,
        number,
        number
      ]
    }));
    view.presenter.rePresent({cubeData: [...moved].reverse()});
    await expect.poll(() => view.presenter.getCubeData()[0].position[0]).toBe(40);
    view.presenter.present(createStage('2d'), 160, 200);
    await expect.poll(() => view.presenter.getCubeData().every(cube => cube.isEmpty)).toBe(true);
    expect(view.presenter.getCubeData().map(cube => cube.position)).toEqual(
      moved.map(cube => cube.position)
    );
  } finally {
    view.finalize();
    host.remove();
  }
}, 20000);
