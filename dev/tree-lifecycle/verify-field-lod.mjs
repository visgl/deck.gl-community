// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Camera, shadow, and visible-fruit regressions. Run with the playground dev server active. */
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const directory = resolve(option('out', join(tmpdir(), 'tree-field-lod-qa')));
const server = option('server', 'http://127.0.0.1:4393');
mkdirSync(directory, {recursive: true});
const errors = [];
const checks = [];
const screenshots = [];
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
const page = await browser.newPage({viewport: {width: 1163, height: 654}, deviceScaleFactor: 1});
page.setDefaultTimeout(30000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});
const waitFor = (predicate, value) => page.waitForFunction(predicate, value, {timeout: 30000});
const frames = async count => {
  const start = await page.evaluate(() => window.treePlayground.frame.frame);
  await waitFor(target => window.treePlayground.frame.frame >= target, start + count);
};
const check = (name, details = {}) => {
  checks.push({name, pass: true, ...details});
  process.stdout.write(`${name}: PASS\n`);
};
const screenshot = async name => {
  const path = join(directory, `${name}.png`);
  const bytes = await page.screenshot({path});
  screenshots.push(path);
  return PNG.sync.read(bytes);
};
const cropState = () =>
  page.evaluate(() => {
    const app = window.treePlayground;
    const selected = app.trees[app.frame.params.selectedIndex];
    const roots = app.deck.props.layers.flat(Infinity);
    const canopy = roots.find(layer => layer?.id === 'shell-near');
    const crops = roots.find(layer => layer?.id === 'shell-crops');
    const row = crops?.state?.photoreal?.rows.find(item => item?.object.tree === selected);
    const layers = app.deck.layerManager.getLayers();
    let instances = 0;
    const primitiveIds = [];
    for (const layer of layers) {
      if (!layer.id.startsWith('shell-crops-photoreal-crops-') || !layer.props.visible) continue;
      const refs = layer.props.data?.attributes?.instanceCropRef?.value;
      if (!refs || !row) continue;
      for (let index = 0; index < refs.length; index += 3) {
        if (refs[index] === row.stateRow) instances++;
      }
      if (refs.length > 0) primitiveIds.push(layer.id);
    }
    const centre = app.deck
      .getViewports()[0]
      .project([selected.position[0], selected.position[1], selected.height * 0.65]);
    return {
      selected: app.frame.params.selectedIndex,
      canopyResident: Boolean(canopy?.props.data.some(item => item.tree === selected)),
      cropResident: Boolean(crops?.props.data.some(item => item.tree === selected)),
      cropTrees: crops?.props.data.length ?? 0,
      cropBias: crops?.props.lodBias,
      cropScale: crops?.state?.photoreal?.cropPixelScale,
      instances,
      primitiveIds,
      centre,
      camera: app.frame.camera,
      nearCount: app.stats.nearCount
    };
  });

