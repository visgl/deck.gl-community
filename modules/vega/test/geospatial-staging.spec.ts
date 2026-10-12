import {expect, it} from 'vitest';
import {View, parse, type Spec} from 'vega';
import {createStage} from '../src/defaults';
import {sceneToStage} from '../src/stagers';
import spec from '../../../examples/vega/geospatial/spec.json';

it('stages projected polygons with holes, separate islands, routes and geographic symbols', async () => {
  const view = new View(parse(spec as unknown as Spec), {renderer: 'none'});
  const stage = () => {
    const output = createStage('2d');
    sceneToStage(
      {
        maxOrdinal: 0,
        currAxis: null,
        defaultCubeColor: [0, 0, 0, 255],
        assignCubeOrdinal: () => 0,
        zAxisZindex: undefined
      },
      output,
      view.scenegraph().root
    );
    return output;
  };
  try {
    await view.runAsync();
    const initial = stage();
    expect(initial.polygonData).toHaveLength(3);
    expect(initial.polygonData[0].positions).toHaveLength(2);
    expect(initial.pathData).toHaveLength(1);
    expect(initial.symbolData).toHaveLength(6);
    expect(initial.polygonData.every(p => p.isGeographic && p.datum)).toBe(true);
    const point = initial.symbolData[0].position;
    await view.signal('longitude', 30).runAsync();
    expect(stage().symbolData[0].position).not.toEqual(point);
    await view.signal('projectionType', 'orthographic').runAsync();
    const globe = stage();
    expect(globe.polygonData.length).toBeGreaterThan(0);
    expect(JSON.stringify(globe)).not.toContain('null');
  } finally {
    view.finalize();
  }
});

it('stages GeoJSON points and preserves translated group coordinates', async () => {
  const pointSpec: Spec = {
    width: 200,
    height: 100,
    projections: [{name: 'map', type: 'equirectangular', scale: 50, translate: [0, 0]}],
    data: [{name: 'points', values: [{type: 'Point', coordinates: [0, 0]}]}],
    marks: [
      {
        type: 'group',
        encode: {enter: {x: {value: 20}, y: {value: 30}}},
        marks: [
          {
            type: 'shape',
            from: {data: 'points'},
            transform: [{type: 'geoshape', projection: 'map', field: 'datum', pointRadius: 4}],
            encode: {update: {fill: {value: 'red'}}}
          }
        ]
      }
    ]
  };
  const view = new View(parse(pointSpec), {renderer: 'none'});
  try {
    await view.runAsync();
    const output = createStage('2d');
    sceneToStage(
      {
        maxOrdinal: 0,
        currAxis: null,
        defaultCubeColor: [0, 0, 0, 255],
        assignCubeOrdinal: () => 0,
        zAxisZindex: undefined
      },
      output,
      view.scenegraph().root
    );
    expect(output.polygonData).toHaveLength(1);
    const ring = output.polygonData[0].positions[0] as number[][];
    expect(ring[0][0]).toBeCloseTo(24);
    expect(ring[0][1]).toBeCloseTo(-30);
  } finally {
    view.finalize();
  }
});
