// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrthographicViewport, WebMercatorViewport} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';
import {
  getCORTAOCamera,
  getCORTAOMainPassUniforms,
  getCORTAOMipAtlasSize,
  getCORTAOMipCount,
  getCORTAOPrepassUniforms,
  type CORTAOConfiguration
} from '../../src/cortao-effect/cortao-parameters';

const CONFIGURATION: CORTAOConfiguration = {
  width: 1920,
  height: 1080,
  randomSeed: 0,
  radius: Number.POSITIVE_INFINITY,
  maxScreenSpaceRadius: 0.2,
  mipBias: -4,
  maxSlopeCompensation: 4,
  backfaceThreshold: 0.5,
  backfaceBoost: 0.5,
  intensity: 1,
  filterDepthSensitivity: 512,
  filterNormalSensitivity: 16
};

const viewport = new WebMercatorViewport({
  width: 1920,
  height: 1080,
  longitude: -122.42,
  latitude: 37.77,
  zoom: 14,
  pitch: 55,
  bearing: 30
});

/** Multiplies a column-major 4x4 matrix with a 4D vector. */
function transform(matrix: readonly number[], vector: readonly number[]): number[] {
  return [0, 1, 2, 3].map(
    row =>
      matrix[row] * vector[0] +
      matrix[4 + row] * vector[1] +
      matrix[8 + row] * vector[2] +
      matrix[12 + row] * vector[3]
  );
}

/** Gets the view-space position of a longitude, latitude and altitude in meters. */
function getViewPosition(lngLatAltitude: number[]): number[] {
  return transform(viewport.viewMatrix, [...viewport.projectPosition(lngLatAltitude), 1]);
}

describe('getCORTAOCamera', () => {
  const camera = getCORTAOCamera(viewport)!;

  it('scales view space to meters', () => {
    const ground = getViewPosition([-122.42, 37.77, 0]);
    const raised = getViewPosition([-122.42, 37.77, 100]);
    const viewDistance = Math.hypot(...[0, 1, 2].map(index => raised[index] - ground[index]));
    const nearPlaneInViewUnits =
      viewport.projectionMatrix[14] / (viewport.projectionMatrix[10] - 1);
    const viewUnitsPerMeter = nearPlaneInViewUnits / camera.nearPlane;
    expect(viewDistance / viewUnitsPerMeter).toBeCloseTo(100, 3);
  });

  it('linearizes the hardware depth to the view distance in meters', () => {
    const uniforms = getCORTAOPrepassUniforms(camera, CONFIGURATION);
    const nearPlaneInViewUnits =
      viewport.projectionMatrix[14] / (viewport.projectionMatrix[10] - 1);
    const viewUnitsPerMeter = nearPlaneInViewUnits / camera.nearPlane;
    for (const lngLat of [
      [-122.42, 37.77],
      [-122.4, 37.78]
    ]) {
      const viewPosition = getViewPosition([...lngLat, 20]);
      const clip = transform(viewport.projectionMatrix, viewPosition);
      // WebGL window depth with the default depth range.
      const depth = (clip[2] / clip[3]) * 0.5 + 0.5;
      const linearDepth = 1 / (depth * uniforms.depthScale + uniforms.depthOffset);
      expect(linearDepth / (-viewPosition[2] / viewUnitsPerMeter)).toBeCloseTo(1, 4);
    }
  });

  it('unprojects and projects screen positions consistently', () => {
    const prepassUniforms = getCORTAOPrepassUniforms(camera, CONFIGURATION);
    const mainUniforms = getCORTAOMainPassUniforms(camera, CONFIGURATION);
    const viewPosition = getViewPosition([-122.415, 37.772, 35]);
    const clip = transform(viewport.projectionMatrix, viewPosition);
    const texCoords = [clip[0] / clip[3] / 2 + 0.5, clip[1] / clip[3] / 2 + 0.5];

    // cortao_unproject() with a depth of 1 gives the view direction at Z = -1.
    const [scaleX, scaleY, offsetX, offsetY] = prepassUniforms.unprojectParams;
    const direction = [texCoords[0] * scaleX + offsetX, texCoords[1] * scaleY + offsetY];
    expect(direction[0]).toBeCloseTo(viewPosition[0] / -viewPosition[2], 6);
    expect(direction[1]).toBeCloseTo(viewPosition[1] / -viewPosition[2], 6);

    // The truncated projection matrix of the main pass maps the view position back.
    const [projectionX, projectionY, projectionZ, projectionW] = mainUniforms.projectionParams;
    const [x, y, z] = viewPosition;
    expect((projectionX * x + projectionZ * z) / -z).toBeCloseTo(texCoords[0], 6);
    expect((projectionY * y + projectionW * z) / -z).toBeCloseTo(texCoords[1], 6);
  });

  it('rejects an orthographic projection', () => {
    const orthographic = new OrthographicViewport({width: 400, height: 300, target: [0, 0, 0]});
    expect(getCORTAOCamera(orthographic)).toBeNull();
  });
});

describe('getCORTAOMainPassUniforms', () => {
  it('derives the Carbon Engine constants', () => {
    const camera = getCORTAOCamera(viewport)!;
    const uniforms = getCORTAOMainPassUniforms(camera, CONFIGURATION);
    const projectionY = viewport.projectionMatrix[5];
    const apparentRadius = (1 / projectionY) * 0.2 * 2;
    expect(uniforms.maxApparentCircleRadiusCoefficient).toBeCloseTo(
      apparentRadius / Math.sqrt(apparentRadius * apparentRadius + 1),
      10
    );
    expect(uniforms.mipBias).toBeCloseTo(Math.log2(projectionY * 1080 * 0.5) - 4, 10);
    expect(uniforms.inverseMaxSlopeCompensation).toBe(0.25);
    expect(Number.isFinite(uniforms.radius)).toBe(true);
    expect(uniforms.mipCount).toBe(8);
  });
});

describe('mip atlas', () => {
  it.each([
    [1920, 1080],
    [1023, 767],
    [300, 37],
    [1, 1]
  ])('places %i x %i levels without overlap', (width, height) => {
    const mipCount = getCORTAOMipCount(width, height);
    const [atlasWidth, atlasHeight] = getCORTAOMipAtlasSize(width, height);
    const rectangles: number[][] = [];
    for (let level = 0; level < mipCount; level++) {
      const levelWidth = Math.max(width >> level, 1);
      const levelHeight = Math.max(height >> level, 1);
      // Same formula as cortao_samplePackedData() and CORTAO_MIPMAP_FS.
      const x = level === 0 ? 0 : width;
      const y = level === 0 ? 0 : height - (height >> (level - 1));
      expect(x + levelWidth).toBeLessThanOrEqual(atlasWidth);
      expect(y + levelHeight).toBeLessThanOrEqual(atlasHeight);
      for (const [otherX, otherY, otherWidth, otherHeight] of rectangles) {
        const overlaps =
          x < otherX + otherWidth &&
          otherX < x + levelWidth &&
          y < otherY + otherHeight &&
          otherY < y + levelHeight;
        expect(overlaps).toBe(false);
      }
      rectangles.push([x, y, levelWidth, levelHeight]);
    }
  });
});
