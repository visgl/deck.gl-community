// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Runs the field benchmark on the real GPU, with Playwright Chromium under ANGLE Metal, and prints what each path
 * cost, and compares it to the selected frame budget. See `field.ts` for what a frame is and how to add an
 * implementation.
 *
 *   yarn node dev/tree-lifecycle/field/bench-field.mjs --impl photoreal --paths orbit-wide,dive --runs 3 --out DIR
 *
 * On a laptop, after `yarn` and `yarn playwright:install`, this alone says whether it stays smooth there:
 *
 *   yarn node dev/tree-lifecycle/field/bench-field.mjs --impl photoreal
 *
 * It uses the dev server at http://127.0.0.1:4393 when one is up, and otherwise starts one of its own for the run.
 *
 * Options:
 *   --impl A,B            `impl-A.ts`, `impl-B.ts` in the same batch. @default photoreal
 *   --config TAG:QUERY    One configuration of the batch, repeatable: `--config noshadow:shadows=0`. TAG names it in
 *                         the table and on disk, and QUERY is on top of all else. `server=URL` in QUERY draws it from
 *                         another dev server, and `frames=N` gives it its own number of frames, as a batch may hold
 *                         one that takes a second a frame and one that takes ten milliseconds. With these, `--impl`
 *                         is the default for those that do not say.
 *   --paths A,B           Names, or `default`, or `all`, which adds the tween paths by accessor. @default default
 *   --runs N              Rounds. Every round runs every path of every configuration, each in a new browser, so that
 *                         nothing is cached and bursts of load fall on all alike. @default 3
 *   --out DIR             JSON per run and pictures, in DIR/TAG/, and DIR/summary.json. @default the OS's temp folder
 *   --server URL          The dev server to use, and never start one. @default http://127.0.0.1:4393, or a new one
 *   --bar NAME            `m4`, the M4 Pro comparison budget: GPU p99 under 4 ms and main thread p99 under 6 ms, on
 *                         top of a configuration of `impl=none` if the batch has one, as the floor. Or `laptop`, p99
 *                         frame under 16.7 ms and no frame over 33 ms. @default `m4` on an M4, else `laptop`
 *   --frames N            Frames of every path but `load`, in place of its own number.
 *   --frameScale X        Multiplies the frames of every path but `load`: the same path, in larger steps.
 *   --maxSeconds S        A path stops after this, marked truncated. @default 180
 *   --profile 1           CDP Profiler over the measured frames: DIR/TAG/PATH-runN.cpuprofile, and the top functions.
 *   --heapProfile 1       CDP sampling heap profiler over the measured frames, counting what was collected too: which
 *                         functions allocate how many KB per frame, in DIR/TAG/PATH-runN.heap.json and printed.
 *   --top N               How many functions of a profile to print. @default 25
 *   --png all             A picture from every run, not only the first.
 *   --pictureWidth N      Width of a path's picture. @default 1280, as a full-size PNG of a field runs to megabytes
 *   --retries N           Runs that fail, such as on a shader someone is editing, get this many more tries. @default 2
 *   --retryWait S         Seconds before one. @default 60
 *   --gpuIdle PERCENT     Before each run, waits until macOS says the GPU is less busy than this, as other agents use
 *                         it in bursts. @default 100, which never waits
 *   --gpuIdleWait S       And runs anyway after this long, and says so in its JSON. @default 120
 *   --query QUERY         URL parameters for every configuration, like `count=5000&shadows=0`.
 *   --ANYTHING VALUE      The same as `--query ANYTHING=VALUE`: --count, --seeds, --wideSpacing, --view, --shadows, --msaa,
 *                         --dpr, --width, --height, --wind, --windBearing, --growth, --fruit, --ground, --lodBias, --skip,
 *                         --only, --raster, --flush, or an implementation's own.
 *
 * Paths: overview-hold, pan, orbit-wide, orbit-mid, low-pitch, dive, tween-all-growth, tween-all-health,
 * tween-all-foliage (through `transitions`), subset-updates, pick-hover, load; in `all` also tween-all-growth-accessor,
 * tween-all-health-accessor, tween-all-foliage-accessor (a new value from the accessor every frame); and by name
 * hold-leaf (the bottom of the dive) and hold-at (`--camera east,north,up,zoom,pitch,bearing`, metres and degrees).
 *
 * In the table all numbers are in ms but those marked otherwise, and each is the median across runs of that run's
 * percentile. `cpu` is the main thread up to the flush, `gpu` the wait for the GPU after it, and `total` both, and
 * `cpu%` is how much of a median frame's total is CPU. `long` counts main thread tasks of 50 ms and up, after taking
 * away the time a frame waited for the GPU, since only a benchmark waits for it, and `long+gpu` counts them as they
 * were. `KB/f` is JavaScript allocated per frame, and `GC` the number of times the heap shrank in a path. `Midx` is
 * millions of indices drawn per frame, and `draws` draw calls per frame, over all passes. `bar` means little on a busy
 * machine: compare configurations of one batch, and read pass or fail on an idle one.
 */

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {loadavg, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, '../../..');
const DEFAULT_SERVER = 'http://127.0.0.1:4393';

