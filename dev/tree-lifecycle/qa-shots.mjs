// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The standard set of `TreeLayer` views, so each round of work is judged against the same pictures.
 *
 *   yarn node dev/tree-lifecycle/qa-shots.mjs --out /scratch/round1
 *   yarn node dev/tree-lifecycle/qa-shots.mjs --out /scratch/round1 --only hero,leaf-macro
 *   yarn node dev/tree-lifecycle/qa-shots.mjs --out /scratch/round1 --only film --times 36.2,-0.1
 *
 * Writes one PNG per shot and a contact sheet per group, `sheet-<group>.png`. `--only` takes group
 * or shot names. At orbit 0 the camera stands south of the tree, on -y, so a sun at bearing 180 is
 * behind the camera and one at bearing 0 is behind the tree.
 *
 * The lab's groups show one tree in the lab. The `film` group shows `TreeLayer` in the film, on the
 * stage at 9:16, at cycle seconds, and only when asked for, with `--only film` or `--times`, which
 * gives other seconds, each taken mod the cycle as the stage takes it, so -0.1 is cycle second
 * 63.9. `--samples` is their sub-frames. @default 1
 */

import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadStoryClock} from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `TreeLayer` in the film, by cycle second: bloom, the storm's peaks and eye, dieback, Year 30. */
const FILM_SHOTS = [
  ['film-bloom', 19.6],
  ['film-first-wall', 36.2],
  ['film-eye', 39.2],
  ['film-second-wall', 42.2],
  ['film-dieback', 50.2],
  ['film-year-30', 57.6],
  ['film-cover', 61.3]
];
/** The size of a film shot: a 9:16 frame, kept small. */
const FILM_SIZE = {width: 540, height: 960};

/** `renderLab` keeps what it is not given, so every shot first resets the lab to its defaults. */
const RESET =
  'species=citrus&quality=photoreal&growth=1&health=1&foliage=1&flush=0&leanAngle=0&leanBearing=90&' +
  'damage=0&decay=0&count=1&fruit=0&ripeness=1&fruitFall=0&blossoms=0&petalFall=0&wetness=0&frost=0&fogDensity=0&' +
  'sun=52&sunBearing=135&sunIntensity=2.1&ambient=0.85&' +
  'wind=0&windBearing=80&time=10&seed=1&height=7&crown=3.4&distance=16&orbit=20&pitch=10&targetX=0&' +
  'targetY=0&targetZ=3.2&fov=34&far=0&ground=1&shadow=1&cast=1&occluder=0&lodBias=0';

const HERO = 'height=9&crown=5&growth=0.97&seed=1&orbit=0';
const GROVE_TREE = 'height=6.2&crown=3&growth=0.8&seed=2&orbit=0';
const SUN = 'sun=52&sunBearing=130';
/** One fruit of the hero's first 900, on the sun side with nothing in front of it. */
const ONE_FRUIT = 'targetX=0.385&targetY=-3.791&targetZ=3.27';

