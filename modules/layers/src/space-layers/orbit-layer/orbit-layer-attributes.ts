// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Accessor, AccessorContext, Color} from '@deck.gl/core';
import type {OMMRow} from '@loaders.gl/scientific/omm';

import type {GpRecord} from './gp-records';
import {ORBIT_CLASSES, type OrbitClass} from './orbit-math';
import type {OrbitInitResult, OrbitSample} from './orbit-propagator';

/** Pure helpers of `OrbitLayer`: satellite objects and their attributes. */

/** A satellite, as the accessors and picking see it. */
export type OrbitSatellite = {
  name: string;
  noradId: number;
  /** Element set epoch, in milliseconds since the Unix epoch. */
  epochMs: number;
  orbitClass: OrbitClass;
  periodMinutes: number;
  /** `[lng, lat, altitude meters]` at `currentTime`; `null` when SGP4 fails. Accessors get `null`. */
  position: [number, number, number] | null;
  /** Inertial speed at `currentTime`; `NaN` when unknown. Accessors get `NaN`. */
  speedKmS: number;
};

/** Builds the static satellite objects for the records that SGP4 accepted. */
export function getSatellites(result: OrbitInitResult, records: GpRecord[]): OrbitSatellite[] {
  return Array.from(result.recordIndices, (recordIndex, i): OrbitSatellite => {
    const record = records[recordIndex];
    return {
      name: record.name,
      noradId: record.noradId,
      epochMs: record.epochMs,
      orbitClass: ORBIT_CLASSES[result.orbitClasses[i]],
      periodMinutes: result.periodsMinutes[i],
      position: null,
      speedKmS: Number.NaN
    };
  });
}

/** Runs the accessors once per satellite, on the static fields. */
export function getStaticAttributes(
  satellites: OrbitSatellite[],
  getColor: Accessor<OrbitSatellite, Color>,
  getRadius: Accessor<OrbitSatellite, number>
): {colors: {value: Uint8Array; size: 4; normalized: true}; radii: Float32Array} {
  const colors = new Uint8Array(satellites.length * 4);
  const radii = new Float32Array(satellites.length);
  const context: AccessorContext<OrbitSatellite> = {index: 0, data: satellites, target: []};
  for (let i = 0; i < satellites.length; i++) {
    context.index = i;
    const color = typeof getColor === 'function' ? getColor(satellites[i], context) : getColor;
    colors.set(color.length === 3 ? [...color, 255] : color, i * 4);
    radii[i] = typeof getRadius === 'function' ? getRadius(satellites[i], context) : getRadius;
  }
  return {colors: {value: colors, size: 4, normalized: true}, radii};
}

/** Radius 0 hides satellites that SGP4 failed for, and keeps their index for picking. */
export function getVisibleRadii(
  radii: Float32Array,
  sampleA: OrbitSample,
  sampleB: OrbitSample
): Float32Array {
  const visible = new Float32Array(radii);
  for (let i = 0; i < visible.length; i++) {
    if (Number.isNaN(sampleA.positions[i * 3]) || Number.isNaN(sampleB.positions[i * 3])) {
      visible[i] = 0;
    }
  }
  return visible;
}

/** Compares constant accessor values: numbers or color arrays. */
export function isSameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }
  return a === b;
}

/** Returns the rows of loader output: a row array or an object-row table. */
export function getRows(data: unknown): OMMRow[] {
  if (Array.isArray(data)) {
    return data;
  }
  const table = data as {shape?: string; data?: unknown} | null;
  if (table?.shape === 'object-row-table' && Array.isArray(table.data)) {
    return table.data;
  }
  throw new Error('Expected OMM rows or an object-row table of element sets');
}
