// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  alpha5ToNumber,
  json2satrec,
  twoline2satrec,
  type OMMJsonObject,
  type SatRec
} from 'satellite.js';

/** One general perturbations (GP) element set, from OMM JSON or from a TLE. */
export type GpRecord = {
  name: string;
  noradId: number;
  /** Element set epoch, in milliseconds since the Unix epoch. */
  epochMs: number;
  omm?: OMMJsonObject;
  tle?: [string, string];
};

/** Parses CelesTrak OMM JSON (`FORMAT=json`): an array of OMM objects. */
export function parseOmmJson(data: string | unknown[]): GpRecord[] {
  const objects = (typeof data === 'string' ? JSON.parse(data) : data) as OMMJsonObject[];
  if (!Array.isArray(objects)) {
    throw new Error('OMM JSON must be an array of element sets');
  }
  return objects.map(omm => ({
    name: omm.OBJECT_NAME,
    noradId: Number(omm.NORAD_CAT_ID),
    // CelesTrak writes EPOCH in UTC without a zone suffix.
    epochMs: Date.parse(omm.EPOCH.endsWith('Z') ? omm.EPOCH : `${omm.EPOCH}Z`),
    omm
  }));
}

/** Parses TLE text in the two-line or the three-line (name line) form. */
export function parseTleText(text: string): GpRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
  const records: GpRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('1 ') || !lines[i + 1]?.startsWith('2 ')) {
      continue;
    }
    const line1 = lines[i];
    const line2 = lines[i + 1];
    const previous = lines[i - 1];
    const name = previous && !/^[12] /.test(previous) ? previous.replace(/^0 /, '').trim() : '';
    // Catalog numbers above 99999 use the Alpha-5 form, for example `A0057`.
    const noradId = alpha5ToNumber(line1.slice(2, 7));
    records.push({
      name: name || String(noradId),
      noradId,
      epochMs: getTleEpochMs(line1),
      tle: [line1, line2]
    });
    i++;
  }
  return records;
}

/** Creates the SGP4 state for a record. Returns `null` when the elements are invalid. */
export function createSatRec(record: GpRecord): SatRec | null {
  try {
    const satrec = record.omm
      ? json2satrec(record.omm)
      : twoline2satrec(record.tle![0], record.tle![1]);
    return satrec.error ? null : satrec;
  } catch {
    return null;
  }
}

/** Reads the epoch (columns 19-32, `YYDDD.DDDDDDDD`) of TLE line 1. */
function getTleEpochMs(line1: string): number {
  const year2 = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  const year = year2 < 57 ? 2000 + year2 : 1900 + year2;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000;
}