async function verifyRenderingDiagnostics() {
  const getView = () => page.evaluate(() => window.treePlayground.deck.props.viewState.orchard);
  const setView = async view => {
    await page.evaluate(viewState => {
      window.treePlayground.deck.props.onViewStateChange({viewState});
    }, view);
    await frames(12);
  };
  const getShadow = () =>
    page.evaluate(() => {
      const {span, texelMetres, snappedCenter, mapSize} = window.treePlayground.shadow;
      return {span, texelMetres, snappedCenter, mapSize};
    });
  const view = {...(await getView()), zoom: 9, rotationX: 14};
  const held = await page.evaluate(viewState => {
    const app = window.treePlayground;
    const previous = app.deck.getViewports()[0];
    const bearing = app.frame.camera.bearing;
    app.deck.props.onViewStateChange({viewState});
    return app.deck.getViewports()[0] === previous && app.frame.camera.bearing === bearing;
  }, {...view, rotationOrbit: 55});
  assert.equal(held, true, 'Camera input must wait for the matching tree submissions');
  const tested = [];
  let shadow;
  for (const rotationOrbit of [55, -55]) {
    await setView({...view, rotationOrbit});
    const coverage = await page.evaluate(() => {
      const app = window.treePlayground;
      const setup = window.shellSetup;
      const viewport = app.deck.getViewports()[0];
      let visible = 0;
      let missing = 0;
      for (let cell = 0; cell < setup.cells.length; cell++) {
        const {east, north, up, trees} = setup.cells[cell];
        if (!trees.length) continue;
        const [x, y, depth] = viewport.project([east, north, up]);
        if (depth < -1 || depth > 1 || x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) {
          continue;
        }
        visible++;
        if (setup.bucketOfCell[cell] < 0 && !setup.nearByTree.has(trees[0])) missing++;
      }
      return {visible, missing};
    });
    assert.ok(coverage.visible > 100);
    assert.equal(coverage.missing, 0);
    tested.push({rotationOrbit, ...coverage});
    const current = await getShadow();
    assert.ok(current);
    if (shadow) assert.deepEqual(current, shadow, 'Orbit must leave the light-space window fixed');
    shadow = current;
  }
  check('Camera and culling update together through tilted views', {angles: tested});
  await setView({
    ...view,
    rotationOrbit: -55,
    zoom: view.zoom + 0.05,
    target: [view.target[0] + 0.22, view.target[1] - 0.13, view.target[2]]
  });
  const panned = await getShadow();
  assert.deepEqual(panned.span, shadow.span);
  const shifts = [0, 1].map(axis =>
    (panned.snappedCenter[axis] - shadow.snappedCenter[axis]) / shadow.texelMetres
  );
  assert.ok(shifts.some(shift => Math.abs(shift) >= 1));
  assert.ok(shifts.every(shift => Math.abs(shift - Math.round(shift)) < 1e-8));
  check('Orbit fixes the shadow window and panning shifts it in whole texels', {shadow, shifts});

  await page.evaluate(viewState => {
    window.treePlayground.deck.props.onViewStateChange({viewState});
  }, {...view, zoom: 3.3, rotationOrbit: -55});
  await waitFor(
    oldSpan =>
      window.treePlayground.shadow.span[1] !== oldSpan &&
      window.treePlayground.shadow.historyWeight > 0,
    panned.span[1]
  );
  await waitFor(() => window.treePlayground.shadow.historyWeight === 0);
  check('Crossing a shadow scale blends the previous map and releases its contribution');
  await setView({...view, rotationOrbit: -55});

  assert.equal(await page.evaluate(() => Boolean(window.shellSetup.diagnostics)), false);
  const disclosure = page.locator('#render-diagnostics summary');
  await disclosure.click();
  await waitFor(() => Boolean(window.shellSetup.diagnostics));
  const culled = await page.evaluate(() => {
    const setup = window.shellSetup;
    const cell = setup.cells.findIndex(
      (_, index) =>
        setup.diagnostics.shellReasons[index] === 2 || setup.diagnostics.shellReasons[index] === 3
    );
    return setup.cells[cell].trees[0] + 1;
  });
  await page.getByLabel('Inspect tree #').fill(String(culled));
  const output = page.locator('#diagnostic-result');
  await waitFor(() =>
    document.querySelector('#diagnostic-result').textContent.includes('Shell — Outside')
  );
  assert.match(await output.textContent(), /projected width/);
  const compare = page.getByLabel('Bypass near geometry compaction');
  await compare.check();
  await waitFor(() => window.treePlayground.frame.params.leafCulling === 0);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Save frame snapshot'}).click();
  const download = await downloading;
  const snapshot = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(snapshot.inspected.tree, culled);
  assert.equal(snapshot.cells.reduce((count, cell) => count + cell.trees.length, 0), 20000);
  assert.equal(snapshot.leafCompaction, false);
  assert.equal(snapshot.woodCompaction, false);
  assert.ok(snapshot.shadow.texelMetres > 0);
  await download.saveAs(join(directory, 'frame-snapshot.json'));
  await compare.uncheck();
  await waitFor(() => window.treePlayground.frame.params.leafCulling !== 0);
  await setView({...view, rotationOrbit: 55, target: [view.target[0], view.target[1], 4.6]});
  const budgetTree = await page.evaluate(() => {
    const setup = window.shellSetup;
    const cell = setup.cells.findIndex(
      (_, index) =>
        setup.diagnostics.nearReasons[index] === 4 &&
        setup.diagnostics.nearCoverage[index] > 0.75 &&
        setup.bucketOfCell[index] >= 0
    );
    return cell >= 0 ? String(setup.cells[cell].trees[0] + 1) : '';
  });
  await page.getByLabel('Inspect tree #').fill(budgetTree);
  await frames(10);
  await disclosure.evaluate(summary => summary.scrollIntoView({block: 'start'}));
  await screenshot('tilted-diagnostics');

  const east = await page.evaluate(() => window.treePlayground.trees.findLast(tree => tree.row === 0).position[0]);
  await setView({...view, rotationOrbit: -39, rotationX: 43, zoom: 3.3, target: [east - 3, 0, 0]});
  await page.getByLabel('Show crown markers').uncheck();
  const outside = await page.evaluate(east => {
    const viewport = window.treePlayground.deck.getViewports()[0];
    return viewport.project([east + 18, -5, 0]).slice(0, 2);
  }, east);
  await page.keyboard.down('Alt');
  await page.mouse.click(...outside);
  await page.keyboard.up('Alt');
  await waitFor(() => document.querySelector('#diagnostic-result').textContent.includes('outside the planted rows'));
  await screenshot('planted-boundary');
  const shellCount = await page.evaluate(() => window.shellSetup.field.bucketStarts[6]);
  const bypass = page.getByLabel('Bypass shell frustum culling');
  await bypass.check();
  await waitFor(count => window.shellSetup.field.bucketStarts[6] > count, shellCount);
  await bypass.uncheck();
  await waitFor(count => window.shellSetup.field.bucketStarts[6] === count, shellCount);
  check('Ground probe identifies the planted edge and can compare shell frustum culling');

  await disclosure.click();
  await waitFor(() => !window.shellSetup.diagnostics);
  assert.equal(await page.locator('#diagnostics-overlay').isHidden(), true);
  await page.locator('#controls').evaluate(controls => {
    controls.scrollTop = 0;
  });
  check('Inspector traces a culled tree, compares compaction and exports the full frame');
}