const DEFAULT_PATHS = [
  'overview-hold',
  'pan',
  'orbit-wide',
  'orbit-mid',
  'low-pitch',
  'dive',
  'tween-all-growth',
  'tween-all-health',
  'tween-all-foliage',
  'subset-updates',
  'pick-hover',
  'load'
];
const ALL_PATHS = [
  ...DEFAULT_PATHS,
  'tween-all-growth-accessor',
  'tween-all-health-accessor',
  'tween-all-foliage-accessor'
];

const BROWSER_ARGS = [
  '--use-angle=metal',
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--disable-gpu-sandbox',
  // Exact numbers from `performance.memory`, and `gc()` to start each path from a clean heap.
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
  // A frame is timed by waiting for the GPU, so nothing should wait for a display or for being in front.
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows'
];

const OWN_OPTIONS = new Set([
  'impl',
  'config',
  'paths',
  'runs',
  'out',
  'server',
  'frames',
  'frameScale',
  'maxSeconds',
  'profile',
  'heapProfile',
  'top',
  'png',
  'retries',
  'retryWait',
  'gpuIdle',
  'gpuIdleWait',
  'bar',
  'query'
]);

function parseArguments(argv) {
  const options = {config: [], forwarded: new URLSearchParams()};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument ${argument}`);
    const name = argument.slice(2);
    const value = argv[i + 1]?.startsWith('--') || i + 1 >= argv.length ? '1' : argv[++i];
    if (name === 'config') options.config.push(value);
    else if (OWN_OPTIONS.has(name)) options[name] = value;
    else options.forwarded.set(name, value);
  }
  return options;
}

/** Each configuration: a name, where it is served from, and the URL parameters of its page. */
function getConfigs(options) {
  const base = new URLSearchParams(options.query ?? '');
  options.forwarded.forEach((value, key) => base.set(key, value));
  const implementations = (options.impl ?? 'photoreal').split(',');
  const server = options.server ?? DEFAULT_SERVER;
  const make = (tag, overrides) => {
    const query = new URLSearchParams(base);
    if (!query.has('impl') && !overrides.has('impl')) query.set('impl', implementations[0]);
    overrides.forEach((value, key) => query.set(key, value));
    const configServer = query.get('server') ?? server;
    query.delete('server');
    return {tag, server: configServer, query};
  };
  if (options.config.length) {
    return options.config.map(text => {
      const colon = text.indexOf(':');
      return colon < 0
        ? make(text, new URLSearchParams())
        : make(text.slice(0, colon), new URLSearchParams(text.slice(colon + 1)));
    });
  }
  return implementations.map(name => make(name, new URLSearchParams({impl: name})));
}

async function isServerUp(url) {
  try {
    const response = await fetch(`${url}/field/field.html`, {signal: AbortSignal.timeout(2000)});
    return response.ok;
  } catch {
    return false;
  }
}

/** The dev server to use: one that is up, or else a new one of its own, for someone who has none running. */
async function getServer() {
  if (await isServerUp(DEFAULT_SERVER)) return {url: DEFAULT_SERVER, close: async () => {}};
  const {createServer} = await import('vite');
  const server = await createServer({
    configFile: resolve(HERE, '../vite.config.ts'),
    server: {port: 0, strictPort: false, host: '127.0.0.1'},
    logLevel: 'warn'
  });
  await server.listen();
  return {
    url: `http://127.0.0.1:${server.httpServer.address().port}`,
    close: () => server.close()
  };
}

