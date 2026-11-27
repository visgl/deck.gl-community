// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {readFileSync} from 'node:fs';
import {OMMLoader} from '@loaders.gl/scientific/omm';
import {parse} from '@loaders.gl/core';
import {gstime} from 'satellite.js';
import {describe, expect, it} from 'vitest';

import {
  classifyOrbit,
  createSatRec,
  getGroundTrack,
  getOrbitalPeriodMinutes,
  getOrbitPath,
  interpolateLngLatAlt,
  parseGpRecords,
  propagateToLngLatAlt,
  toGpRecords
} from '@deck.gl-community/layers/space-layers';
import type {OMMRow} from '@loaders.gl/scientific/omm';
import fixture from './data/gp-fixture.omm.json';

const records = await parseGpRecords(JSON.stringify(fixture), 'json');
const tleRecords = await parseGpRecords(
  readFileSync(new URL('./data/stations.tle', import.meta.url), 'utf8'),
  'tle'
);
const getRecord = (noradId: number) => records.find(record => record.noradId === noradId)!;
const ISS = 25544;
const DATE = new Date(Date.UTC(2026, 10, 24));

function getLngLatAlt(record = getRecord(ISS), date = DATE): Float64Array {
  const position = new Float64Array(3);
  propagateToLngLatAlt(createSatRec(record)!, date, gstime(date), position, 0);
  return position;
}

describe('satellite orbits: GP parsing', () => {
  it('parses the OMM JSON fixture', () => {
    expect(records.length).toBe(224);
    const iss = getRecord(ISS);
    expect(iss.name).toBe('ISS (ZARYA)');
    expect(new Date(iss.epochMs).toISOString()).toBe('2026-11-23T21:54:38.454Z');
    expect(records.every(record => createSatRec(record))).toBe(true);
  });

  it('parses three-line TLE text', () => {
    expect(tleRecords.length).toBe(13);
    const iss = tleRecords.find(record => record.noradId === ISS)!;
    expect(iss.name).toBe('ISS (ZARYA)');
    expect(iss.epochMs).toBeCloseTo(getRecord(ISS).epochMs, -1);
  });

  it('gives the same position from OMM and from TLE', () => {
    const fromOmm = getLngLatAlt();
    const fromTle = getLngLatAlt(tleRecords.find(record => record.noradId === ISS));
    expect(Math.abs(fromOmm[0] - fromTle[0])).toBeLessThan(0.01);
    expect(Math.abs(fromOmm[1] - fromTle[1])).toBeLessThan(0.01);
    expect(Math.abs(fromOmm[2] - fromTle[2])).toBeLessThan(1000);
  });
});

describe('satellite orbits: orbit math', () => {
  it('classifies orbits', () => {
    const classOf = (noradId: number) => classifyOrbit(createSatRec(getRecord(noradId))!);
    expect(classOf(ISS)).toBe('LEO');
    expect(classOf(19548)).toBe('GEO'); // TDRS 3
    const classes = records.map(record => classifyOrbit(createSatRec(record)!));
    expect(classes.filter(c => c === 'MEO').length).toBeGreaterThanOrEqual(64); // GPS, Galileo
    expect(classes.filter(c => c === 'HEO').length).toBe(16);
  });

  it('propagates the ISS to a plausible position', () => {
    const [lng, lat, altitude] = getLngLatAlt();
    expect(Math.abs(lng)).toBeLessThanOrEqual(180);
    expect(Math.abs(lat)).toBeLessThan(52);
    expect(altitude).toBeGreaterThan(380e3);
    expect(altitude).toBeLessThan(450e3);
    expect(getOrbitalPeriodMinutes(createSatRec(getRecord(ISS))!)).toBeCloseTo(92.9, 0);
  });

  it('samples one orbit at altitude and the ground track at the surface', () => {
    const satrec = createSatRec(getRecord(ISS))!;
    const orbit = getOrbitPath(satrec, DATE, 180);
    expect(orbit.length).toBe(181);
    expect(orbit.every(([, , altitude]) => altitude > 380e3 && altitude < 450e3)).toBe(true);
    // The first sample is the satellite position.
    const position = getLngLatAlt();
    expect(orbit[0][0]).toBeCloseTo(position[0], 6);
    expect(orbit[0][1]).toBeCloseTo(position[1], 6);

    const track = getGroundTrack(satrec, DATE, 90);
    expect(track.length).toBe(181);
    expect(track.every(point => point[2] === 0)).toBe(true);
    expect(track[90][0]).toBeCloseTo(position[0], 6);
  });

  it('interpolates across the antimeridian the short way', () => {
    const target = new Float64Array(3);
    interpolateLngLatAlt(
      Float64Array.of(179, 10, 1000),
      Float64Array.of(-179, 12, 2000),
      0.25,
      target
    );
    expect(Array.from(target)).toEqual([179.5, 10.5, 1250]);
  });

  it('interpolateLngLatAlt keeps the longitude in [-180, 180) across the antimeridian', () => {
    const target = new Float64Array(3);
    interpolateLngLatAlt(Float64Array.of(179, 0, 0), Float64Array.of(-179, 0, 0), 0.75, target);
    expect(target[0]).toBeCloseTo(-179.5, 9);
    interpolateLngLatAlt(Float64Array.of(-179, 0, 0), Float64Array.of(179, 0, 0), 0.75, target);
    expect(target[0]).toBeCloseTo(179.5, 9);
    interpolateLngLatAlt(Float64Array.of(179, 0, 0), Float64Array.of(-179, 0, 0), 0.5, target);
    expect(target[0]).toBe(-180);
  });
});

describe('space layers: toGpRecords', () => {
  it('converts loader rows to the same records as parseGpRecords', async () => {
    const table = await parse(JSON.stringify(fixture), OMMLoader, {
      omm: {shape: 'object-row-table'}
    });
    const rows = (table as {data: OMMRow[]}).data;
    expect(toGpRecords(rows)).toEqual(records);
  });
});
