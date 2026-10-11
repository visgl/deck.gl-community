import {expect, it} from 'vitest';
import {parse, changeset, type Spec} from 'vega';
import {ViewGl} from '../src';

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
    deck.redraw('symbol picking');
    expect(
      deck
        .pickObjects({x: 0, y: 0, width: 500, height: 320})
        .some(pick => (pick.object as any)?.datum?.id === 1)
    ).toBe(true);
    const initial = view.presenter
      .getCubeData()
      .map(cube => ({ordinal: cube.ordinal, position: [...cube.position]}));
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
    await view.signal('count', 0).runAsync();
    await expect.poll(() => view.presenter.getCubeData().every(cube => cube.isEmpty)).toBe(true);
    await view.signal('count', 3).signal('shape', 'square').runAsync();
    await expect.poll(() => view.presenter.getCubeData().every(cube => !cube.isEmpty)).toBe(true);
    expect(view.presenter.getCubeData().map(cube => cube.ordinal)).toEqual([0, 1, 2]);
    await expect.poll(() => symbolLayer().props.data.length).toBe(0);
    const polygons = deck.props.layers.find((layer: any) => layer?.id === 'LAYER_POLYGONS') as any;
    expect(polygons.props.data).toHaveLength(3);
    await new Promise(resolve => setTimeout(resolve, 1100));
    deck.redraw('square picking');
    expect(
      deck
        .pickObjects({x: 0, y: 0, width: 500, height: 320})
        .some(pick => (pick.object as any)?.datum?.id === 1)
    ).toBe(true);
    await view.signal('reverse', true).runAsync();
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
    data: [{name: 'table', values: [{x: 20}, {x: 80}]}],
    marks: [
      {
        type: 'rect',
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
  } finally {
    view.finalize();
    host.remove();
  }
}, 20000);
