// Visits every built example page in headless Chromium and fails on errors that users would hit.
// Run after `yarn build`: `yarn check-examples [route-substring...]`.

import {createServer} from 'node:http';
import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const BUILD_DIRECTORY = fileURLToPath(new URL('../build/', import.meta.url));
const BASE_URL = '/deck.gl-community/';
// Software GL on CI is slow to compile the larger examples' shaders.
const RENDER_TIMEOUT_MS = 45000;
const SETTLE_MS = 3000;
// CI's software renderer starves concurrent WebGL pages, like the headless test suites.
const CONCURRENT_PAGES = process.env.GITHUB_ACTIONS === 'true' ? 1 : 3;

// Pages that legitimately render no canvas of their own. Every other example page must.
const PAGES_WITHOUT_CANVAS = {
  'examples/react-fiber/overview': 'documentation only',
  'examples/react-fiber/multi-canvas': 'runs as a standalone application',
  'examples/widgets/standalone-widgets': 'widgets over plain HTML',
  // TODO: these pages describe a demo but their .mdx never renders it.
  'examples/vega/geospatial': 'demo not embedded',
  'examples/vega/map-to-stacks': 'demo not embedded',
  'examples/vega/mark-transitions': 'demo not embedded'
};

// Pages that need credentials CI builds do not have. Only the matching errors are ignored.
const CREDENTIAL_ERRORS = {
  // GoogleMapsAPIKey is only provided to the deploy build.
  'examples/editable-layers/3d-tiles': /tile\.googleapis\.com|status of 403/,
  // No build provides VITE_BING_MAPS_API_KEY, so this also fails on the live site.
  'examples/bing-maps/get-started': /credentials are invalid/
};

const CONTENT_TYPES = {
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** Serves the build directory under the site's base URL, like GitHub Pages. */
function startServer() {
  const server = createServer(async (request, response) => {
    const {pathname} = new URL(request.url, 'http://localhost');
    if (!pathname.startsWith(BASE_URL)) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(pathname.slice(BASE_URL.length));
    const filePath = path.join(BUILD_DIRECTORY, relative);
    const candidates = [filePath, path.join(filePath, 'index.html'), `${filePath}.html`];
    for (const candidate of candidates) {
      if (candidate.startsWith(BUILD_DIRECTORY) && (await isFile(candidate))) {
        const type = CONTENT_TYPES[path.extname(candidate)] || 'application/octet-stream';
        response.writeHead(200, {'Content-Type': type}).end(await readFile(candidate));
        return;
      }
    }
    response.writeHead(404).end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function findExampleRoutes(directory = path.join(BUILD_DIRECTORY, 'examples')) {
  const routes = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      routes.push(...(await findExampleRoutes(entryPath)));
    } else if (entry.name.endsWith('.html') && entry.name !== 'index.html') {
      // With `trailingSlash: false` each page is `<route>.html`; `index.html` files are redirects.
      routes.push(`${BASE_URL}${path.relative(BUILD_DIRECTORY, entryPath).slice(0, -'.html'.length)}`);
    }
  }
  return routes.sort();
}

/** Loads one example page and returns the problems a visitor would hit. */
async function checkRoute(context, origin, route) {
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`uncaught: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') {
      problems.push(`console.error: ${message.text()}`);
    }
  });
  page.on('response', response => {
    // Missing site assets are bugs; third-party data outages are not ours to fail on.
    if (response.status() >= 400 && response.url().startsWith(origin)) {
      problems.push(`HTTP ${response.status()}: ${response.url().slice(origin.length)}`);
    }
  });
  const pagePath = route.slice(BASE_URL.length);
  try {
    await page.goto(`${origin}${route}`, {waitUntil: 'domcontentloaded', timeout: 60000});
    if (!PAGES_WITHOUT_CANVAS[pagePath]) {
      // A silently failed mount leaves an empty demo area, so require a rendered canvas.
      const rendered = await page
        .waitForFunction(
          () =>
            document.querySelector('main canvas') ||
            [...document.querySelectorAll('main iframe')].some(frame =>
              frame.contentDocument?.querySelector('canvas')
            ),
          null,
          {timeout: RENDER_TIMEOUT_MS, polling: 500}
        )
        .then(() => true)
        .catch(() => false);
      if (!rendered) {
        problems.push(`no canvas rendered within ${RENDER_TIMEOUT_MS / 1000}s`);
      }
    }
    await page.waitForTimeout(SETTLE_MS);
  } catch (error) {
    problems.push(`navigation: ${error.message}`);
  } finally {
    await page.close();
  }
  const allowed = CREDENTIAL_ERRORS[pagePath];
  return [...new Set(problems)].filter(problem => !allowed?.test(problem));
}

const filters = process.argv.slice(2);
const server = await startServer();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(
  process.env.GITHUB_ACTIONS === 'true' ? {channel: 'chrome'} : {}
);
const failures = [];
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  const routes = (await findExampleRoutes()).filter(
    route => filters.length === 0 || filters.some(filter => route.includes(filter))
  );
  const queue = [...routes];
  const checkNext = async () => {
    for (let route = queue.shift(); route; route = queue.shift()) {
      const started = Date.now();
      const problems = await checkRoute(context, origin, route);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${problems.length > 0 ? '✗' : '✓'} ${route} (${seconds}s)`);
      if (problems.length > 0) {
        failures.push({route, problems});
      }
    }
  };
  await Promise.all(Array.from({length: CONCURRENT_PAGES}, checkNext));

  for (const {route, problems} of failures.sort((a, b) => a.route.localeCompare(b.route))) {
    console.log(`\n${route}`);
    for (const problem of problems) {
      console.log(`    ${problem.split('\n')[0].slice(0, 300)}`);
    }
  }
  console.log(`\n${routes.length - failures.length}/${routes.length} example pages passed`);
} finally {
  await browser.close();
  server.close();
}
process.exitCode = failures.length > 0 ? 1 : 0;
