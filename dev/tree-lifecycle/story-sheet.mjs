// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * A contact sheet of the film, for a reviewer: frames at evenly spaced or chosen times, each with
 * its cycle second, its seam second near the swap, and its beat, tiled into one PNG. The frames are
 * whole renders, overlay and all.
 *
 *   yarn node dev/tree-lifecycle/story-sheet.mjs --count 24 --out sheet.png
 *   yarn node dev/tree-lifecycle/story-sheet.mjs --times 61.3,63.9,0.1,36.2 --samples 16 \
 *     --columns 2 --out sheet.png
 *   yarn node dev/tree-lifecycle/story-sheet.mjs --preset acceptance --samples 16 --out sheet.png
 *
 * Every time is taken mod the cycle, as the stage takes it: -0.1 is seam -0.1, cycle second 63.9,
 * and 125.3 is 61.3.
 *
 * Options:
 *   --count N             Frames evenly spaced over --from to --to. @default 24
 *   --times A,B,C         These seconds instead. One may name its side of the swap, as 0.1:end, for
 *                         a second inside `LOOP.cover` composed from the end world.
 *   --preset acceptance   The spec's acceptance stills instead, in the file's order from its first
 *                         frame, with 0.1 from the end world beside 0.1 from the start, at 9:16
 *                         unless --aspect or --height says otherwise.
 *   --from, --to          The stretch to space them over. @default the cycle in the file's order,
 *                         from `LOOP.fileStart` round to the frame before it
 *   --columns N           Columns of the sheet. @default 6, or 3 for portrait
 *   --cell WIDTH          Width of a cell in pixels. @default 480, or 300 for portrait
 *   --width, --height     Size of the frames rendered. @default 1920, 1080
 *   --aspect RATIO        Width over height, as 9:16, in place of --height.
 *   --samples N           Sub-frames per frame, at least: a wide lens takes more. @default 1
 *   --shutter FRACTION    Of a frame, at full speed: slow motion closes it by its time rate.
 *                         @default 0.5
 *   --aperture-scale S    Of `camera.aperture`. @default 1
 *   --query QUERY         More URL parameters of the page, such as `only=sky,ground`.
 *   --labels 0            No time and beat on the cells.
 *   --keep FOLDER         Also writes each frame, whole, to this folder.
 *
 * Ends with exit code 1 if the page reports an error. It reuses a dev server at
 * http://127.0.0.1:4393 when one is up, else starts its own Vite server on a free port and stops
 * it.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {loadStoryClock} from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVER = 'http://127.0.0.1:4393';
/** Console text that says GL rejected something, unlike a driver's notes on performance. */
const GL_PROBLEM = /GL_INVALID|GL_OUT_OF_MEMORY|WebGL: |CONTEXT_LOST/;
/** A seam second this near the swap shows on a cell's label. */
const SEAM_LABEL_SECONDS = 4;

/**
 * The spec's acceptance stills, in cycle seconds, in the file's order from its first frame. The
 * start world's 0.1 is judged against the end world's, so both are on the sheet.
 */
const ACCEPTANCE_STILLS = [
  {t: 61.3, note: 'file frame 1, cover'},
  {t: 62.6, note: 'slow-motion fall'},
  {t: 63.9, note: 'end world, rind'},
  {t: 0.1, world: 'end', note: 'end world forced'},
  {t: 0.1, note: 'start world'},
  {t: 1.09, note: 'impact'},
  {t: 15.4, note: 'planting, furrow'},
  {t: 29.4, note: 'grove magic'},
  {t: 33.2, note: 'arrival'},
  {t: 36.2, note: 'first wall, peak'},
  {t: 37.47, note: 'lightning'},
  {t: 39.2, note: 'the eye'},
  {t: 39.9, note: "the eye's mirror"},
  {t: 42.2, note: 'second wall, peak'},
  {t: 43.45, note: 'crown into the water'},
  {t: 44.9, note: 'clearing'},
  {t: 46.4, note: 'peak flood'},
  {t: 48.5, note: 'recession'},
  {t: 50.2, note: 'roots drown'},
  {t: 57.6, note: 'Year 30 sunrise'},
  {t: 61.27, note: 'file frame 1920'}
];

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error(`Options come in pairs, --name value. Got ${name}`);
    }
    options[name.slice(2)] = argv[index + 1];
  }
  return options;
}