function getPaths(text) {
  if (!text || text === 'default') return DEFAULT_PATHS;
  if (text === 'all') return ALL_PATHS;
  return text.split(',');
}

/** A short hash of the layer source, so that a number can be tied to what produced it while others edit it. */
function getSourceStamp() {
  const hash = createHash('sha1');
  for (const folder of ['modules/layers/src/tree-layer', 'modules/layers/src/splat-layer']) {
    const path = join(REPOSITORY, folder);
    for (const file of readdirSync(path).sort()) {
      if (file.endsWith('.ts')) hash.update(readFileSync(join(path, file)));
    }
  }
  return hash.digest('hex').slice(0, 10);
}

/** How busy macOS says the GPU is, in percent, or null where it does not say. Other agents share it. */
function getGpuBusy() {
  try {
    const text = execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = /"Device Utilization %"=(\d+)/.exec(text);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Waits for the GPU to quieten down, up to a limit, and returns how busy it is by then. */
async function waitForGpu(options) {
  const threshold = Number(options.gpuIdle ?? 100);
  const limit = Number(options.gpuIdleWait ?? 120) * 1000;
  const started = Date.now();
  let busy = getGpuBusy();
  while (busy !== null && busy >= threshold && Date.now() - started < limit) {
    await new Promise(done => {
      setTimeout(done, 2000);
    });
    busy = getGpuBusy();
  }
  return {busy, waitedSeconds: (Date.now() - started) / 1000};
}

function getPercentiles(values) {
  if (!values.length) return {p10: 0, p50: 0, p95: 0, p99: 0, max: 0};
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  return {p10: at(0.1), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1]};
}

function getMedian(values) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Allocation from growth between frames: a frame whose heap fell had a collection, which says nothing of what it made. */
function getHeapStats(heap) {
  let grown = 0;
  let collections = 0;
  for (let i = 1; i < heap.length; i++) {
    const change = heap[i] - heap[i - 1];
    if (change > 0) grown += change;
    else if (change < 0) collections++;
  }
  return {bytesPerFrame: heap.length > 1 ? grown / (heap.length - 1) : 0, collections};
}

function getRunStats(result) {
  const frames = result.frames || 1;
  const sum = list => list.reduce((total, value) => total + value, 0);
  const longTasks = result.longTasks.filter(task => !task.inCapture);
  const jsLong = longTasks.filter(task => task.duration - task.flush >= 50);
  const passIndices = Object.fromEntries(
    Object.entries(result.passes).map(([name, pass]) => [name, sum(pass.indices) / frames])
  );
  const passDraws = Object.fromEntries(
    Object.entries(result.passes).map(([name, pass]) => [name, sum(pass.draws) / frames])
  );
  return {
    frames: result.frames,
    truncated: result.truncated,
    cpu: getPercentiles(result.cpu),
    gpu: getPercentiles(result.total.map((total, frame) => total - result.cpu[frame])),
    total: getPercentiles(result.total),
    cpuShare: getPercentiles(result.total).p50
      ? getPercentiles(result.cpu).p50 / getPercentiles(result.total).p50
      : 0,
    heap: getHeapStats(result.heap),
    longTasks: longTasks.length,
    longTasksJs: jsLong.length,
    longestTask: Math.max(0, ...longTasks.map(task => task.duration)),
    longestTaskJs: Math.max(0, ...longTasks.map(task => task.duration - task.flush)),
    indices: passIndices,
    draws: passDraws,
    picks: result.picks,
    load: result.load
  };
}

function summarizeProfile(profile, frames, top) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const keyOf = node => {
    const {functionName, url, lineNumber} = node.callFrame;
    const file = url ? url.split('/').pop().split('?')[0] : '';
    return `${functionName || '(anonymous)'}${file ? ` ${file}:${lineNumber + 1}` : ''}`;
  };
  const selfByKey = new Map();
  const inclusiveByKey = new Map();
  const walk = (node, open) => {
    const key = keyOf(node);
    const time = self.get(node.id) ?? 0;
    selfByKey.set(key, (selfByKey.get(key) ?? 0) + time);
    const entered = !open.has(key);
    if (entered) open.add(key);
    let subtree = time;
    for (const child of node.children ?? []) subtree += walk(nodes.get(child), open);
    if (entered) {
      open.delete(key);
      inclusiveByKey.set(key, (inclusiveByKey.get(key) ?? 0) + subtree);
    }
    return subtree;
  };
  const root = profile.nodes.find(node => node.callFrame.functionName === '(root)');
  const rootTime = walk(root, new Set());
  const list = (map, count) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([name, time]) => ({
        name,
        msPerFrame: Number((time / 1000 / frames).toFixed(3)),
        percent: Number(((100 * time) / rootTime).toFixed(1))
      }));
  return {
    frames,
    sampledMs: rootTime / 1000,
    self: list(selfByKey, top),
    inclusive: list(inclusiveByKey, top * 2)
  };
}

