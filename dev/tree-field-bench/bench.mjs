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
    width: {type: 'string', default: '1163'},
    height: {type: 'string', default: '654'},
    frames: {type: 'string', default: '180'},
    warmup: {type: 'string', default: '60'},
    paths: {type: 'string', default: 'overview,tree,dive'},
    out: {type: 'string'}
  }
});

const [width, height, frames, warmup] = [values.width, values.height, values.frames, values.warmup].map(Number);
if (![width, height, frames, warmup].every(Number.isSafeInteger) ||
  width < 1 || height < 1 || frames < 2 || warmup < 0) {
  throw new Error('Width and height must be positive integers, frames at least two, and warmup nonnegative.');
}
const paths = values.paths.split(',');
if (paths.some(path => !['overview', 'tree', 'dive'].includes(path))) {
  throw new Error('Paths must be a comma-separated list of overview, tree, and dive.');
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
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])]
  });
  const results = [];
  for (const path of paths) {
    const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const response = await page.goto(url);
    if (!response?.ok()) throw new Error(`Benchmark page failed to load (HTTP ${response?.status()}).`);
    try {
      await page.waitForFunction(() => window.treeFieldBench, null, {timeout: 120_000});
    } catch (error) {
      if (errors.length) throw new Error(errors.join('\n'), {cause: error});
      throw error;
    }
    const run = await page.evaluate(
      ({path, frames, warmup}) => window.treeFieldBench.measure(path, frames, warmup),
      {path, frames, warmup}
    );
    await page.close();
    const problems = [...errors, ...run.errors];
    if (run.draws !== frames) problems.push(`Measured ${run.draws} draws for ${frames} frame intervals.`);
    if (run.frameMs.length !== frames || run.frameMs.some(value => !Number.isFinite(value) || value <= 0)) {
      problems.push('Missing or invalid frame intervals.');
    }
    if (problems.length) throw new Error(`${path}: ${problems.join('\n')}`);
    const {frameMs, gpuMs, errors: _errors, ...metadata} = run;
    results.push({
      path,
      ...metadata,
      hardwareGpu: !/swiftshader|llvmpipe|software rasterizer/i.test(run.renderer),
      raf: summarize(frameMs),
      gpu: summarize(gpuMs),
      frameMs,
      gpuMs
    });
  }
  const report = JSON.stringify({frames, warmup, results}, null, 2) + '\n';
  if (values.out) await writeFile(values.out, report);
  else process.stdout.write(report);
  const log = new console.Console({stdout: process.stderr});
  log.table(results.map(({path, renderer, hardwareGpu, raf, gpu}) => ({
    path, renderer, hardwareGpu, fps: raf.fps.toFixed(1), p99: raf.p99.toFixed(1), gpuP99: gpu?.p99.toFixed(1) ?? 'unavailable'
  })));
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