/** Group name to [shot name, query, optional before]. */
const SHOTS = {
  hero: [
    ['hero-noon', `${HERO}&distance=26&pitch=6&targetZ=4.2&sun=62&sunBearing=130`],
    ['hero-morning', `${HERO}&distance=26&pitch=6&targetZ=4.2&sun=22&sunBearing=100`],
    ['hero-backlit', `${HERO}&distance=26&pitch=4&targetZ=4.2&sun=13&sunBearing=350`],
    ['hero-overcast', `${HERO}&distance=26&pitch=6&targetZ=4.2&sun=60&sunIntensity=0.1&ambient=1.6`],
    ['hero-moon', `${HERO}&distance=26&pitch=6&targetZ=4.2&sun=40&sunIntensity=0.2&ambient=0.1`],
    ['hero-top', `${HERO}&distance=30&pitch=38&targetZ=3.5&${SUN}`]
  ],
  close: [
    ['crown-7m', `${HERO}&distance=7&pitch=4&targetY=-3&targetZ=3.2&${SUN}`],
    ['crown-under', `${HERO}&distance=4&pitch=-14&targetY=-2&targetZ=1.2&${SUN}`],
    ['leaf-surface', `${HERO}&distance=1.6&pitch=4&targetY=-4.6&targetZ=3.4&${SUN}`],
    ['leaf-macro', `${HERO}&distance=0.45&pitch=4&targetY=-4.7&targetZ=3.4&${SUN}`],
    ['leaf-backlit', `${HERO}&distance=0.6&pitch=4&targetY=-4.7&targetZ=3.4&sun=18&sunBearing=350`],
    ['trunk', `${HERO}&foliage=0&distance=2.2&pitch=4&targetZ=0.8&${SUN}`],
    ['fork', `${HERO}&foliage=0&distance=2.4&pitch=2&targetZ=2&${SUN}`],
    ['bare', `${HERO}&foliage=0&distance=24&pitch=6&targetZ=4&${SUN}`]
  ],
  growth: [
    ['g0.006', `height=9&crown=5&seed=1&orbit=0&growth=0.006&distance=0.22&pitch=4&targetZ=0.03&${SUN}`],
    ['g0.02', `height=9&crown=5&seed=1&orbit=0&growth=0.02&distance=0.8&pitch=4&targetZ=0.18&${SUN}`],
    ['g0.075', `height=9&crown=5&seed=1&orbit=0&growth=0.075&distance=2.6&pitch=4&targetZ=0.6&${SUN}`],
    ['g0.17', `height=9&crown=5&seed=1&orbit=0&growth=0.17&distance=5&pitch=4&targetZ=1.2&${SUN}`],
    ['g0.32', `height=9&crown=5&seed=1&orbit=0&growth=0.32&distance=10&pitch=4&targetZ=2.1&${SUN}`],
    ['g0.6', `height=9&crown=5&seed=1&orbit=0&growth=0.6&distance=18&pitch=5&targetZ=3.4&${SUN}`]
  ],
  grove: [
    ['grove-near', `${GROVE_TREE}&count=100&distance=26&pitch=8&targetZ=2.4&orbit=24&${SUN}`],
    ['grove-mid', `${GROVE_TREE}&count=100&distance=55&pitch=12&targetZ=2&orbit=24&${SUN}`],
    ['grove-wide', `${GROVE_TREE}&count=100&distance=110&pitch=20&targetZ=1&orbit=24&${SUN}`],
    ['grove-low-sun', `${GROVE_TREE}&count=100&distance=40&pitch=7&targetZ=2.4&orbit=24&sun=11&sunBearing=300`]
  ],
  fruit: [
    ['fruit-tree', `${HERO}&fruit=900&distance=26&pitch=6&targetZ=4.2&${SUN}`],
    ['fruit-near', `${HERO}&fruit=900&distance=2.2&pitch=4&targetY=-4.4&targetZ=2.8&${SUN}`],
    ['fruit-green', `${HERO}&fruit=900&ripeness=0.15&distance=2.2&pitch=4&targetY=-4.4&targetZ=2.8&${SUN}`],
    ['fruit-turning', `${HERO}&fruit=900&ripeness=0.55&distance=7&pitch=4&targetY=-3&targetZ=3.2&${SUN}`],
    ['fruit-back', `${HERO}&fruit=900&distance=2.2&pitch=4&targetY=-4.4&targetZ=2.8&sun=16&sunBearing=350`],
    ['fruit-mid', `${HERO}&fruit=900&distance=4.5&pitch=4&targetX=1.2&targetY=-3.4&targetZ=3.2&${SUN}`],
    ['fruit-hang', `${HERO}&fruit=900&${ONE_FRUIT}&distance=0.75&pitch=4&${SUN}`],
    ['fruit-macro', `${HERO}&fruit=900&${ONE_FRUIT}&distance=0.3&pitch=4&${SUN}`],
    ['fruit-macro-break', `${HERO}&fruit=900&ripeness=0.5&${ONE_FRUIT}&distance=0.3&pitch=4&${SUN}`],
    ['fruit-break-near', `${HERO}&fruit=900&ripeness=0.45&distance=2.2&pitch=4&targetY=-4.4&targetZ=2.8&${SUN}`],
    ['fruit-wet', `${HERO}&fruit=900&wetness=1&${ONE_FRUIT}&distance=0.5&pitch=4&sun=40&sunIntensity=0.5&ambient=1.4`],
    ['fruit-frost', `${HERO}&fruit=900&frost=1&${ONE_FRUIT}&distance=0.5&pitch=4&sun=8&sunIntensity=0.9&sunBearing=120&ambient=0.9`],
    ['fruit-fog', `${HERO}&fruit=900&fogDensity=0.012&distance=26&pitch=6&targetZ=4.2&${SUN}`],
    [
      'fruit-fall',
      `${HERO}&fruit=900&fruitFall=0.5&time=10&distance=13&pitch=4&targetZ=2.6&${SUN}`,
      `${HERO}&fruit=900&fruitFall=0.497&time=9.983&distance=13&pitch=4&targetZ=2.6&${SUN}`
    ],
    ['fruit-ground', `${HERO}&fruit=900&fruitFall=1&distance=4.5&pitch=22&targetY=-5&targetZ=0.3&${SUN}`],
    ['blossom-tree', `${HERO}&blossoms=9000&distance=26&pitch=6&targetZ=4.2&${SUN}`],
    ['blossom-near', `${HERO}&blossoms=9000&distance=2.2&pitch=4&targetY=-4.4&targetZ=2.8&${SUN}`],
    ['blossom-macro', `${HERO}&blossoms=9000&targetX=0.395&targetY=-3.791&targetZ=3.357&distance=0.24&pitch=4&${SUN}`],
    [
      'petal-fall',
      `${HERO}&blossoms=9000&petalFall=0.5&time=10&distance=13&pitch=4&targetZ=2.6&${SUN}`,
      `${HERO}&blossoms=9000&petalFall=0.497&time=9.983&distance=13&pitch=4&targetZ=2.6&${SUN}`
    ],
    ['petal-ground', `${HERO}&blossoms=9000&petalFall=1&distance=4.5&pitch=22&targetY=-5&targetZ=0.3&${SUN}`]
  ],
  events: [
    ['flush', `${HERO}&flush=1&distance=7&pitch=4&targetY=-3&targetZ=3.2&${SUN}`],
    ['health-low', `${GROVE_TREE}&health=0.25&distance=16&pitch=6&targetZ=2.6&${SUN}`],
    [
      'shedding',
      `${GROVE_TREE}&foliage=0.5&time=10&distance=16&pitch=6&targetZ=2.6&windBearing=80&wind=0.2&${SUN}`,
      `${GROVE_TREE}&foliage=0.52&time=9.98&distance=16&pitch=6&targetZ=2.6&windBearing=80&wind=0.2&${SUN}`
    ],
    ['wind-half', `${GROVE_TREE}&wind=0.5&windBearing=80&time=11&distance=16&pitch=6&targetZ=2.6&${SUN}`],
    ['wind-full', `${GROVE_TREE}&wind=1&windBearing=80&time=13&distance=16&pitch=6&targetZ=2.6&${SUN}`],
    ['broken', `${GROVE_TREE}&damage=0.7&foliage=0.25&health=0.6&distance=16&pitch=6&targetZ=2.6&${SUN}`],
    ['fallen-fresh', `${GROVE_TREE}&leanAngle=86&distance=15&pitch=12&targetZ=0.8&${SUN}`],
    ['wreck-mid', `${GROVE_TREE}&leanAngle=86&damage=0.6&decay=0.35&health=0.1&foliage=0.15&distance=15&pitch=12&targetZ=0.8&${SUN}`],
    ['wreck-late', `${GROVE_TREE}&leanAngle=86&damage=0.9&decay=0.8&foliage=0&distance=15&pitch=12&targetZ=0.5&${SUN}`]
  ]
};