/**
 * The cells to show, each a second and the side of the swap it is asked for: as given, the
 * acceptance preset, or evenly spaced with both ends in, or, over a whole cycle, its end left out,
 * as it is its start again. Seconds are taken mod the cycle.
 */
function getSheetCells({times, preset, count, from, to}, clock) {
  if (preset === 'acceptance') return ACCEPTANCE_STILLS.map(cell => ({...cell}));
  if (preset) throw new Error(`No preset ${preset}`);
  if (times) {
    return times.split(',').map(text => {
      const [seconds, world] = text.split(':');
      if (world && world !== 'end' && world !== 'start') throw new Error(`No world ${world}`);
      return {t: Number(seconds), world};
    });
  }
  const whole = to - from >= clock.CYCLE_SECONDS;
  const steps = whole ? count : Math.max(count - 1, 1);
  return Array.from({length: count}, (_, index) => ({t: from + ((to - from) * index) / steps}));
}

/** A cell's label: cycle second, seam second near the swap, beat, and any note. */
function getLabel(cell, frame, clock) {
  const seam = frame.seam ?? clock.getSeamSeconds(frame.t);
  const world = cell.world ? ` ${frame.world}` : '';
  const seamText =
    Math.abs(seam) < SEAM_LABEL_SECONDS
      ? `  seam ${seam < 0 ? '−' : '+'}${Math.abs(seam).toFixed(2)}${world}`
      : '';
  return `${frame.t.toFixed(2)} s${seamText}  ${frame.beat}${cell.note ? `  ${cell.note}` : ''}`;
}

async function isServerUp(url) {
  try {
    const response = await fetch(`${url}/stage.html`, {signal: AbortSignal.timeout(1000)});
    return response.ok;
  } catch {
    return false;
  }
}

async function getServer() {
  if (await isServerUp(DEFAULT_SERVER)) return {url: DEFAULT_SERVER, close: async () => {}};
  const {createServer} = await import('vite');
  const server = await createServer({
    configFile: resolve(HERE, 'vite.config.ts'),
    server: {port: 0, strictPort: false, host: '127.0.0.1'},
    logLevel: 'warn'
  });
  await server.listen();
  const {port} = server.httpServer.address();
  return {url: `http://127.0.0.1:${port}`, close: () => server.close()};
}

function getFrameSize(options) {
  const width = Number(options.width ?? (options.aspect ? 1080 : 1920));
  if (options.height && !options.aspect) return {width, height: Number(options.height)};
  if (!options.aspect) return {width, height: Math.round((width * 9) / 16)};
  const [across, down = 1] = options.aspect.split(':').map(Number);
  return {width, height: Math.round((2 * (width * down)) / across / 2)};
}

