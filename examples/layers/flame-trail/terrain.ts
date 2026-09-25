// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {Geometry} from '@luma.gl/engine';

const SEGMENTS = 192;
const EXTENT = 520;

/** A deterministic stress surface with peaks, gullies, and smaller ridges. */
function getTerrainHeight(x: number, y: number): number {
  const peak = (cx: number, cy: number, sx: number, sy: number, height: number) =>
    height * Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  const ridge = y + 65 * Math.sin(x / 115) - 20;
  const broad = peak(-190, 110, 155, 135, 220) + peak(195, -95, 135, 155, 250);
  const spine = 100 * Math.exp(-((ridge / 48) ** 2)) * Math.exp(-((x / 420) ** 4));
  const detail = 14 * Math.sin(x / 28 + y / 54) * Math.cos(y / 32) + 7 * Math.sin(x / 13 - y / 19);
  const edge = Math.max(0, 1 - (Math.max(Math.abs(x), Math.abs(y)) / EXTENT) ** 6);
  return 12 + Math.max(0, broad + spine + detail + 24) * edge;
}

function createTerrainMesh(): Geometry {
  const size = SEGMENTS + 1;
  const positions = new Float32Array(size * size * 3);
  const normals = new Float32Array(positions.length);
  const colors = new Float32Array(positions.length);
  const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = -EXTENT + (col * 2 * EXTENT) / SEGMENTS;
      const y = -EXTENT + (row * 2 * EXTENT) / SEGMENTS;
      const z = getTerrainHeight(x, y);
      const offset = (row * size + col) * 3;
      positions.set([x, y, z], offset);
      const dx = (getTerrainHeight(x + 1, y) - getTerrainHeight(x - 1, y)) / 2;
      const dy = (getTerrainHeight(x, y + 1) - getTerrainHeight(x, y - 1)) / 2;
      const length = Math.hypot(dx, dy, 1);
      normals.set([-dx / length, -dy / length, 1 / length], offset);
      const rock = Math.min(1, z / 270 + (1 - 1 / length) * 0.5);
      const light = 0.55 + 0.45 * Math.max(0, (-dx * -0.45 - dy * -0.55 + 0.7) / length);
      colors.set(
        [(0.15 + rock * 0.21) * light, (0.19 + rock * 0.16) * light, (0.16 + rock * 0.16) * light],
        offset
      );
      if (row < SEGMENTS && col < SEGMENTS) {
        const vertex = row * size + col;
        indices.set(
          [vertex, vertex + 1, vertex + size, vertex + 1, vertex + size + 1, vertex + size],
          (row * SEGMENTS + col) * 6
        );
      }
    }
  }
  return new Geometry({
    topology: 'triangle-list',
    indices,
    attributes: {
      positions: {size: 3, value: positions},
      normals: {size: 3, value: normals},
      colors: {size: 3, value: colors}
    }
  });
}

const TERRAIN_MESH = createTerrainMesh();
const TERRAIN_DATA = [{position: [0, 0, 0] as [number, number, number]}];

/** Interpolate the actual mesh triangle, including its small ridges, for an XYZ route. */
export function sampleTerrainHeight(x: number, y: number): number {
  const u = Math.max(0, Math.min(SEGMENTS, ((x + EXTENT) / (2 * EXTENT)) * SEGMENTS));
  const v = Math.max(0, Math.min(SEGMENTS, ((y + EXTENT) / (2 * EXTENT)) * SEGMENTS));
  const col = Math.min(Math.floor(u), SEGMENTS - 1);
  const row = Math.min(Math.floor(v), SEGMENTS - 1);
  const tx = u - col;
  const ty = v - row;
  const positions = TERRAIN_MESH.attributes.positions.value;
  const z = (dx: number, dy: number) => positions[((row + dy) * (SEGMENTS + 1) + col + dx) * 3 + 2];
  return tx + ty <= 1
    ? z(0, 0) * (1 - tx - ty) + z(1, 0) * tx + z(0, 1) * ty
    : z(1, 1) * (tx + ty - 1) + z(1, 0) * (1 - ty) + z(0, 1) * (1 - tx);
}

/** The visible mesh also supplies the GPU height map used by TerrainExtension. */
export function createTerrainLayers(wireframe: boolean, heightMap = true) {
  const props = {
    data: TERRAIN_DATA,
    mesh: TERRAIN_MESH,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    _instanced: false,
    getPosition: (d: {position: [number, number, number]}) => d.position,
    getColor: [255, 255, 255] as [number, number, number],
    material: false as const,
    parameters: {cullMode: 'none' as const, depthWriteEnabled: true}
  };
  return [
    new SimpleMeshLayer({
      ...props,
      id: 'rugged-terrain',
      operation: heightMap ? 'terrain+draw' : 'draw'
    }),
    wireframe &&
      new SimpleMeshLayer({
        ...props,
        id: 'terrain-wireframe',
        wireframe: true,
        opacity: 0.2,
        getColor: [150, 165, 160],
        parameters: {depthWriteEnabled: false, depthBias: -1, depthBiasSlopeScale: -1}
      })
  ];
}
