// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Captures PNGs of the lab or the film with Playwright Chromium on the real GPU.
 *
 *   yarn node dev/tree-lifecycle/capture.mjs --page lab --query 'growth=0.5&distance=9' --out a.png
 *   yarn node dev/tree-lifecycle/capture.mjs --page stage --time 42 --out b.png
 *   yarn node dev/tree-lifecycle/capture.mjs --page stage --time -0.0167 --world start --out c.png
 *
 * Options:
 *   --page lab|stage    Which page. @default lab
 *   --query QUERY       URL parameters of the view. Stage: of the page, as `only=sky,ground`.
 *   --before A;B;C      Lab views to draw first, in order, such as the frame before this one, so that
 *                       falling things have their rates.
 *   --out FILE          Where to write the PNG.
 *   --time SECONDS      Stage: the second, any number, taken mod the cycle as the stage takes it,
 *                       so -0.1 is seam -0.1, cycle second 63.9, and 125.3 is 61.3. `renderAt`
 *                       draws SECONDS - 1/60 first if it must, round the cycle too.
 *   --world end|start   Stage: a second inside `LOOP.cover` composed from this side of the swap, as
 *                       `?world=` does.
 *   --aspect RATIO      Stage: width over height, as 0.5625 or 9:16. The frame is the largest of this
 *                       shape inside --width and --height, with 1280 for a side not given.
 *   --samples N         Stage: passed to `renderAt`, sub-frames per frame.
 *   --pick X,Y          Stage: also runs the picking pass at this point in CSS pixels, with every layer
 *                       `pickable`, and prints the id of the layer it hit.
 *   --width, --height   Viewport in CSS pixels. @default 1280, 720
 *   --dpr RATIO         Device pixels per CSS pixel. @default 1
 *   --measure FRAMES    Also measures real frame time over this many frames, and prints it as JSON.
 *   --info 1            Stage and lab: prints what each shot drew, as JSON: a stage shot's cycle
 *                       second `t`, its `seam` second and its `world` among it.
 *   --batch FILE        JSON array of shots, in one browser. Lab: {out, query, before, width, height,
 *                       measure}. Stage: {out, time, world, aspect, query, samples, pick, width,
 *                       height, dpr, measure}. Shots in a row with the same size and query share a
 *                       page.
 *
 * Stage shots end with exit code 1 if the page reported an error or GL rejected something.
 *
 * It reuses a dev server at http://127.0.0.1:4393 when one is up, else starts its own Vite server on a
 * free port.
 *
 * The other tools import `loadStoryClock` from here, to take times mod the cycle and judge frames
 * as the stage does.
 */

import {mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The film's clock and its loop checks, exactly as the page has them: `story/beats.ts` and
 * `stage/stage-query.ts`, bundled by esbuild and imported, so a tool takes times mod the cycle and
 * judges frames with the same code and numbers as the stage. It has `CYCLE_SECONDS`, `LOOP`,
 * `BEAT_TABLE`, `getCycleSeconds`, `getSeamSeconds`, `getBeat`, `getFrameSeconds`,
 * `getFrameDifference`, `SEAM_CHECK`, `LOOP_CHECK`, `getLoopPairs` and the rest of both files.
 */
export async function loadStoryClock() {
  const {build} = await import('esbuild');
  const result = await build({
    stdin: {
      contents: "export * from './story/beats.ts';\nexport * from './stage/stage-query.ts';",
      resolveDir: HERE,
      loader: 'ts',
      sourcefile: 'story-clock.ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent'
  });
  const code = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${code}`);
}
const DEFAULT_SERVER = 'http://127.0.0.1:4393';
/** Long side of a stage frame given only its shape. */
const DEFAULT_LONG_SIDE = 1280;
/** Console text that says GL rejected something, unlike a driver's notes on performance. */
const GL_PROBLEM = /GL_INVALID|GL_OUT_OF_MEMORY|WebGL: |CONTEXT_LOST/;

function parseArguments(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!name.startsWith('--')) throw new Error(`Unexpected argument ${name}`);
    options[name.slice(2)] = argv[++i];
  }
  return options;
}

async function isServerUp(url) {
  try {
    const response = await fetch(`${url}/lab.html`, {signal: AbortSignal.timeout(1000)});
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
  const address = server.httpServer.address();
  return {url: `http://127.0.0.1:${address.port}`, close: () => server.close()};
}

async function openPage(browser, url, {width, height, dpr}, problems = new Set()) {
  const context = await browser.newContext({
    viewport: {width, height},
    deviceScaleFactor: dpr
  });
  const page = await context.newPage();
  page.on('pageerror', error => {
    console.error(`[page error] ${error.message}`);
    problems.add(error.message);
  });
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.error(`[console ${message.type()}] ${message.text()}`);
      if (message.type() === 'error' || GL_PROBLEM.test(message.text())) {
        problems.add(message.text());
      }
    }
  });
  await page.goto(url, {waitUntil: 'load', timeout: 120000});
  return {context, page};
}