/** In the page: draws one cell of the sheet, from a data URL of a frame. */
async function drawCell({dataUrl, index, columns, cellWidth, cellHeight, label}) {
  const sheet = window.storySheet;
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const x = (index % columns) * cellWidth;
  const y = Math.floor(index / columns) * cellHeight;
  const context = sheet.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, x, y, cellWidth, cellHeight);
  if (label) {
    const size = Math.max(11, Math.round(cellWidth / 34));
    context.font = `500 ${size}px "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const width = context.measureText(label).width;
    context.fillStyle = 'rgba(6, 8, 10, 0.62)';
    context.fillRect(x, y, width + size * 1.1, size * 1.7);
    context.fillStyle = 'rgba(246, 243, 234, 0.95)';
    context.textBaseline = 'alphabetic';
    context.fillText(label, x + size * 0.55, y + size * 1.2);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.out) throw new Error('--out is required');
  const clock = await loadStoryClock();
  // The acceptance stills are portrait frames of the film as it is posted.
  if (options.preset === 'acceptance' && !options.aspect && !options.height) {
    options.aspect = '9:16';
  }
  const size = getFrameSize(options);
  const isPortrait = size.width < size.height;
  const from = Number(options.from ?? clock.LOOP.fileStart);
  const cells = getSheetCells(
    {
      times: options.times,
      preset: options.preset,
      count: Number(options.count ?? 24),
      from,
      to: Number(options.to ?? from + clock.CYCLE_SECONDS)
    },
    clock
  );
  const columns = Number(options.columns ?? (isPortrait ? 3 : 6));
  const cellWidth = Number(options.cell ?? (isPortrait ? 300 : 480));
  const cellHeight = Math.round((cellWidth * size.height) / size.width);
  const samples = Number(options.samples ?? 1);
  const renderOptions = {
    samples,
    adaptive: samples > 1,
    shutter: options.shutter === undefined ? undefined : Number(options.shutter),
    apertureScale:
      options['aperture-scale'] === undefined ? undefined : Number(options['aperture-scale'])
  };

  const server = await getServer();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: [
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--disable-gpu-sandbox',
      // A sub-frame of the storm on a busy GPU may take longer than the watchdog allows.
      '--disable-gpu-watchdog'
    ]
  });
  const problems = new Set();
  try {
    const context = await browser.newContext({viewport: size, deviceScaleFactor: 1});
    const page = await context.newPage();
    page.on('pageerror', error => problems.add(error.message));
    page.on('console', message => {
      if (message.type() === 'error' || GL_PROBLEM.test(message.text()))
        problems.add(message.text());
    });
    const query = new URLSearchParams(options.query ?? '');
    query.set('capture', '1');
    query.set('dpr', '1');
    if (samples > 1) query.set('msaa', '0');
    await page.goto(`${server.url}/stage.html?${query}`, {waitUntil: 'load', timeout: 180000});
    await page.evaluate(() => window.motionReady);
    const rows = Math.ceil(cells.length / columns);
    await page.evaluate(
      ({width, height}) => {
        window.storySheet = document.createElement('canvas');
        window.storySheet.width = width;
        window.storySheet.height = height;
        window.storySheet.getContext('2d').fillStyle = '#000';
        window.storySheet.getContext('2d').fillRect(0, 0, width, height);
      },
      {width: columns * cellWidth, height: rows * cellHeight}
    );
    if (options.keep) mkdirSync(resolve(options.keep), {recursive: true});
    const started = Date.now();
    for (const [index, cell] of cells.entries()) {
      // The stage takes the second mod the cycle, and says which it drew.
      const frame = await page.evaluate(
        ([t, render]) => window.renderAt(t, render),
        [cell.t, {...renderOptions, ...(cell.world ? {world: cell.world} : {})}]
      );
      for (const error of frame.errors) problems.add(error);
      const dataUrl = await page.evaluate(() => window.captureStage());
      if (options.keep) {
        const name = `t${frame.t.toFixed(2).padStart(5, '0')}${cell.world ? `-${cell.world}` : ''}`;
        const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
        writeFileSync(resolve(options.keep, `${name}.png`), bytes);
      }
      await page.evaluate(drawCell, {
        dataUrl,
        index,
        columns,
        cellWidth,
        cellHeight,
        label: options.labels === '0' ? '' : getLabel(cell, frame, clock)
      });
      console.log(`${index + 1}/${cells.length} ${getLabel(cell, frame, clock)}`);
    }
    const sheet = await page.evaluate(() => window.storySheet.toDataURL('image/png'));
    const path = resolve(options.out);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log(`wrote ${path}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  } finally {
    await browser.close();
    await server.close();
  }
  if (problems.size > 0) {
    console.error(`[sheet] ${problems.size} problem(s):\n${[...problems].join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`${error.stack ?? error}`);
  process.exitCode = 1;
});
