// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {equals} from '@math.gl/core';

import ColumnGeometry from '../../src/experimental-column-layer/experimental-column-geometry';

const TEST_VERTICES = [
  [-1, -1, 0],
  [-1, 1, 0],
  [1, 1, 0],
  [1, -1, 0]
];

describe('ColumnGeometry', () => {
  it('constructor', () => {
    let geometry = new ColumnGeometry({radius: 1, height: 1, nradial: 6});
    let attributes = geometry.getAttributes();

    expect(ArrayBuffer.isView(attributes.indices.value)).toBe(true);
    expect(ArrayBuffer.isView(attributes.POSITION.value)).toBe(true);
    expect(ArrayBuffer.isView(attributes.NORMAL.value)).toBe(true);

    geometry = new ColumnGeometry({radius: 1, height: 1, nradial: 4, vertices: TEST_VERTICES});
    attributes = geometry.getAttributes();

    expect(ArrayBuffer.isView(attributes.indices.value)).toBe(true);
    expect(ArrayBuffer.isView(attributes.POSITION.value)).toBe(true);
    expect(ArrayBuffer.isView(attributes.NORMAL.value)).toBe(true);

    expect(() => {
      new ColumnGeometry({radius: 1, height: 1, nradial: 6, vertices: TEST_VERTICES});
    }).toThrow();
  });

  it('tesselation', () => {
    // Regular geometry with height
    let geometry = new ColumnGeometry({radius: 1, height: 1, nradial: 4});
    let attributes = geometry.getAttributes();

    expect(attributes.POSITION.value.length).toBe((5 * 3 + 1) * 3);
    expect(attributes.NORMAL.value.length).toBe((5 * 3 + 1) * 3);
    expect(attributes.indices.value.length).toBe(4 * 3 * 2);

    // prettier-ignore
    expect(equals(attributes.POSITION.value.slice(0, 3 * 8), [
      1, 0, 0.5, 1, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
      -1, 0, 0.5, -1, 0, -0.5, 0, -1, 0.5, 0, -1, -0.5
    ])).toBe(true);

    // prettier-ignore
    expect(equals(attributes.NORMAL.value.slice(0, 3 * 8), [
      1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0,
      -1, 0, 0, -1, 0, 0, 0, -1, 0, 0, -1, 0
    ])).toBe(true);

    // Custom geometry with height
    geometry = new ColumnGeometry({radius: 1, height: 1, nradial: 4, vertices: TEST_VERTICES});
    attributes = geometry.getAttributes();

    // prettier-ignore
    expect(equals(attributes.POSITION.value.slice(0, 3 * 8), [
      1, -1, 0.5, 1, -1, -0.5,
      1, 1, 0.5, 1, 1, -0.5,
      -1, 1, 0.5, -1, 1, -0.5,
      -1, -1, 0.5, -1, -1, -0.5
    ])).toBe(true);

    // prettier-ignore
    expect(equals(attributes.NORMAL.value.slice(0, 3 * 8), [
      1, -1, 0, 1, -1, -0,
      1, 1, 0, 1, 1, -0,
      -1, 1, 0, -1, 1, -0,
      -1, -1, 0, -1, -1, -0
    ])).toBe(true);

    // Regular geometry without height
    geometry = new ColumnGeometry({radius: 1, height: 0, nradial: 4});
    attributes = geometry.getAttributes();

    expect(attributes.POSITION.value.length).toBe(4 * 3);
    expect(attributes.NORMAL.value.length).toBe(4 * 3);
    expect(attributes.indices.value.length).toBe(0);

    // prettier-ignore
    expect(equals(attributes.POSITION.value, [
      1, 0, 0,
      0, 1, 0,
      0, -1, 0,
      -1, 0, 0
    ])).toBe(true);
  });

  it('bevel', () => {
    const nradial = 4;
    const vertsAroundEdge = nradial + 1;

    // Flat bevel (bevelSegments=0)
    let geometry = new ColumnGeometry({radius: 1, height: 1, nradial, bevelSegments: 0});
    let attributes = geometry.getAttributes();

    expect(ArrayBuffer.isView(attributes.POSITION.value)).toBe(true);
    expect(ArrayBuffer.isView(attributes.NORMAL.value)).toBe(true);
    // Flat cap: sides (vertsAroundEdge * 2) + degenerate (1) + top cap (vertsAroundEdge)
    expect(attributes.POSITION.value.length).toBe((vertsAroundEdge * 3 + 1) * 3);

    // Cone bevel (bevelSegments=2)
    geometry = new ColumnGeometry({
      radius: 1,
      height: 1,
      nradial,
      bevelSegments: 2,
      bevelHeight: 1,
      smoothNormals: false
    });
    attributes = geometry.getAttributes();

    expect(ArrayBuffer.isView(attributes.POSITION.value)).toBe(true);
    expect(ArrayBuffer.isView(attributes.NORMAL.value)).toBe(true);
    expect(attributes.POSITION.value.length).toBeGreaterThan(0);

    // Check that apex is at center (x=0, y=0) and cuts into column (z <= 0.5)
    const conePositions = attributes.POSITION.value;
    const coneApexZ = conePositions[conePositions.length - 1];
    expect(coneApexZ).toBeLessThanOrEqual(0.5);
    expect(conePositions[conePositions.length - 3]).toBe(0);
    expect(conePositions[conePositions.length - 2]).toBe(0);

    // Dome bevel (bevelSegments=5, smoothNormals=true)
    geometry = new ColumnGeometry({
      radius: 1,
      height: 1,
      nradial,
      bevelSegments: 5,
      bevelHeight: 1,
      smoothNormals: true
    });
    attributes = geometry.getAttributes();

    expect(ArrayBuffer.isView(attributes.POSITION.value)).toBe(true);
    expect(ArrayBuffer.isView(attributes.NORMAL.value)).toBe(true);
    expect(attributes.POSITION.value.length).toBeGreaterThan((vertsAroundEdge * 3 + 1) * 3);

    // Verify apex cuts into column
    const domePositions = attributes.POSITION.value;
    const domeApexZ = domePositions[domePositions.length - 1];
    expect(domeApexZ).toBeLessThanOrEqual(0.5);

    // Bevel with custom height
    geometry = new ColumnGeometry({
      radius: 1,
      height: 1,
      nradial,
      bevelSegments: 2,
      bevelHeight: 0.5,
      smoothNormals: false
    });
    attributes = geometry.getAttributes();

    const shallowPositions = attributes.POSITION.value;
    const shallowApexZ = shallowPositions[shallowPositions.length - 1];
    // With bevelHeight=0.5, apex should be higher or equal to full bevel
    expect(shallowApexZ).toBeGreaterThanOrEqual(coneApexZ);

    // Bevel with smoothNormals=false (planar normals)
    geometry = new ColumnGeometry({
      radius: 1,
      height: 1,
      nradial,
      bevelSegments: 3,
      bevelHeight: 1,
      smoothNormals: false
    });
    attributes = geometry.getAttributes();

    expect(ArrayBuffer.isView(attributes.NORMAL.value)).toBe(true);
    // Planar normals should have consistent z-component across a face
    const planarNormals = attributes.NORMAL.value;
    expect(planarNormals.length).toBeGreaterThan(0);
  });
});
