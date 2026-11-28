// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {parse} from '@loaders.gl/core';
import {OMMLoader, type OMMRow} from '@loaders.gl/scientific/omm';
import {TLELoader} from '@loaders.gl/scientific/tle';
import type {OMMJsonObject} from 'satellite.js';

import type {GpFormat, GpRecord} from './gp-records';

/**
 * Parses CelesTrak GP data with the loaders.gl `OMMLoader` or `TLELoader`. Both loaders return
 * the same OMM rows, so both formats reach SGP4 through `json2satrec`.
 */
export async function parseGpRecords(text: string, format: GpFormat): Promise<GpRecord[]> {
  const table =
    format === 'json'
      ? await parse(text, OMMLoader, {omm: {shape: 'object-row-table'}})
      : await parse(text, TLELoader, {tle: {shape: 'object-row-table'}});
  if (!('shape' in table) || table.shape !== 'object-row-table') {
    throw new Error('Expected an object-row table of element sets');
  }
  return (table.data as OMMRow[]).map(row => {
    const noradId = row.NORAD_CAT_ID ?? 0;
    return {
      name: row.OBJECT_NAME || String(noradId),
      noradId,
      epochMs: Date.parse(row.EPOCH.endsWith('Z') ? row.EPOCH : `${row.EPOCH}Z`),
      omm: toOmmJson(row)
    };
  });
}

/**
 * Converts a loader row to the OMM JSON object of `satellite.js`. The loader gives `null` for
 * an optional field that the source omits; `satellite.js` needs a value, so zero stands in.
 */
function toOmmJson(row: OMMRow): OMMJsonObject {
  return {
    OBJECT_NAME: row.OBJECT_NAME ?? '',
    OBJECT_ID: row.OBJECT_ID ?? '',
    EPOCH: row.EPOCH,
    MEAN_MOTION: row.MEAN_MOTION,
    ECCENTRICITY: row.ECCENTRICITY,
    INCLINATION: row.INCLINATION,
    RA_OF_ASC_NODE: row.RA_OF_ASC_NODE,
    ARG_OF_PERICENTER: row.ARG_OF_PERICENTER,
    MEAN_ANOMALY: row.MEAN_ANOMALY,
    NORAD_CAT_ID: row.NORAD_CAT_ID ?? 0,
    ELEMENT_SET_NO: row.ELEMENT_SET_NO ?? 0,
    REV_AT_EPOCH: row.REV_AT_EPOCH ?? 0,
    BSTAR: row.BSTAR ?? 0,
    MEAN_MOTION_DOT: row.MEAN_MOTION_DOT ?? 0,
    MEAN_MOTION_DDOT: row.MEAN_MOTION_DDOT ?? 0
  };
}
