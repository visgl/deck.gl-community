// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from 'vite';

const {values} = parseArgs({
  options: {
    label: {type: 'string', default: 'source'},
    headed: {type: 'boolean', default: false},
    profile: {type: 'boolean', default: false},
    selection: {type: 'boolean', default: false},
    'gl-debug': {type: 'boolean', default: false},
    dpr: {type: 'string', default: '1'},
    count: {type: 'string', default: '20000'},
    shadows: {type: 'string', default: '1'},
    ground: {type: 'string', default: '1'},
    theme: {type: 'string', default: 'default'},
    opacity: {type: 'string'},
    'wind-time': {type: 'string'},
    'color-mode': {type: 'string', default: 'natural'},
    screenshot: {type: 'string'},
    'cpu-profile': {type: 'string'},
    backend: {type: 'string', default: 'webgl'},
    field: {type: 'string', default: 'citrus'},
    width: {type: 'string', default: '1163'},
    height: {type: 'string', default: '654'},
    frames: {type: 'string', default: '180'},
    warmup: {type: 'string', default: '60'},
    'frame-timing-only': {type: 'boolean', default: false},
    paths: {type: 'string', default: 'overview,tree,dive'},
    out: {type: 'string'}
  }
});

const [width, height, frames, warmup] = [values.width, values.height, values.frames, values.warmup].map(Number);
if (![width, height, frames, warmup].every(Number.isSafeInteger) ||
  width < 1 || height < 1 || frames < 2 || warmup < 0) {
  throw new Error('Width and height must be positive integers, frames at least two, and warmup nonnegative.');
}
const dpr = Number(values.dpr);
const count = Number(values.count);
if (!(dpr > 0 && Number.isFinite(dpr)) || !Number.isSafeInteger(count) || count < 1 ||
  (!['0', '1'].includes(values.shadows) || !['0', '1'].includes(values.ground)) || !['default', 'bright', 'realistic'].includes(values.theme) ||
  !['natural', 'analytical'].includes(values['color-mode']) ||
  (values['wind-time'] !== undefined && !Number.isFinite(Number(values['wind-time']))) ||
  (values.opacity !== undefined && !(Number(values.opacity) >= 0 && Number(values.opacity) <= 1))) {
  throw new Error('Use positive DPR/count, --shadows 0|1, --theme default|bright|realistic, --color-mode natural|analytical and opacity 0–1.');
}
const paths = values.paths.split(',');
if (!['webgl', 'webgpu'].includes(values.backend) || !['citrus', 'mixed'].includes(values.field)) {
  throw new Error('Use --backend webgl|webgpu and --field citrus|mixed.');
}
if (paths.some(path => !['overview', 'tree', 'dive', 'macro', 'tint'].includes(path))) {
  throw new Error('Paths must be a comma-separated list of overview, tree, dive, macro, and tint.');
}

function summarize(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    samples: sorted.length,
    mean,
    p50: sorted[Math.ceil(sorted.length * 0.50) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
    max: sorted.at(-1),
    fps: 1000 / mean
  };
}

const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
  server: {port: 0}
});
let browser;
try {
  await server.listen();
  const url = new URL(server.resolvedUrls.local[0]);
  url.searchParams.set('backend', values.backend);
  url.searchParams.set('field', values.field);
  for (const key of ['dpr', 'count', 'shadows', 'ground', 'theme', 'opacity']) {
    if (values[key] !== undefined) url.searchParams.set(key, values[key]);
  }
  url.searchParams.set('colorMode', values['color-mode']);
  if (values['wind-time'] !== undefined) url.searchParams.set('windTime', values['wind-time']);
  if (values.profile || values['gl-debug']) url.searchParams.set('profile', '1');
  if (values['gl-debug']) url.searchParams.set('glDebug', '1');
  if (values.selection) url.searchParams.set('selection', '1');
  if (values['frame-timing-only']) url.searchParams.set('frameTimingOnly', '1');
  browser = await chromium.launch({
    headless: !values.headed,
    channel: 'chromium',
    args: ['--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])]
  });
  const results = [];
  for (const path of paths) {
    const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: Number(values.dpr)});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (process.env.TREE_BENCH_LOG) process.stderr.write(message.text() + '\n');
      if (message.type() === 'error') errors.push(message.text());
    });
    const response = await page.goto(url.href, {timeout: 120_000});
    if (!response?.ok()) throw new Error(`Benchmark page failed to load (HTTP ${response?.status()}).`);
    try {
      await page.waitForFunction(() => window.treeFieldBench, null, {timeout: 120_000});
    } catch (error) {
      if (errors.length) throw new Error(errors.join('\n'), {cause: error});
      throw error;
    }
    const cdp = values['cpu-profile'] ? await page.context().newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    const run = await page.evaluate(
      ({path, frames, warmup}) => window.treeFieldBench.measure(path, frames, warmup),
      {path, frames, warmup}
    );
    if (cdp) {
      const {profile} = await cdp.send('Profiler.stop');
      await writeFile(`${values['cpu-profile']}-${path}.cpuprofile`, JSON.stringify(profile));
    }
    if (values.screenshot) await page.screenshot({path: `${values.screenshot}-${path}.png`});
    await page.close();
    const problems = [...errors, ...run.errors, ...(run.diagnostics?.glErrors ?? []).map(error => `${error.name}: WebGL error ${error.error}`)];
    if (run.backend !== values.backend || (!Object.values(run.lodCounts).some(levels => levels.some(Boolean)) && !run.diagnostics?.frames.some(frame => frame.drawCalls > 0))) {
      problems.push('TreeLayer did not submit a visible level on the requested backend.');
    }
    if (Math.abs(run.draws - frames) > 1) problems.push(`Measured ${run.draws} draws for ${frames} frame intervals.`);
    if (run.frameMs.length !== frames || run.frameMs.some(value => !Number.isFinite(value) || value <= 0)) {
      problems.push('Missing or invalid frame intervals.');
    }
    if (problems.length) {
      if (values.out) await writeFile(values.out, JSON.stringify({failedPath: path, ...run, problems}, null, 2) + '\n');
      throw new Error(`${path}: ${problems.join('\n')}`);
    }
    const {frameMs, gpuMs, errors: _errors, ...metadata} = run;
    results.push({
      path,
      ...metadata,
      raf: summarize(frameMs),
      gpu: summarize(gpuMs),
      frameMs,
      gpuMs
    });
  }
  const report = JSON.stringify({label: values.label, browser: browser.version(), headed: values.headed, viewport: [width, height], dpr, frames, warmup, results}, null, 2) + '\n';
  if (values.out) await writeFile(values.out, report);
  else process.stdout.write(report);
  const log = new console.Console({stdout: process.stderr});
  log.table(results.map(({path, renderer, hardwareGpu, raf, gpu}) => ({
    path, renderer, hardwareGpu, fps: raf.fps.toFixed(1), p95: raf.p95.toFixed(1), p99: raf.p99.toFixed(1), gpuP99: gpu?.p99.toFixed(1) ?? 'unavailable'
  })));
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
