// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {json2satrec, type OMMJsonObject, type SatRec} from 'satellite.js';

/**
 * GP element sets and their SGP4 state. This module imports only `satellite.js`, so the
 * propagation worker can use it; `load-gp-records.ts` holds the loaders.gl parsing.
 */

/** One general perturbations (GP) element set, from OMM JSON or from a TLE. */
export type GpRecord = {
  /** Object name, or the catalog number when the source has no name. */
  name: string;
  /** Satellite catalog number. */
  noradId: number;
  /** Element set epoch, in milliseconds since the Unix epoch. */
  epochMs: number;
  /** Element set in the OMM JSON form that `satellite.js` reads. */
  omm: OMMJsonObject;
};

/** Text formats that CelesTrak serves: OMM JSON (`FORMAT=json`) and TLE (`FORMAT=tle`). */
export type GpFormat = 'json' | 'tle';

/** Creates the SGP4 state for a record. Returns `null` when the elements are invalid. */
export function createSatRec(record: GpRecord): SatRec | null {
  try {
    const satrec = json2satrec(record.omm);
    return satrec.error ? null : satrec;
  } catch {
    return null;
  }
}
