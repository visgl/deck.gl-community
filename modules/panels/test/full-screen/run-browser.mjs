import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, preview} from 'vite';
import {chromium, webkit} from 'playwright';

const engine = process.env.PANEL_FULLSCREEN_BROWSER || 'chromium';
if (!['chromium', 'webkit'].includes(engine)) throw new Error(`Unknown browser: ${engine}`);
const outDir = await mkdtemp(join(tmpdir(), 'panels-fullscreen-'));
const options = {
  root: fileURLToPath(new URL('.', import.meta.url)),
  configFile: false,
  build: {outDir, emptyOutDir: true},
  preview: {host: '127.0.0.1', port: 0}
};
await build(options);
const server = await preview(options);
const browser = await (engine === 'webkit' ? webkit : chromium).launch({headless: true});
const sizes = [{width: 390, height: 844}, {width: 844, height: 390}];
try {
  for (const mode of ['missing', 'rejected', 'native']) {
    const context = await browser.newContext({viewport: sizes[0], isMobile: true, hasTouch: true});
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (mode !== 'native') await page.addInitScript(mode => {
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true,
        value: mode === 'missing' ? undefined : () => Promise.reject(new Error('Denied'))
      });
    }, mode);
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole('textbox', {name: 'Example value'}).fill('retained');
    const enter = page.getByRole('button', {name: 'Enter fullscreen'});
    await enter.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await enter.focus();
    await enter.press('Enter');
    await page.waitForFunction(() => ['native', 'fallback'].includes(document.getElementById('target').dataset.mode));
    const actual = await page.locator('#target').getAttribute('data-mode');
    if (mode !== 'native') assert.equal(actual, 'fallback');
    if (mode === 'native' && engine === 'chromium') assert.equal(actual, 'native');
    if (actual === 'native') {
      assert.equal(await page.evaluate(() => document.fullscreenElement === document.getElementById('target')), true);
      await page.getByRole('button', {name: 'Exit fullscreen'}).click();
      await page.waitForFunction(() => !document.fullscreenElement);
    } else {
      assert.equal(await page.getByRole('dialog', {name: 'Example visualization'}).count(), 1);
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.waitForFunction(() => {
          const rect = document.getElementById('target').getBoundingClientRect();
          return Math.abs(rect.width - innerWidth) < 2 && Math.abs(rect.height - innerHeight) < 2;
        });
        await page.evaluate(() => {document.body.style.overflow = 'auto';});
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
      }
      const exit = page.getByRole('button', {name: 'Exit fullscreen'});
      await exit.focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('textbox', {name: 'Example value'}).evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Escape');
    }
    await page.waitForFunction(() => document.getElementById('target').dataset.mode === 'none');
    assert.equal(await page.getByRole('textbox', {name: 'Example value'}).inputValue(), 'retained');
    assert.equal(await page.evaluate(() => window.originalCanvas === document.querySelector('#target canvas')), true);
    assert.equal(await enter.evaluate(element => element === document.activeElement), true);
    await page.waitForFunction(y => Math.abs(scrollY - y) < 2, scroll);
    assert.equal(await page.locator('#target').getAttribute('role'), 'region');
    assert.equal(await page.locator('#target').getAttribute('aria-modal'), null);
    assert.equal(await page.locator('html').getAttribute('data-deck-panel-fullscreen-lock'), null);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${engine}: ${mode} fullscreen, rotation, canvas/state preservation, focus, and cleanup passed`);
  }
} finally {
  await browser.close();
  server.httpServer.closeAllConnections?.();
  await new Promise(resolve => server.httpServer.close(resolve));
  await rm(outDir, {recursive: true, force: true});
}