async function verifyGroundShadows() {
  await page.evaluate(() => {
    const app = window.treePlayground;
    const edge = app.trees.find(tree => tree.row === 0 && Math.abs(tree.position[0]) < 4);
    app.selectTree(app.trees.indexOf(edge));
    app.setSetting('lodBias', 0);
    app.setSetting('windStrength', 0);
    app.setSetting('nearMost', 8);
    app.setPreset('tree');
  });
  await frames(12);
  await page.evaluate(() => {
    const app = window.treePlayground;
    const edge = app.trees[app.frame.params.selectedIndex];
    app.deck.props.onViewStateChange({
      viewState: {
        ...app.deck.props.viewState.orchard,
        target: [edge.position[0], edge.position[1], 1.5],
        rotationOrbit: 0,
        rotationX: 55,
        zoom: Math.log2((innerHeight * 1.5) / 2)
      }
    });
  });
  await waitFor(() => {
    const shadow = window.treePlayground.shadow;
    return shadow.span[1] === 32 && shadow.historyWeight === 0;
  });
  await frames(24);
  const result = await page.evaluate(async () => {
    const app = window.treePlayground;
    const {deck} = app;
    const {layerFilter, onAfterRender} = deck.props;
    const gl = deck.device.gl;
    const read = filter =>
      new Promise(resolve => {
        deck.setProps({
          layerFilter: filter,
          onAfterRender: context => {
            onAfterRender(context);
            const {drawingBufferWidth: width, drawingBufferHeight: height} = gl;
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            resolve(pixels);
          }
        });
        deck.redraw('ground shadow regression');
      });
    try {
      const shadowed = await read(layerFilter);
      const {fbo} = deck.props.effects[0].shadowPasses[0];
      const map = fbo.device.readPixelsToArrayWebGL(fbo);
      let occupiedTexels = 0;
      for (let i = 0; i < map.length; i += 4) {
        if (map[i] < 255) occupiedTexels++;
      }

      // Remove only the near root from the shadow pass. Keep the same color draws and geometry.
      const withoutNearCasters = await read(
        ({layer, renderPass}) => renderPass !== 'shadow' || layer.id !== 'shell-near'
      );
      const unshadowed = await read(({renderPass}) => renderPass !== 'shadow');
      const groundColor = deck.props.layers.find(layer => layer?.id === 'playground-ground').props.getFillColor;
      const colorChannels = [0, 1, 2];
      let darkenedGroundPixels = 0;
      for (let i = 0; i < unshadowed.length; i += 4) {
        if (
          unshadowed[i + 3] === 255 &&
          colorChannels.every(
            channel =>
              unshadowed[i + channel] === groundColor[channel] &&
              shadowed[i + channel] <= withoutNearCasters[i + channel] - 3
          )
        )
          darkenedGroundPixels++;
      }
      const near = deck.layerManager.getLayers().find(layer => layer.id === 'shell-near');
      const selected = app.trees[app.frame.params.selectedIndex];
      const selectedTierZero = [...near.state.photoreal.groups.values()].some(group =>
        group.buckets[0].some(row => row.object.tree === selected)
      );
      return {selectedTierZero, darkenedGroundPixels, occupiedTexels, mapTexels: map.length / 4};
    } finally {
      deck.setProps({layerFilter, onAfterRender});
    }
  });
  assert.equal(result.selectedTierZero, true, 'The selected crown must be at maximum detail');
  assert.ok(
    result.darkenedGroundPixels > 1000,
    `Near casters must visibly darken the ground; saw ${result.darkenedGroundPixels} pixels`
  );
  assert.ok(
    result.occupiedTexels > 0 && result.occupiedTexels < result.mapTexels / 4,
    'The ground must receive shadows without filling the caster map'
  );
  check('Near casters darken visible ground at the closest shadow scale', result);
}

