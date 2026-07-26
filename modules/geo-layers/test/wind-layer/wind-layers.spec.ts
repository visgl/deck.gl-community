// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {TerrainLayer} from '@deck.gl/geo-layers';
import {describe, expect, it, vi} from 'vitest';

import {
  createWindField,
  DelaunayCoverLayer,
  ElevationLayer,
  ParticleLayer,
  WindLayer,
  type WindStation
} from '../../src';

const STATIONS: WindStation[] = [
  {name: 'southwest', long: 2, lat: 0, elv: 10},
  {name: 'southeast', long: 0, lat: 0, elv: 20},
  {name: 'northwest', long: 2, lat: 2, elv: 30},
  {name: 'northeast', long: 0, lat: 2, elv: 40}
];

const FIELD = createWindField(STATIONS, [
  [
    [0, 10, 20],
    [1, 20, 30],
    [2, 30, 40],
    [3, 40, 50]
  ],
  [
    [1, 20, 30],
    [2, 30, 40],
    [3, 40, 50],
    [4, 50, 60]
  ]
]);

describe('reusable wind showcase layers', () => {
  it('renders vector shafts and arrowheads from the shared wind field', () => {
    const layer = new WindLayer({
      id: 'wind-test',
      windField: FIELD,
      gridWidth: 5,
      gridHeight: 5,
      time: 0.5
    });
    layer.getSubLayerProps = vi.fn(props => props);

    const [glyphs, shafts, heads] = layer.renderLayers() as [
      SolidPolygonLayer,
      PathLayer,
      PathLayer
    ];

    expect(glyphs).toBeInstanceOf(SolidPolygonLayer);
    expect(glyphs.props.id).toBe('glyphs');
    expect(shafts).toBeInstanceOf(PathLayer);
    expect(heads).toBeInstanceOf(PathLayer);
    expect(shafts.props.id).toBe('shafts');
    expect(heads.props.id).toBe('arrowheads');
    expect(shafts.props.data).not.toHaveLength(0);
    expect(glyphs.props.data).toHaveLength((shafts.props.data as unknown[]).length);
    expect(heads.props.data).toHaveLength((shafts.props.data as unknown[]).length);
  });

  it('decodes the original grayscale elevation image as a real exaggerated terrain mesh', () => {
    const layer = new ElevationLayer({
      id: 'elevation-test',
      elevationData: 'https://example.com/elevation.png',
      bounds: [-125, 24.4, -66.7, 49.6],
      elevationRange: [-100, 4126],
      elevationScale: 80
    });
    layer.getSubLayerProps = vi.fn(props => props);

    const terrain = layer.renderLayers() as TerrainLayer;

    expect(terrain).toBeInstanceOf(TerrainLayer);
    expect(terrain.props.id).toBe('terrain-mesh');
    expect(terrain.props.elevationData).toBe('https://example.com/elevation.png');
    expect(terrain.props.texture).toBe('https://example.com/elevation.png');
    expect(terrain.props.elevationDecoder).toEqual({
      rScaler: (4226 / 255) * 80,
      gScaler: 0,
      bScaler: 0,
      offset: -8000
    });
    expect(terrain.props.loadOptions).toEqual({worker: false});
  });

  it('renders one terrain polygon per station triangle', () => {
    const layer = new DelaunayCoverLayer({
      id: 'terrain-test',
      windField: FIELD,
      elevationScale: 2
    });
    layer.getSubLayerProps = vi.fn(props => props);

    const terrain = layer.renderLayers() as SolidPolygonLayer;

    expect(terrain).toBeInstanceOf(SolidPolygonLayer);
    expect(terrain.props.id).toBe('terrain');
    expect(terrain.props.data).toHaveLength(FIELD.triangles.length);
    expect((terrain.props.data as {polygon: number[][]}[])[0].polygon[0][2]).toBeGreaterThan(0);
  });

  it('advects particles a visible, elapsed-time-scaled distance through the wind field', () => {
    const createAdvancedParticle = (time: number) => {
      const layer = new ParticleLayer({
        id: `advected-particle-${time}`,
        windField: FIELD,
        time,
        numParticles: 1,
        speedScale: 0.16,
        surfaceOffset: 160
      });
      layer.state = {
        lastTime: 0,
        particles: [{seed: 1, positions: [[-1, 1, 160]]}]
      };
      vi.spyOn(layer, 'setState').mockImplementation(update => {
        Object.assign(layer.state, update);
      });

      layer.updateState({
        props: layer.props,
        oldProps: layer.props,
        changeFlags: {dataChanged: false}
      } as Parameters<ParticleLayer['updateState']>[0]);

      return layer.state.particles[0];
    };

    const oneFrame = createAdvancedParticle(1 / 54);
    const twoFrames = createAdvancedParticle(2 / 54);
    const getDistance = (particle: typeof oneFrame) => {
      const [start, end] = particle.positions;
      return Math.hypot(end[0] - start[0], end[1] - start[1]);
    };

    expect(oneFrame.positions).toHaveLength(2);
    expect(getDistance(oneFrame)).toBeGreaterThan(0.025);
    expect(getDistance(twoFrames)).toBeCloseTo(getDistance(oneFrame) * 2, 2);
    expect(oneFrame.direction).toBeTypeOf('number');
    expect(oneFrame.speed).toBeGreaterThan(0);
  });

  it('renders independently faded particle trail segments', () => {
    const layer = new ParticleLayer({
      id: 'particles-test',
      windField: FIELD,
      numParticles: 1,
      color: [100, 150, 200, 180]
    });
    layer.getSubLayerProps = vi.fn(props => props);
    layer.state = {
      lastTime: 0,
      particles: [
        {
          seed: 1,
          positions: [
            [-1.5, 0.5, 10],
            [-1.25, 0.5, 12],
            [-1, 0.5, 14]
          ]
        }
      ]
    };

    const [trails, heads] = layer.renderLayers() as [LineLayer, ScatterplotLayer];
    const segments = trails.props.data as {color: number[]}[];

    expect(trails).toBeInstanceOf(LineLayer);
    expect(heads).toBeInstanceOf(ScatterplotLayer);
    expect(trails.props.id).toBe('trails');
    expect(segments).toHaveLength(2);
    expect(segments[0].color[3]).toBeLessThan(segments[1].color[3]);
    expect(segments[1].color).toEqual([100, 150, 200, 180]);
    expect(heads.props.data).toHaveLength(1);
  });

  it('does not render particles before their simulation is initialized', () => {
    const layer = new ParticleLayer({id: 'empty-particles', windField: FIELD});

    expect(layer.renderLayers()).toBeNull();
  });
});
