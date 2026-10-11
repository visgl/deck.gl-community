import {describe, expect, it} from 'vitest';
import {parse, View, type Spec} from 'vega';
import {sceneToStage} from '../src/stagers';
import {createStage} from '../src/defaults';
import {GroupType, type MarkStagerOptions} from '../src/marks/interfaces';
import stageRect from '../src/marks/rect';
import stageLine from '../src/marks/line';
import stageArea from '../src/marks/area';

export const CHART_SPEC: Spec = {
  width: 200,
  height: 160,
  padding: 0,
  data: [
    {
      name: 'table',
      values: [
        {x: 10, width: 25, height: 40},
        {x: 60, width: 35, height: 80}
      ]
    }
  ],
  marks: [
    {
      type: 'rect',
      from: {data: 'table'},
      encode: {
        enter: {
          x: {field: 'x'},
          y: {value: 10},
          width: {field: 'width'},
          height: {field: 'height'},
          fill: {value: '#ff0000'}
        }
      }
    }
  ]
};
function createOptions(): MarkStagerOptions {
  let ordinal = 0;
  return {
    maxOrdinal: 0,
    currAxis: null,
    defaultCubeColor: [128, 128, 128, 255],
    assignCubeOrdinal: () => ordinal++,
    zAxisZindex: undefined
  };
}
describe('Vega scene staging', () => {
  it('stages a parsed Vega scene into cuboids with SVG-to-Cartesian coordinates', async () => {
    const view = new View(parse(CHART_SPEC), {renderer: 'none'});
    try {
      await view.runAsync();
      const stage = createStage('2d');
      sceneToStage(createOptions(), stage, view.scenegraph().root);
      expect(stage.cubeData).toHaveLength(2);
      expect(stage.cubeData[0]).toMatchObject({
        ordinal: 0,
        position: [10, -50, 0],
        size: [25, 40, 0.05],
        color: [255, 0, 0, 255]
      });
      expect(stage.cubeData[1].position).toEqual([60, -90, 0]);
    } finally {
      view.finalize();
    }
  });
  it('preserves 3D z/depth and opacity extensions', () => {
    const stage = createStage('3d');
    stageRect(
      createOptions(),
      stage,
      {
        items: [
          {
            datum: {},
            x: 2,
            y: 3,
            z: 7,
            width: 10,
            height: 20,
            depth: 30,
            fill: '#00ff00',
            opacity: 0.5
          }
        ]
      } as any,
      5,
      6,
      GroupType.none
    );
    expect(stage.cubeData[0]).toMatchObject({
      position: [7, -29, 7],
      size: [10, 20, 30.05],
      color: [0, 255, 0, 127.5]
    });
  });
});

it.each([stageLine, stageArea])('skips an empty scene', stageMark => {
  const stage = createStage('2d');
  stageMark(createOptions(), stage, {items: []} as any, 10, 20, GroupType.none);
  expect(stage.pathData).toEqual([]);
  expect(stage.polygonData).toEqual([]);
});
it('applies group offsets to line and both area boundaries', () => {
  const stage = createStage('2d');
  const scene = {items: [{x: 2, y: 3, x2: 4, y2: 8, stroke: 'red', fill: 'blue'}]} as any;
  stageLine(createOptions(), stage, scene, 10, 20, GroupType.none);
  stageArea(createOptions(), stage, scene, 10, 20, GroupType.none);
  expect(stage.pathData[0].positions).toEqual([[12, -23, 0]]);
  expect(stage.polygonData[0].positions).toEqual([
    [12, -23, 0],
    [14, -28, 0],
    [12, -23, 0]
  ]);
});
it.each([
  ['rgba(255, 0, 0, 0.5)', 0.5, 0.5, 31.875],
  ['transparent', 1, 1, 0],
  ['red', 1, 0, 0]
])('preserves fill alpha and opacity for %s', (fill, opacity, fillOpacity, alpha) => {
  const stage = createStage('2d');
  stageRect(
    createOptions(),
    stage,
    {items: [{datum: {}, x: 0, y: 0, width: 1, height: 1, fill, opacity, fillOpacity}]} as any,
    0,
    0,
    GroupType.none
  );
  expect(stage.cubeData[0].color[3]).toBe(alpha);
});

it('keeps default cube colors independent across opacity changes', () => {
  const stage = createStage('2d');
  const options = createOptions();
  stageRect(
    options,
    stage,
    {items: [0.5, 1].map(opacity => ({datum: {}, width: 1, height: 1, opacity}))} as any,
    0,
    0,
    GroupType.none
  );
  expect(stage.cubeData.map(cube => cube.color[3])).toEqual([127.5, 255]);
  expect(options.defaultCubeColor[3]).toBe(255);
  expect(stage.cubeData[0].color).not.toBe(stage.cubeData[1].color);
});
it.each([
  undefined,
  'invalid-color'
])('stages a line without a valid stroke as transparent', stroke => {
  const stage = createStage('2d');
  stageLine(createOptions(), stage, {items: [{x: 1, y: 2, stroke}]} as any, 0, 0, GroupType.none);
  expect(stage.pathData[0].strokeColor).toEqual([0, 0, 0, 0]);
});