async function captureLabShot(page, shot) {
  const {query = '', before = '', out, measure} = shot;
  const toParams = text => {
    const params = {};
    for (const [key, value] of new URLSearchParams(text)) {
      params[key] = Number.isFinite(Number(value)) && value !== '' ? Number(value) : value;
    }
    return params;
  };
  for (const step of before.split(';').filter(Boolean)) {
    await page.evaluate(params => window.renderLab(params), toParams(step));
  }
  await page.evaluate(params => window.renderLab(params), toParams(query));
  let result = null;
  if (measure) {
    result = await page.evaluate(frames => window.measureLab(frames), Number(measure));
  }
  if (out) {
    const dataUrl = await page.evaluate(() => window.captureLab());
    const path = resolve(out);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote ${path}`);
  }
  const info = await page.evaluate(() => window.getLabInfo());
  if (info.errors.length) console.error(`[deck errors] ${info.errors.join('\n')}`);
  return {info, measure: result};
}

/** Width over height of 0.5625 or 9:16, or null. */
function parseAspect(aspect) {
  if (aspect === undefined || aspect === null || aspect === '') return null;
  const [width, height = 1] = String(aspect).split(':').map(Number);
  const ratio = width / height;
  if (!(ratio > 0) || !Number.isFinite(ratio)) throw new Error(`Bad aspect ${aspect}`);
  return ratio;
}

/** The viewport of a stage shot, which is its frame. */
function getStageSize({width, height, aspect}) {
  const ratio = parseAspect(aspect);
  if (!ratio) return {width: width ?? 1280, height: height ?? 720};
  const boxWidth = width ?? (height ? height * ratio : DEFAULT_LONG_SIDE);
  const boxHeight = height ?? (width ? width / ratio : DEFAULT_LONG_SIDE);
  const fitted = Math.min(boxWidth / ratio, boxHeight);
  return {width: Math.round(fitted * ratio), height: Math.round(fitted)};
}

function getStageUrl(url, shot, dpr) {
  const query = new URLSearchParams(shot.query ?? '');
  query.set('capture', '1');
  query.set('dpr', String(dpr));
  if (shot.pick) query.set('pickable', '1');
  if (shot.world) query.set('world', shot.world);
  return `${url}/stage.html?${query}`;
}

async function captureStageShot(page, shot) {
  const {time = 0, out, samples, pick, measure} = shot;
  const frame = await page.evaluate(([t, renderOptions]) => window.renderAt(t, renderOptions), [
    Number(time),
    samples ? {samples: Number(samples)} : {}
  ]);
  if (out) {
    const dataUrl = await page.evaluate(() => window.captureStage());
    const path = resolve(out);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote ${path}`);
  }
  const picked = pick
    ? await page.evaluate(([x, y]) => window.pickStage(x, y), String(pick).split(',').map(Number))
    : undefined;
  const measured = measure
    ? await page.evaluate(frames => window.measureStage(frames), Number(measure))
    : null;
  // The picking pass happens after the frame's report, and may have something to add to it.
  const errors = await page.evaluate(() => window.stageErrors);
  return {frame: {...frame, errors, picked}, measure: measured};
}

