// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Scores every saved render against the MapLibre reference render of the same scene, and writes
 * the report (see `src/scorer.ts`). Node 22.18 or later runs it as is (type stripping):
 *
 *   node dev/basemap-conformance/scripts/score.ts [output directory]
 *
 * The renders are checked against the corpus of the checkout that holds this script: its scenes,
 * its styles and its fixtures. Run the script of the same checkout that the runner rendered.
 *
 * It only reports: it exits with an error when it cannot read the renders, never on a score.
 */

import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureRootsOf} from '../src/provenance.ts';
import {scoreRenders} from '../src/scorer.ts';

const output = resolve(process.argv[2] || fileURLToPath(new URL('../__output__', import.meta.url)));
const checkout = fileURLToPath(new URL('../../..', import.meta.url));

const {report} = scoreRenders({output, fixtureRoots: fixtureRootsOf(checkout)});
console.log(report);