/**
 * What each function allocated per frame, from a sampling heap profile that keeps what was collected. V8 scales each
 * sample by its odds of being taken, so `selfSize` estimates every byte allocated, not only those still alive.
 */
function summarizeHeapProfile(profile, frames, top) {
  const selfByKey = new Map();
  let total = 0;
  const walk = node => {
    const {functionName, url, lineNumber} = node.callFrame;
    const file = url ? url.split('/').pop().split('?')[0] : '';
    const key = `${functionName || '(anonymous)'}${file ? ` ${file}:${lineNumber + 1}` : ''}`;
    selfByKey.set(key, (selfByKey.get(key) ?? 0) + node.selfSize);
    total += node.selfSize;
    for (const child of node.children ?? []) walk(child);
  };
  walk(profile.head);
  return {
    frames,
    kilobytesPerFrame: Number((total / 1024 / frames).toFixed(1)),
    self: [...selfByKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([name, bytes]) => ({
        name,
        kilobytesPerFrame: Number((bytes / 1024 / frames).toFixed(1)),
        percent: Number(((100 * bytes) / Math.max(1, total)).toFixed(1))
      }))
  };
}

function printHeapProfile(label, summary) {
  console.log(
    `\nAllocation in ${label}: ${summary.frames} frames, ${summary.kilobytesPerFrame.toFixed(0)} KB per frame`
  );
  console.log('  KB/frame       %     function');
  for (const row of summary.self) {
    console.log(`  ${row.kilobytesPerFrame.toFixed(1).padStart(8)} ${String(row.percent).padStart(9)} ${row.name}`);
  }
}

function printProfile(label, summary) {
  console.log(`\nProfile of ${label}: ${summary.frames} frames, ${summary.sampledMs.toFixed(0)} ms sampled`);
  console.log('  self ms/frame  %     function');
  for (const row of summary.self) {
    console.log(`  ${row.msPerFrame.toFixed(3).padStart(13)} ${String(row.percent).padStart(5)} ${row.name}`);
  }
  console.log('  incl ms/frame  %     function');
  for (const row of summary.inclusive) {
    console.log(`  ${row.msPerFrame.toFixed(3).padStart(13)} ${String(row.percent).padStart(5)} ${row.name}`);
  }
}