/** Takes stage shots in order, and returns everything the pages reported as wrong. */
async function captureStageShots(browser, url, shots, cli) {
  const problems = new Set();
  let open = null;
  let openKey = '';
  for (const shot of shots) {
    const size = getStageSize({
      width: shot.width ?? cli.width,
      height: shot.height ?? cli.height,
      aspect: shot.aspect ?? cli.aspect
    });
    const dpr = shot.dpr ?? cli.dpr;
    const key =
      `${size.width}x${size.height}@${dpr}?${shot.query ?? ''}&${Boolean(shot.pick)}` +
      `&${shot.world ?? ''}`;
    if (key !== openKey) {
      await open?.context.close();
      open = await openPage(browser, getStageUrl(url, shot, dpr), {...size, dpr}, problems);
      openKey = key;
      await open.page.evaluate(() => window.motionReady);
    }
    const started = Date.now();
    const {frame, measure} = await captureStageShot(open.page, shot);
    for (const error of frame.errors) problems.add(error);
    if (shot.printInfo || cli.info || measure || shot.pick) {
      console.log(JSON.stringify({out: shot.out, ms: Date.now() - started, measure, ...frame}));
    }
  }
  await open?.context.close();
  return problems;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.world && options.world !== 'end' && options.world !== 'start') {
    throw new Error(`--world is end or start, not ${options.world}`);
  }
  const server = await getServer();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox']
  });
  try {
    const pageName = options.page ?? 'lab';
    const width = Number(options.width ?? 1280);
    const height = Number(options.height ?? 720);
    const dpr = Number(options.dpr ?? 1);
    if (pageName === 'stage') {
      const shots = options.batch
        ? JSON.parse(readFileSync(options.batch, 'utf8'))
        : [
            {
              out: options.out,
              time: options.time,
              world: options.world,
              query: options.query,
              samples: options.samples,
              pick: options.pick,
              measure: options.measure
            }
          ];
      const problems = await captureStageShots(browser, server.url, shots, {
        width: options.width ? Number(options.width) : undefined,
        height: options.height ? Number(options.height) : undefined,
        aspect: options.aspect,
        dpr,
        info: options.info
      });
      if (problems.size) {
        console.error(`[stage] ${problems.size} problem(s):\n${[...problems].join('\n')}`);
        process.exitCode = 1;
      }
    } else {
      const shots = options.batch
        ? JSON.parse(readFileSync(options.batch, 'utf8'))
        : [
            {
              out: options.out,
              query: options.query,
              before: options.before,
              measure: options.measure
            }
          ];
      // Views of one size share a page, so templates and shaders are not built again.
      let open = null;
      let openKey = '';
      for (const shot of shots) {
        const shotWidth = shot.width ?? width;
        const shotHeight = shot.height ?? height;
        const shotDpr = shot.dpr ?? dpr;
        const key = `${shotWidth}x${shotHeight}@${shotDpr}`;
        if (key !== openKey) {
          await open?.context.close();
          const url = `${server.url}/lab.html?dpr=${shotDpr}&${shot.query ?? ''}`;
          open = await openPage(browser, url, {width: shotWidth, height: shotHeight, dpr: shotDpr});
          openKey = key;
          await open.page.evaluate(() => window.motionReady);
        }
        const started = Date.now();
        const {info, measure} = await captureLabShot(open.page, shot);
        if (shot.printInfo || options.info || measure) {
          console.log(JSON.stringify({out: shot.out, ms: Date.now() - started, measure, info}));
        }
      }
      await open?.context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

// Run as a tool, and not when another tool imports `loadStoryClock`.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
