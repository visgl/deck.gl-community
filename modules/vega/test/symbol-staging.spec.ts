import {expect, it} from 'vitest';
import {View, parse, type Spec} from 'vega';
import {createStage} from '../src/defaults';
import {sceneToStage} from '../src/stagers';
import {GroupType} from '../src/marks/interfaces';
import stageSymbol from '../src/marks/symbol';

const options = {
  maxOrdinal: 0,
  currAxis: null,
  defaultCubeColor: [0, 0, 0, 255] as [number, number, number, number],
  assignCubeOrdinal: () => 0,
  zAxisZindex: undefined
};
it('stages a real Vega symbol nested in a translated group', async () => {
  const spec: Spec = {
    width: 200,
    height: 100,
    marks: [
      {
        type: 'group',
        encode: {enter: {x: {value: 10}, y: {value: 20}}},
        marks: [
          {
            type: 'symbol',
            encode: {
              enter: {
                x: {value: 5},
                y: {value: 6},
                size: {value: 100},
                fill: {value: 'rgba(255,0,0,0.5)'},
                fillOpacity: {value: 0.5},
                opacity: {value: 0.5},
                stroke: {value: 'blue'},
                strokeWidth: {value: 2}
              }
            }
          }
        ]
      }
    ]
  };
  const view = new View(parse(spec), {renderer: 'none'});
  try {
    await view.runAsync();
    const stage = createStage('2d');
    sceneToStage(options, stage, view.scenegraph().root);
    expect(stage.symbolData).toHaveLength(1);
    expect(stage.symbolData[0]).toMatchObject({
      position: [15, -26, 0],
      fillColor: [255, 0, 0, 31.875],
      strokeWidth: 2
    });
    expect(Math.PI * stage.symbolData[0].radius ** 2).toBeCloseTo(100);
  } finally {
    view.finalize();
  }
});
it('stages square area, transparent fills and negative sizes without NaN', () => {
  const stage = createStage('2d');
  stageSymbol(
    options,
    stage,
    {
      items: [
        {datum: {id: 1}, x: 10, y: 20, size: 100, shape: 'square', fill: 'transparent'},
        {size: -10}
      ]
    } as any,
    5,
    6,
    GroupType.none
  );
  expect(stage.polygonData[0]).toMatchObject({
    datum: {id: 1},
    positions: [
      [10, -31, 0],
      [20, -31, 0],
      [20, -21, 0],
      [10, -21, 0]
    ],
    fillColor: [NaN, NaN, NaN, 0]
  });
  expect(stage.symbolData[0].radius).toBe(0);
});
it('reports unsupported shapes and accepts empty symbol scenes', () => {
  const stage = createStage('2d');
  stageSymbol(options, stage, {items: []} as any, 0, 0, GroupType.none);
  expect(stage.symbolData).toEqual([]);
  expect(() =>
    stageSymbol(options, stage, {items: [{shape: 'diamond'}]} as any, 0, 0, GroupType.none)
  ).toThrow('Unsupported Vega symbol shape');
});

it('rotates square symbols around their centers in Vega angle coordinates', () => {
  const stage = createStage('2d');
  stageSymbol(
    options,
    stage,
    {items: [{x: 10, y: 20, size: 100, shape: 'square', angle: 45}]} as any,
    0,
    0,
    GroupType.none
  );
  const positions = stage.polygonData[0].positions;
  expect(positions[0][0]).toBeCloseTo(10 - Math.sqrt(50));
  expect(positions[0][1]).toBeCloseTo(-20);
  expect(positions[1][0]).toBeCloseTo(10);
  expect(positions[1][1]).toBeCloseTo(-20 - Math.sqrt(50));
});