/** One path of one configuration, in a browser of its own. */
async function runOnce(config, path, run, options, outDir, localServer) {
  // Before this run has a browser, so this is everyone else.
  const {busy: gpuBusyBefore, waitedSeconds} = await waitForGpu(options);
  const width = Number(config.query.get('width') ?? 2560);
  const height = Number(config.query.get('height') ?? 1600);
  const dpr = Number(config.query.get('dpr') ?? 1);
  const query = new URLSearchParams(config.query);
  if (path === 'load') query.set('autorun', 'load');
  const url = `${config.server}/field/field.html?${query}`;
  const browser = await chromium.launch({headless: true, channel: 'chromium', args: BROWSER_ARGS});
  const pageErrors = [];
  const pathOptions = {
    frames: Number(config.query.get('frames') ?? options.frames ?? 0) || undefined,
    frameScale: options.frameScale ? Number(options.frameScale) : undefined,
    maxSeconds: options.maxSeconds ? Number(options.maxSeconds) : undefined
  };
  try {
    const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: dpr});
    const page = await context.newPage();
    let failed;
    const failure = new Promise((_, reject) => {
      failed = reject;
    });
    failure.catch(() => {});
    page.on('pageerror', error => {
      pageErrors.push(`page: ${error.message}`);
      failed(new Error(error.message));
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      pageErrors.push(`console: ${text.slice(0, 1200)}`);
      if (/Failed to load resource|Failed to fetch dynamically/.test(text)) failed(new Error(text));
    });
    const race = promise => Promise.race([promise, failure]);

    const cdp = options.profile || options.heapProfile ? await context.newCDPSession(page) : null;
    const startProfiler = async () => {
      if (!cdp) return;
      if (options.profile) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', {interval: 200});
        await cdp.send('Profiler.start');
      }
      if (options.heapProfile) {
        await cdp.send('HeapProfiler.enable');
        await cdp.send('HeapProfiler.startSampling', {
          samplingInterval: 16384,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true
        });
      }
    };
    const stopProfiler = async () => {
      const stopped = {cpu: null, heap: null};
      if (!cdp) return stopped;
      if (options.profile) stopped.cpu = (await cdp.send('Profiler.stop')).profile;
      if (options.heapProfile) stopped.heap = (await cdp.send('HeapProfiler.stopSampling')).profile;
      return stopped;
    };
    // A profile of loading takes in the page from the start.
    if (path === 'load') await startProfiler();
    await race(page.goto(url, {waitUntil: 'load', timeout: 180000}));
    await race(page.waitForFunction('window.fieldBench', null, {timeout: 120000, polling: 100}));
    let result;
    let profile = null;
    let heapProfile = null;
    if (path === 'load') {
      result = await race(page.evaluate(() => window.fieldBench.autorun));
      ({cpu: profile, heap: heapProfile} = await stopProfiler());
    } else {
      await race(page.evaluate(() => window.fieldBench.ready));
      await race(
        page.evaluate(([name, opts]) => window.fieldBench.settlePath(name, opts), [path, pathOptions])
      );
      await startProfiler();
      result = await race(
        page.evaluate(([name, opts]) => window.fieldBench.runPath(name, opts), [path, pathOptions])
      );
      ({cpu: profile, heap: heapProfile} = await stopProfiler());
    }
    const info = await page.evaluate(() => window.fieldBench.getInfo());
    const templates = await page.evaluate(() => window.fieldBench.getTemplates());
    if (result.errors.length) throw new Error(result.errors.join('; '));

    const png = result.png;
    delete result.png;
    const stem = `${path}-run${run}`;
    mkdirSync(outDir, {recursive: true});
    let pngSha = null;
    if (png) {
      const bytes = Buffer.from(png.split(',')[1], 'base64');
      pngSha = createHash('sha1').update(bytes).digest('hex').slice(0, 12);
      if (run === 1 || options.png === 'all') {
        writeFileSync(join(outDir, options.png === 'all' ? `${stem}.png` : `${path}.png`), bytes);
      }
    }
    const profileSummary = profile
      ? summarizeProfile(profile, result.frames, Number(options.top ?? 25))
      : null;
    if (profile) {
      writeFileSync(join(outDir, `${stem}.cpuprofile`), JSON.stringify(profile));
      writeFileSync(join(outDir, `${stem}.profile.json`), JSON.stringify(profileSummary, null, 1));
    }
    const heapSummary = heapProfile
      ? summarizeHeapProfile(heapProfile, result.frames, Number(options.top ?? 25))
      : null;
    if (heapSummary) {
      writeFileSync(join(outDir, `${stem}.heap.json`), JSON.stringify(heapSummary, null, 1));
    }
    const stats = getRunStats(result);
    writeFileSync(
      join(outDir, `${stem}.json`),
      `${JSON.stringify(
        {
          tag: config.tag,
          run,
          url,
          source: config.server === localServer ? getSourceStamp() : null,
          when: new Date().toISOString(),
          loadAverage: loadavg(),
          gpuBusyBefore,
          gpuWaitedSeconds: waitedSeconds,
          info,
          templates,
          pngSha,
          pageErrors,
          stats,
          ...result
        },
        null,
        0
      )}\n`
    );
    return {
      stats,
      pngSha,
      info,
      profileSummary,
      heapSummary,
      gpuBusyBefore,
      source: config.server === localServer ? getSourceStamp() : null
    };
  } finally {
    await browser.close();
  }
}

