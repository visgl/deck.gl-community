// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Exercises the real 20,000-tree playground controls, rather than its test setters.
 * Start the dev server, then run from the repository root:
 * yarn node dev/tree-lifecycle/verify-playground.mjs --out /tmp/tree-playground-qa
 */
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const directory = resolve(option('out', join(tmpdir(), 'tree-playground-qa')));
const server = option('server', 'http://127.0.0.1:4393');
mkdirSync(directory, {recursive: true});
const errors = [];
const checks = [];
const screenshots = [];
const interactiveViews = [];
const started = performance.now();
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: [
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--disable-gpu-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding'
  ]
});
let page;
const check = (name, details = {}) => {
  checks.push({name, pass: true, ...details});
  process.stdout.write(`${name}: PASS\n`);
};
const screenshot = async name => {
  if (!page) return;
  const path = join(directory, `${name}.png`);
  await page.screenshot({path});
  screenshots.push(path);
};
const waitFor = (predicate, argument) =>
  page.waitForFunction(predicate, argument, {timeout: 30000});
const waitForFrames = async (count = 8) => {
  const frame = await page.evaluate(() => window.treePlayground.frame.frame);
  await waitFor(previous => window.treePlayground.frame.frame >= previous, frame + count);
};
async function captureDefaultView(preset) {
  await page.locator(`[data-view="${preset}"]`).click();
  await page.evaluate(() => {
    window.__detailSettle = null;
  });
  await waitFor(() => window.treePlayground.stats.nearCount > 0);
  await waitForFrames(30);
  const settled = await page
    .waitForFunction(
      () => {
        const stats = window.treePlayground.stats;
        const key = `${stats.lodBias}:${stats.nearBudget}`;
        const now = performance.now();
        if (window.__detailSettle?.key !== key) window.__detailSettle = {key, since: now};
        return now - window.__detailSettle.since >= 4000;
      },
      null,
      {timeout: 10000}
    )
    .then(() => true)
    .catch(() => false);
  // Report only the final 30 actual RAF intervals after the automatic budget stops moving.
  await waitForFrames(30);
  const sample = await page.evaluate(name => {
    const app = window.treePlayground;
    const values = app.stats.frameTimes.slice(-30);
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      preset: name,
      samples: values.length,
      frameMeanMs: mean,
      frameP95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
      frameMaxMs: sorted.at(-1),
      fps: 1000 / mean,
      width: innerWidth,
      height: innerHeight,
      nearCount: app.stats.nearCount,
      visibleCount: app.stats.visibleCount,
      autoDetail: app.stats.autoDetail,
      lodBias: app.stats.lodBias,
      nearBudget: app.stats.nearBudget
    };
  }, preset);
  sample.settled = settled;
  interactiveViews.push(sample);
  await screenshot(`${preset}-defaults`);
}
/** Locate a solid crown pixel, then use an actual pointer click to test the application's pick path. */
async function pickSourceTree(kind) {
  const candidate = await page.evaluate(mode => {
    const app = window.treePlayground;
    const selected = app.frame.params.selectedIndex;
    const origin = app.trees[selected].position;
    const viewport = app.deck.getViewports()[0];
    const candidates = app.trees.map((tree, index) => ({tree, index}));
    if (mode === 'near') {
      candidates.sort(
        (a, b) =>
          Math.hypot(a.tree.position[0] - origin[0], a.tree.position[1] - origin[1]) -
          Math.hypot(b.tree.position[0] - origin[0], b.tree.position[1] - origin[1])
      );
    }
    let attempts = 0;
    for (let item = 0; item < candidates.length; item += mode === 'far' ? 31 : 1) {
      const {tree, index} = candidates[item];
      if (index === selected) continue;
      for (const offset of [
        [0, 0],
        [-0.5, 0],
        [0.5, 0],
        [0, -0.5],
        [0, 0.5]
      ]) {
        const point = viewport.project([
          tree.position[0] + offset[0] * tree.crownRadius,
          tree.position[1] + offset[1] * tree.crownRadius,
          tree.height * 0.65
        ]);
        const [x, y] = point;
        if (x < 12 || x > innerWidth - 12 || y < 65 || y > innerHeight - 50) continue;
        const surface = document.elementFromPoint(x, y);
        if (!surface || surface.closest('#controls, .performance, .masthead')) continue;
        const info = app.deck.pickObject({x, y, radius: 0});
        attempts++;
        const source = info?.object?.tree ?? info?.object;
        const sourceIndex = app.trees.indexOf(source);
        const layer = info?.sourceLayer?.id ?? info?.layer?.id ?? '';
        const matchesKind =
          mode === 'near' ? layer.includes('photoreal') : layer.includes('shell-far');
        if (matchesKind && sourceIndex >= 0 && sourceIndex !== selected)
          return {x, y, sourceIndex, layer, attempts};
        if (attempts >= 100) return null;
      }
    }
    return null;
  }, kind);
  assert.ok(candidate, `No ${kind} source-tree crown pixel found`);
  await page.mouse.click(candidate.x, candidate.y);
  await waitFor(
    index => window.treePlayground.frame.params.selectedIndex === index,
    candidate.sourceIndex
  );
  // The click selects the row immediately; the ring is submitted on the next field frame.
  await waitFor(index => {
    const app = window.treePlayground;
    const layer = app.deck.props.layers
      .flat(Infinity)
      .find(item => item?.id === 'selected-tree-ring');
    const tree = app.trees[index];
    return (
      layer?.props.data[0] === tree &&
      layer.props.getPosition(tree)[0] === tree.position[0] &&
      layer.props.getPosition(tree)[1] === tree.position[1]
    );
  }, candidate.sourceIndex);
  await page
    .getByRole('spinbutton', {name: 'Health numeric value', exact: true})
    .fill(kind === 'far' ? '0.63' : '0.71');
  await waitFor(({index, value}) => window.treePlayground.trees[index].health === value, {
    index: candidate.sourceIndex,
    value: kind === 'far' ? 0.63 : 0.71
  });
  const changed = await page.evaluate(
    value => window.treePlayground.trees.filter(tree => tree.health === value).length,
    kind === 'far' ? 0.63 : 0.71
  );
  assert.equal(changed, 1);
  check(`Actual ${kind} crown click selects source tree, moves ring and isolates edit`, {
    sourceIndex: candidate.sourceIndex,
    layer: candidate.layer
  });
}
let failure;
let stats;
try {
  page = await browser.newPage({viewport: {width: 1163, height: 654}, deviceScaleFactor: 1});
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${server}/playground.html?count=20000`, {waitUntil: 'domcontentloaded'});
  await waitFor(() => Boolean(window.treePlayground));
  // Botanical template compilation can be delayed while other repository checks share the CPU.
  await page.waitForFunction(() => window.treePlayground.stats.startupMs > 0, null, {
    timeout: 120000
  });
  await page.evaluate(() => window.treePlayground.ready);
  await page.locator('#loading').waitFor({state: 'detached'});
  const initial = await page.evaluate(() => {
    const app = window.treePlayground;
    const selected = app.frame.params.selectedIndex;
    window.__fieldRefs = {
      trees: app.trees,
      tree: app.trees[selected],
      position: app.trees[selected].position
    };
    return {
      count: app.trees.length,
      selected,
      row: app.trees[selected].row,
      startup: app.stats.startupMs
    };
  });
  assert.equal(initial.count, 20000);
  check('Ready with 20,000 trees and completed shader warmup', {startupMs: initial.startup});
  await screenshot('overview');

  await page.getByRole('spinbutton', {name: 'Health numeric value', exact: true}).fill('0.37');
  await waitFor(() => {
    const app = window.treePlayground;
    return app.trees[app.frame.params.selectedIndex].health === 0.37;
  });
  const selectedChanges = await page.evaluate(() => {
    const app = window.treePlayground;
    return {
      changed: app.trees.filter(tree => tree.health === 0.37).length,
      stable:
        app.trees === window.__fieldRefs.trees &&
        app.trees[app.frame.params.selectedIndex] === window.__fieldRefs.tree &&
        app.trees[app.frame.params.selectedIndex].position === window.__fieldRefs.position
    };
  });
  assert.equal(selectedChanges.changed, 1);
  assert.equal(selectedChanges.stable, true);
  check('Actual numeric input changes only selected tree, preserving data identity');

  await page.locator('#scope').selectOption('row');
  await page.getByRole('spinbutton', {name: 'Foliage numeric value', exact: true}).fill('0.44');
  await waitFor(() => {
    const app = window.treePlayground;
    const row = app.trees[app.frame.params.selectedIndex].row;
    return app.trees.every(tree => tree.foliage === (tree.row === row ? 0.44 : 1));
  });
  check('Actual row selector and numeric input isolate the selected row');

  await page.locator('#scope').selectOption('all');
  await page.getByRole('spinbutton', {name: 'New growth numeric value', exact: true}).fill('0.12');
  await waitFor(() => window.treePlayground.trees.every(tree => tree.flush === 0.12));
  check('Actual all-tree scope updates all 20,000 trees');

  await page.locator('#scope').selectOption('selected');
  const growth = page.getByRole('slider', {name: 'Growth', exact: true});
  await growth.focus();
  await growth.press('ArrowLeft');
  await waitFor(() => {
    const app = window.treePlayground;
    return app.trees[app.frame.params.selectedIndex].growth === 0.99;
  });
  check('Actual slider keyboard input updates selected tree');

  await page.getByRole('button', {name: 'Structure & damage', exact: true}).click();

  await page.getByRole('button', {name: 'Transitions & detail', exact: true}).click();
  const autoDetail = page.getByRole('checkbox', {name: 'Auto detail', exact: true});
  assert.equal(await autoDetail.isChecked(), true);
  await autoDetail.uncheck();
  await waitFor(() => window.treePlayground.stats.autoDetail === false);
  await page
    .getByRole('spinbutton', {name: 'Manual LOD bias numeric value', exact: true})
    .fill('1');
  await waitFor(() => window.treePlayground.frame.params.lodBias === 1);
  await autoDetail.check();
  await waitFor(() => window.treePlayground.stats.autoDetail === true);
  await page
    .getByRole('spinbutton', {name: 'Manual LOD bias numeric value', exact: true})
    .fill('0');
  await waitFor(
    () =>
      window.treePlayground.stats.autoDetail === false &&
      window.treePlayground.frame.params.lodBias === 0
  );
  assert.equal(await autoDetail.isChecked(), false);
  await autoDetail.check();
  await waitFor(() => window.treePlayground.stats.autoDetail === true);
  check('Actual Auto detail checkbox works and manual LOD input disables automatic budget');
  await page.getByRole('button', {name: 'Transitions & detail', exact: true}).click();
  await page
    .getByRole('spinbutton', {name: 'Height / metres numeric value', exact: true})
    .fill('4');
  await waitFor(() => {
    const app = window.treePlayground;
    return app.trees[app.frame.params.selectedIndex].height === 4;
  });
  const overflow = await page.evaluate(() => {
    const bounds = document.querySelector('#controls').getBoundingClientRect();
    return [...document.querySelectorAll('#settings input')]
      .filter(input => {
        const rect = input.getBoundingClientRect();
        return rect.width > 0 && (rect.left < bounds.left || rect.right > bounds.right + 1);
      })
      .map(input => input.getAttribute('aria-label'));
  });
  assert.deepEqual(overflow, []);
  check('Height input works and settings controls fit 338 px sidebar');
  await page.getByRole('button', {name: 'Structure & damage', exact: true}).click();

  // Remove focus from controls: shortcuts deliberately preserve native input/button keys.
  await page.mouse.click(700, 310);
  await page.keyboard.press('2');
  await waitFor(
    () => document.querySelector('[data-view="rows"]').getAttribute('aria-pressed') === 'true'
  );
  await page.keyboard.press('3');
  await waitFor(
    () => document.querySelector('[data-view="tree"]').getAttribute('aria-pressed') === 'true'
  );
  await page.keyboard.press('4');
  await waitFor(
    () => document.querySelector('[data-view="leaf"]').getAttribute('aria-pressed') === 'true'
  );
  check('Camera preset keys 2, 3 and 4 update real controls and camera');
  await screenshot('leaf-detail');

  await page.keyboard.press('Space');
  await waitFor(() => document.querySelector('#pause').getAttribute('aria-pressed') === 'true');
  const windBefore = await page.evaluate(() => {
    const app = window.treePlayground;
    return {time: app.frame.layerProps.windTime, frame: app.frame.frame};
  });
  await waitFor(previous => window.treePlayground.frame.frame >= previous + 5, windBefore.frame);
  const frozen = await page.evaluate(() => window.treePlayground.frame.layerProps.windTime);
  assert.equal(frozen, windBefore.time);
  await page.keyboard.press('Space');
  await waitFor(() => document.querySelector('#pause').getAttribute('aria-pressed') === 'false');
  check('Space pauses wind clock while frames continue, then resumes');

  await page.keyboard.press('1');
  await waitFor(
    () => document.querySelector('[data-view="overview"]').getAttribute('aria-pressed') === 'true'
  );
  const before = await page.evaluate(() => window.treePlayground.frame.camera.zoom);
  await page.mouse.move(730, 350);
  await page.mouse.wheel(0, -280);
  await waitFor(
    previous => Math.abs(window.treePlayground.frame.camera.zoom - previous) > 0.05,
    before
  );
  check('Real wheel navigation changes the OrbitView camera');

  await page.locator('#collapse').click();
  assert.equal(await page.locator('#controls-body').isHidden(), true);
  await page.locator('#collapse').click();
  assert.equal(await page.locator('#controls-body').isVisible(), true);
  check('Sidebar collapses and expands');
  await screenshot('controls-fit');

  await page.locator('[data-view="overview"]').click();
  await waitForFrames();
  await pickSourceTree('far');
  await page.locator('[data-view="tree"]').click();
  await waitFor(() => window.treePlayground.stats.nearCount > 0);
  await waitForFrames(16);
  await pickSourceTree('near');

  // Leave review images on a clean, freshly loaded 20k field with its normal defaults.
  await page.reload({waitUntil: 'domcontentloaded'});
  await waitFor(() => window.treePlayground?.stats.startupMs > 0);
  await page.locator('#loading').waitFor({state: 'detached'});
  await screenshot('overview-defaults');
  await captureDefaultView('tree');
  await captureDefaultView('leaf');
  stats = await page.evaluate(() => {
    const app = window.treePlayground;
    return {...app.stats, camera: app.frame.camera, revision: app.frame.revision};
  });
  assert.deepEqual(errors, []);
  check('No browser or WebGL console errors');
} catch (error) {
  failure = error;
  await screenshot('failure').catch(() => {});
} finally {
  await browser.close();
  const report = {
    pass: !failure,
    durationMs: performance.now() - started,
    checks,
    errors,
    failure: failure?.stack,
    stats,
    interactiveViews,
    screenshots
  };
  const reportPath = join(directory, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(
    `${JSON.stringify({pass: report.pass, checks: checks.length, report: reportPath, screenshots})}\n`
  );
}
if (failure) throw failure;