function parseArguments(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) options[argv[i].replace(/^--/, '')] = argv[i + 1];
  return options;
}

/** Tiles images into one, each cell cropped to fill. */
function makeSheet(files, out, columns = 3, width = 640, height = 360) {
  const inputs = files.flatMap(file => ['-i', file]);
  const scaled = files.map(
    (_, i) =>
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[v${i}];`
  );
  const layout = files
    .map((_, i) => `${(i % columns) * width}_${Math.floor(i / columns) * height}`)
    .join('|');
  const references = files.map((_, i) => `[v${i}]`).join('');
  const stack =
    files.length > 1
      ? `${references}xstack=inputs=${files.length}:layout=${layout}:fill=black[out]`
      : `${references}null[out]`;
  spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', scaled.join('') + stack, '-map', '[out]', out],
    {stdio: 'inherit'}
  );
}

/** Runs capture.mjs on a batch of shots, and stops with its code if it fails. */
function captureBatch(batch, batchFile, extra) {
  writeFileSync(batchFile, JSON.stringify(batch, null, 1));
  const dpr = options.dpr ? ['--dpr', options.dpr] : [];
  const capture = spawnSync(
    process.execPath,
    [join(HERE, 'capture.mjs'), '--batch', batchFile, ...dpr, ...extra],
    {stdio: 'inherit'}
  );
  if (capture.status !== 0) process.exit(capture.status ?? 1);
}

const options = parseArguments(process.argv.slice(2));
if (!options.out) throw new Error('--out DIRECTORY is required');
const directory = resolve(options.out);
mkdirSync(directory, {recursive: true});

// Times alone ask for the film's shots alone.
const only = options.only
  ? new Set(options.only.split(','))
  : options.times
    ? new Set(['film'])
    : null;
const isChosen = (group, name) => !only || only.has(group) || only.has(name);
const batch = [];
const sheets = [];
for (const [group, shots] of Object.entries(SHOTS)) {
  const chosen = shots.filter(([name]) => isChosen(group, name));
  for (const [name, query, before] of chosen) {
    batch.push({
      out: join(directory, `${name}.png`),
      query: `${RESET}&${query}`,
      before: before && `${RESET}&${before}`
    });
  }
  if (chosen.length > 1) {
    sheets.push({group, files: chosen.map(([name]) => join(directory, `${name}.png`))});
  }
}

// The film's shots, by cycle second, named by the second the stage draws.
const {getCycleSeconds} = await loadStoryClock();
const filmShots = options.times
  ? options.times.split(',').map(text => {
      const seconds = getCycleSeconds(Number(text));
      return [`film-t${seconds.toFixed(2)}`, seconds];
    })
  : FILM_SHOTS.map(([name, seconds]) => [`${name}-${seconds}`, seconds]);
// On the stage, so only when asked for, by name or with times.
const film = filmShots.filter(
  ([name]) => options.times || (only && (only.has('film') || only.has(name)))
);
const filmBatch = film.map(([name, time]) => ({
  out: join(directory, `${name}.png`),
  time,
  samples: options.samples ?? 1
}));

if (batch.length > 0) captureBatch(batch, join(directory, 'batch.json'), []);
if (filmBatch.length > 0) {
  const size = ['--width', String(FILM_SIZE.width), '--height', String(FILM_SIZE.height)];
  captureBatch(filmBatch, join(directory, 'film-batch.json'), [
    '--page',
    'stage',
    '--aspect',
    '9:16',
    ...size
  ]);
}
for (const {group, files} of sheets) makeSheet(files, join(directory, `sheet-${group}.png`));
if (film.length > 1) {
  const files = film.map(([name]) => join(directory, `${name}.png`));
  makeSheet(files, join(directory, 'sheet-film.png'), 4, FILM_SIZE.width / 2, FILM_SIZE.height / 2);
}