let failure;
let retreat;
try {
  await page.goto(`${server}/playground.html?count=20000`, {waitUntil: 'domcontentloaded'});
  await waitFor(() => window.treePlayground?.stats.startupMs > 0);
  await page.locator('#loading').waitFor({state: 'detached'});
  const defaults = await page.evaluate(() => {
    const {params} = window.treePlayground.frame;
    return {
      nearIn: params.nearIn,
      nearOut: params.nearOut,
      finePixels: params.finePixels,
      tinyPixels: params.tinyPixels
    };
  });
  assert.deepEqual(defaults, {nearIn: 200, nearOut: 170, finePixels: 16, tinyPixels: 8});
  await verifyRenderingDiagnostics();
  await page.evaluate(() => window.treePlayground.setPreset('leaf'));
  await frames(8);
  const distantCrown = await page.evaluate(() => {
    const app = window.treePlayground;
    const viewport = app.deck.getViewports()[0];
    const [eyeX, eyeY, eyeZ] = viewport.cameraPosition;
    return app.trees.some(tree => {
      const [x, y, z] = tree.position;
      const top = z + tree.height * 0.6;
      const distance = Math.hypot(x - eyeX, y - eyeY, top - eyeZ);
      if (distance < 80 || distance > 150) return false;
      const [px, py, depth] = viewport.project([x, y, top]);
      return depth >= 0 && depth < 1 && px > 0 && px < innerWidth && py > 0 && py < innerHeight;
    });
  });
  assert.ok(distantCrown, 'Leaf zoom must preserve the distant orchard within the camera view');
  check('Leaf zoom keeps distant crowns inside the render frustum');

  await page.getByRole('button', {name: 'Transitions & detail', exact: true}).click();
  const reach = page.getByRole('spinbutton', {name: 'Detail reach numeric value', exact: true});
  assert.equal(await reach.inputValue(), '1.5');
  await reach.scrollIntoViewIfNeeded();
  await reach.fill('2');
  await reach.press('Tab');
  await waitFor(() => window.treePlayground.frame.params.nearIn === 150);
  await frames(3);
  assert.equal(
    await page.evaluate(() => {
      const shell = window.treePlayground.deck.props.layers
        .flat(Infinity)
        .find(l => l?.id === 'shell-far');
      return shell.props.lodPixels[1];
    }),
    12
  );
  await reach.fill('1.5');
  await reach.press('Tab');
  await waitFor(() => window.treePlayground.frame.params.nearIn === 200);
  check('Detail reach defaults to 1.5 and live input extends canopy and shell detail');

  // Freeze the fixture so the image difference below can only come from the edited fruit.
  await page.evaluate(() => {
    const app = window.treePlayground;
    app.setSetting('autoDetail', false);
    app.setSetting('lodBias', 0);
    app.setSetting('transitionMs', 0);
    app.setSetting('windStrength', 0);
    app.setSetting('cropCount', 500);
    app.setSetting('cropSize', 0.08);
    app.setSetting('cropRipeness', 1);
    app.setPreset('tree');
  });
  await waitFor(() => {
    const app = window.treePlayground;
    const near = app.deck.props.layers.flat(Infinity).find(layer => layer?.id === 'shell-near');
    const selected = app.trees[app.frame.params.selectedIndex];
    return near?.props.data.some(item => item.tree === selected);
  });
  await frames(20);
  const near = await cropState();
  assert.ok(near.instances > 0, 'Detailed selected tree must render fruit');
  await screenshot('tree-with-fruit');

  // Retreat using actual wheel navigation until the selected canopy hands over to its shell.
  for (let step = 0; step < 8; step++) {
    await page.mouse.move(760, 330);
    await page.mouse.wheel(0, 180);
    await frames(24);
    retreat = await cropState();
    if (!retreat.canopyResident) break;
  }
  assert.equal(retreat.canopyResident, false, 'Retreat must finish the selected canopy handoff');
  assert.equal(retreat.cropResident, true, 'Fruit residency must survive the canopy handoff');
  assert.ok(retreat.instances > 0, 'Actual crop primitive instances must survive the handoff');
  assert.ok(retreat.cropTrees <= 256);
  assert.equal(retreat.cropBias, 0);
  assert.equal(retreat.cropScale, 1);
  check(
    'Real camera retreat retains rendered fruit after selected canopy becomes a shell',
    retreat
  );

  await page.locator('#collapse').click();
  await page.evaluate(() => window.treePlayground.setSetting('cropCount', 0));
  await frames(12);
  const empty = await cropState();
  assert.equal(empty.instances, 0, 'A zero-fruit edit must remove selected crop instances');
  const before = await screenshot('shell-without-fruit');
  await page.evaluate(() => window.treePlayground.setSetting('cropCount', 500));
  await frames(12);
  const filled = await cropState();
  assert.ok(filled.instances > 0, 'Restoring fruit must update the crop-only pass');
  const after = await screenshot('shell-with-fruit');
  let changed = 0;
  let orange = 0;
  // Ignore all controls/readouts and compare the canvas around the selected crown.
  const [cx, cy] = filled.centre;
  for (let y = Math.max(70, Math.floor(cy - 170)); y < Math.min(after.height - 65, cy + 170); y++) {
    for (
      let x = Math.max(345, Math.floor(cx - 170));
      x < Math.min(after.width - 20, cx + 170);
      x++
    ) {
      const i = (y * after.width + x) * 4;
      const difference =
        Math.abs(before.data[i] - after.data[i]) +
        Math.abs(before.data[i + 1] - after.data[i + 1]) +
        Math.abs(before.data[i + 2] - after.data[i + 2]);
      if (difference <= 30) continue;
      changed++;
      if (
        after.data[i] > 80 &&
        after.data[i] > after.data[i + 1] * 1.2 &&
        after.data[i] > after.data[i + 2] * 1.5
      )
        orange++;
    }
  }
  assert.ok(changed > 12, `Expected visible crop pixels beyond handoff; saw ${changed}`);
  assert.ok(orange > 5, `Expected visible orange fruit beyond handoff; saw ${orange}`);
  check('Fruit edits remain visibly effective outside near canopy residency', {
    changedPixels: changed,
    orangePixels: orange,
    instances: filled.instances
  });
  await frames(60);
  const cadence = await page.evaluate(() => {
    const values = window.treePlayground.stats.frameTimes.slice(-60);
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, ms) => sum + ms, 0) / values.length;
    return {
      samples: values.length,
      meanMs: mean,
      fps: 1000 / mean,
      p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
      nearCount: window.treePlayground.stats.nearCount,
      width: innerWidth,
      height: innerHeight
    };
  });
  check('Recorded real frame cadence at crop handoff', cadence);
  // The shadow fixture needs the original field after the fruit and navigation edits.
  await page.reload({waitUntil: 'domcontentloaded'});
  await waitFor(() => window.treePlayground?.stats.startupMs > 0);
  await page.locator('#loading').waitFor({state: 'detached'});
  await verifyGroundShadows();
  assert.deepEqual(errors, []);
  check('No browser or WebGL errors');
} catch (error) {
  failure = error;
  await screenshot('failure').catch(() => {});
} finally {
  await browser.close();
  const report = {pass: !failure, checks, errors, failure: failure?.stack, retreat, screenshots};
  const reportPath = join(directory, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(
    `${JSON.stringify({pass: report.pass, checks: checks.length, report: reportPath})}\n`
  );
}
if (failure) throw failure;