function format(value, digits = 1) {
  return Number(value).toFixed(digits);
}

/**
 * Frame budgets for the reference laptop and M4 Pro. Each takes a row of the table, and what the harness and the ground cost
 * by themselves on that path, and says if it passes. The M4 bar is on the layer alone.
 */
const BARS = {
  m4: {
    text: 'on top of the floor, GPU p99 under 4 ms and main thread p99 under 6 ms, standing in for a base MacBook Air',
    passes: (row, floor) =>
      row.frames > 0 &&
      row.gpu.p99 - (floor?.gpu.p99 ?? 0) < 4 &&
      row.cpu.p99 - (floor?.cpu.p99 ?? 0) < 6
  },
  laptop: {
    text: 'p99 frame under 16.7 ms and no frame over 33 ms',
    // A path that drew no frame at all, such as a `load` whose first frame outlasted its window, fails.
    passes: row => row.frames > 0 && row.total.p99 < 16.7 && row.total.max < 33
  }
};

function getBarName(options, renderer) {
  if (options.bar) return options.bar;
  return /\bM4\b/.test(renderer) ? 'm4' : 'laptop';
}

const HEADER = [
  'path'.padEnd(27),
  'config'.padEnd(14),
  'runs',
  'frm'.padStart(4),
  '|',
  'cpu p50'.padStart(8),
  'p95'.padStart(7),
  'p99'.padStart(7),
  'max'.padStart(7),
  '|',
  'gpu p99'.padStart(8),
  'max'.padStart(7),
  '|',
  'total p50'.padStart(9),
  'p95'.padStart(7),
  'p99'.padStart(7),
  'max'.padStart(7),
  '|',
  'cpu%'.padStart(4),
  'long'.padStart(4),
  'long+gpu'.padStart(8),
  'KB/f'.padStart(7),
  'GC'.padStart(3),
  'Midx'.padStart(7),
  'draws'.padStart(6),
  'bar'.padStart(5)
].join(' ');

function getSummaryRow(path, tag, entries) {
  const stat = pick => getMedian(entries.map(entry => pick(entry.stats)));
  const percentile = kind => ({
    p10: stat(s => s[kind].p10),
    p50: stat(s => s[kind].p50),
    p95: stat(s => s[kind].p95),
    p99: stat(s => s[kind].p99),
    max: stat(s => s[kind].max)
  });
  const total = percentile('total');
  const gpu = percentile('gpu');
  const sum = record => Object.values(record).reduce((a, b) => a + b, 0);
  return {
    path,
    tag,
    runs: entries.length,
    frames: stat(s => s.frames),
    truncated: entries.some(entry => entry.stats.truncated),
    cpu: percentile('cpu'),
    gpu,
    total,
    worstMax: Math.max(...entries.map(entry => entry.stats.total.max)),
    p50Range: [
      Math.min(...entries.map(entry => entry.stats.total.p50)),
      Math.max(...entries.map(entry => entry.stats.total.p50))
    ],
    cpuShare: stat(s => s.cpuShare),
    longTasks: stat(s => s.longTasks),
    longTasksJs: stat(s => s.longTasksJs),
    longestTask: stat(s => s.longestTask),
    longestTaskJs: stat(s => s.longestTaskJs),
    kilobytesPerFrame: stat(s => s.heap.bytesPerFrame) / 1024,
    collections: stat(s => s.heap.collections),
    indices: {
      screen: stat(s => s.indices.screen),
      shadow: stat(s => s.indices.shadow),
      pick: stat(s => s.indices.pick)
    },
    draws: {
      screen: stat(s => s.draws.screen),
      shadow: stat(s => s.draws.shadow),
      pick: stat(s => s.draws.pick)
    },
    totalIndices: stat(s => sum(s.indices)),
    totalDraws: stat(s => sum(s.draws)),
    picks: entries[0].stats.picks,
    load: entries[0].stats.load
      ? {
          firstFrameMs: stat(s => s.load.firstFrameMs),
          firstFrameCpuMs: stat(s => s.load.firstFrameCpuMs),
          firstFrameFlushMs: stat(s => s.load.firstFrameFlushMs)
        }
      : null,
    gpuBusyBefore: entries.map(entry => entry.gpuBusyBefore),
    pngSha: entries.map(entry => entry.pngSha)
  };
}

function printRow(row) {
  console.log(
    [
      row.path.padEnd(27),
      row.tag.slice(0, 14).padEnd(14),
      String(row.runs).padStart(4),
      String(Math.round(row.frames)).padStart(4),
      '|',
      format(row.cpu.p50, 2).padStart(8),
      format(row.cpu.p95).padStart(7),
      format(row.cpu.p99).padStart(7),
      format(row.cpu.max).padStart(7),
      '|',
      format(row.gpu.p99).padStart(8),
      format(row.gpu.max).padStart(7),
      '|',
      format(row.total.p50, 2).padStart(9),
      format(row.total.p95).padStart(7),
      format(row.total.p99).padStart(7),
      format(row.total.max).padStart(7),
      '|',
      String(Math.round(row.cpuShare * 100)).padStart(4),
      String(Math.round(row.longTasksJs)).padStart(4),
      String(Math.round(row.longTasks)).padStart(8),
      format(row.kilobytesPerFrame).padStart(7),
      String(Math.round(row.collections)).padStart(3),
      format(row.totalIndices / 1e6).padStart(7),
      String(Math.round(row.totalDraws)).padStart(6),
      `${row.passes ? 'pass' : 'FAIL'}${row.truncated ? '!' : ''}`.padStart(5)
    ].join(' ')
  );
  if (row.picks.answered) {
    console.log(
      `${''.padEnd(27)} ${row.picks.answered} picks, ${row.picks.hits} hits, ` +
        `${format(row.draws.pick)} draws and ${format(row.indices.pick / 1e6)} Midx per frame in the pick pass`
    );
    // `standard` under a shadow LightingEffect draws no pick pass at all, on origin/master too, so its row is cheap.
    if (!row.draws.pick && row.impl !== 'none') {
      console.log(`${''.padEnd(27)} NO PICK PASS WAS DRAWN: picking does not work here, so this row does not measure it`);
    }
  }
  if (row.load) {
    console.log(
      `${''.padEnd(27)} first frame ${format(row.load.firstFrameMs, 0)} ms ` +
        `(${format(row.load.firstFrameCpuMs, 0)} CPU, ${format(row.load.firstFrameFlushMs, 0)} GPU), ` +
        `${Math.round(row.longTasksJs)} long tasks in the window, longest ${format(row.longestTaskJs, 0)} ms`
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const server = options.server ? null : await getServer();
  if (server) options.server = server.url;
  try {
    await runBatch(options, server?.url);
  } finally {
    await server?.close();
  }
}

async function runBatch(options, localServer) {
  const configs = getConfigs(options);
  const paths = getPaths(options.paths);
  const runs = Number(options.runs ?? 3);
  const out = resolve(options.out ?? join(tmpdir(), 'field-bench'));
  const retries = Number(options.retries ?? 2);
  const retryWait = Number(options.retryWait ?? 60);
  const loadStart = loadavg();
  const collected = new Map();
  const failures = [];
  const sources = new Set();
  console.log(
    `Field bench: ${configs.map(config => config.tag).join(', ')} | ${paths.length} paths | ${runs} runs | out ${out}`
  );
  console.log(`Load average at start: ${loadStart.map(value => value.toFixed(2)).join(' ')}`);
  let infoPrinted = false;

  for (let run = 1; run <= runs; run++) {
    for (const path of paths) {
      for (const config of configs) {
        const label = `${config.tag} ${path} run ${run}`;
        const outDir = join(out, config.tag);
        let tries = 0;
        for (;;) {
          try {
            const started = Date.now();
            const entry = await runOnce(config, path, run, options, outDir, localServer);
            const {stats} = entry;
            config.info = entry.info;
            if (!infoPrinted) {
              infoPrinted = true;
              const {renderer, antialias, samples, drawingBuffer, trees, sizeMetres} = entry.info;
              console.log(
                `GPU: ${renderer} | antialias ${antialias}, samples ${samples} | ` +
                  `${drawingBuffer.join('x')} | ${trees} trees over ${sizeMetres.map(Math.round).join(' x ')} m`
              );
            }
            console.log(
              `  ${label}: total p50 ${format(stats.total.p50)} p99 ${format(stats.total.p99)} ` +
                `max ${format(stats.total.max)}, cpu p50 ${format(stats.cpu.p50)}, ` +
                `${stats.frames} frames in ${((Date.now() - started) / 1000).toFixed(0)} s, ` +
                `load ${loadavg()[0].toFixed(1)}, GPU ${entry.gpuBusyBefore ?? '?'}% busy before` +
                `${stats.truncated ? ', TRUNCATED' : ''}`
            );
            if (entry.source) sources.add(entry.source);
            if (entry.profileSummary) printProfile(label, entry.profileSummary);
            if (entry.heapSummary) printHeapProfile(label, entry.heapSummary);
            const key = `${path}\u0000${config.tag}`;
            if (!collected.has(key)) collected.set(key, []);
            collected.get(key).push(entry);
            break;
          } catch (error) {
            const message = String(error?.message ?? error).split('\n')[0].slice(0, 400);
            if (tries++ < retries) {
              console.error(`  ${label} failed, retrying in ${retryWait} s: ${message}`);
              await new Promise(done => {
                setTimeout(done, retryWait * 1000);
              });
            } else {
              console.error(`  ${label} FAILED: ${message}`);
              failures.push({label, message});
              break;
            }
          }
        }
      }
    }
  }

  const rows = [];
  for (const path of paths) {
    for (const config of configs) {
      const entries = collected.get(`${path}\u0000${config.tag}`);
      if (entries?.length) {
        rows.push({...getSummaryRow(path, config.tag, entries), impl: config.query.get('impl')});
      }
    }
  }
  const loadEnd = loadavg();
  console.log(
    `\n${runs} runs each. Medians across runs. Load average ${loadStart[0].toFixed(1)} at the start, ${loadEnd[0].toFixed(1)} at the end. ` +
      `Layer source ${[...sources].join(', ') || 'not this worktree'}.`
  );
  for (const {tag, info} of configs) {
    if (!info) continue;
    const {drawingBuffer, antialias, samples, trees, params} = info;
    console.log(
      `  ${tag}: canvas ${drawingBuffer.join('x')}, pixel ratio ${params.dpr}, ` +
        `${antialias ? `MSAA ${samples}x` : 'no MSAA'}, ${params.shadows ? 'shadows' : 'no shadows'}, ${trees} trees`
    );
  }
  console.log(HEADER);
  const renderer = configs.find(config => config.info)?.info.renderer ?? '';
  const barName = getBarName(options, renderer);
  const bar = BARS[barName];
  const floorTags = configs
    .filter(config => config.query.get('impl') === 'none')
    .map(config => config.tag);
  let lastPath = '';
  for (const row of rows) {
    if (row.path !== lastPath && lastPath) console.log('');
    lastPath = row.path;
    row.passes = bar.passes(
      row,
      rows.find(other => other.path === row.path && floorTags.includes(other.tag))
    );
    printRow(row);
  }
  console.log(
    `\nThe bar, ${barName}, on ${renderer}: ${bar.text}.` +
      `${barName === 'm4' && !floorTags.length ? ' No floor in this batch: add --config none:impl=none.' : ''}`
  );
  for (const {tag} of configs) {
    const own = rows.filter(row => row.tag === tag);
    const passed = own.filter(row => row.passes);
    const failed = own.filter(row => !row.passes).map(row => row.path);
    console.log(
      `  ${tag}: ${passed.length === own.length ? 'PASS' : 'FAIL'}, ${passed.length} of ${own.length} paths` +
        `${failed.length ? `. Fails ${failed.join(', ')}` : ''}`
    );
  }
  if (failures.length) {
    console.log(`\n${failures.length} runs failed:`);
    for (const failure of failures) console.log(`  ${failure.label}: ${failure.message}`);
  }
  mkdirSync(out, {recursive: true});
  writeFileSync(
    join(out, 'summary.json'),
    `${JSON.stringify(
      {
        when: new Date().toISOString(),
        arguments: process.argv.slice(2),
        loadAverage: {start: loadStart, end: loadEnd},
        renderer,
        bar: barName,
        sources: [...sources],
        rows,
        failures
      },
      null,
      1
    )}\n`
  );
  console.log(`\nWrote ${join(out, 'summary.json')}`);
  if (failures.length) process.exitCode = 1;
}

await main();
