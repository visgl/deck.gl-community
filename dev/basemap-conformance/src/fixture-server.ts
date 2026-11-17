// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * A Vite plugin that serves recorded network fixtures to the test page and to its workers, and
 * receives the renders a runner saves. Node only. It is the one place a request for a fixture is
 * seen, whichever renderer, thread or loader made it, so it also checks hermeticity: every request
 * and every miss is logged, and the runner reads (and clears) that log after each render.
 *
 * - `GET  /__conformance__/fixtures/<host>/<path>`: the fixture recorded from `https://<host>/<path>`.
 *   Looked up in each of `fixtureRoots` in turn. A path without an extension is a TileJSON
 *   endpoint, stored as `<path>/index.json`. A missing fixture is a 404, never the HTML fallback.
 *   With `record: true`, a missing fixture is downloaded from Node, written to the first root and
 *   served: one run records everything every renderer asks for.
 * - `GET  /__conformance__/log`: `{requests, misses, recorded}` since the last read, then cleared.
 * - `POST /__conformance__/output/<path>`: writes the request body to `<outputDirectory>/<path>`.
 * - `POST /__conformance__/inputs`: `{scene, styleFixture, fixtureRequests}` in, the input digests
 *   of the render out (`computeRenderInputs`, over the fixtures as the roots hold them now).
 */

import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, normalize, resolve, sep} from 'node:path';
import {computeRenderInputs} from './provenance';

export const FIXTURE_PREFIX = '/__conformance__/fixtures/';
const LOG_PATH = '/__conformance__/log';
const OUTPUT_PREFIX = '/__conformance__/output/';
const INPUTS_PATH = '/__conformance__/inputs';

export type FixtureServerOptions = {
  /** Directories of recorded fixtures, `<host>/<path>`, searched in order. Records go to the first. */
  fixtureRoots: string[];
  /** Where `POST /__conformance__/output/...` writes. */
  outputDirectory: string;
  /** Download missing fixtures (the only time the network is used). */
  record?: boolean;
};

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.pbf': 'application/x-protobuf',
  '.mvt': 'application/vnd.mapbox-vector-tile',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/** The fixture file path, relative to a root, of the part of a fixture URL after the prefix. */
export function getFixtureFilePath(urlPath: string): string {
  let path = decodeURIComponent(urlPath.split('?')[0]);
  if (!/\.[^/]+$/.test(path)) {
    path = `${path.replace(/\/$/, '')}/index.json`;
  }
  const normalized = normalize(path);
  if (normalized.startsWith('..') || normalized.startsWith(sep)) {
    throw new Error(`Fixture path escapes its root: ${urlPath}`);
  }
  return normalized;
}

function contentType(path: string): string {
  const extension = path.slice(path.lastIndexOf('.'));
  return CONTENT_TYPES[extension] || 'application/octet-stream';
}

async function readBody(request: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function conformanceFixtureServer(options: FixtureServerOptions) {
  const roots = options.fixtureRoots.map(root => resolve(root));
  const output = resolve(options.outputDirectory);
  let log = {requests: [] as string[], misses: [] as string[], recorded: [] as string[]};

  async function serveFixture(
    urlPath: string
  ): Promise<{status: number; body?: Buffer; type?: string}> {
    const path = getFixtureFilePath(urlPath);
    log.requests.push(path);
    for (const root of roots) {
      const file = join(root, path);
      if (existsSync(file)) {
        return {status: 200, body: await readFile(file), type: contentType(file)};
      }
    }
    if (options.record) {
      // The URL keeps the original encoding of its path (glyph font stacks hold spaces and commas).
      const remote = `https://${urlPath.split('?')[0]}`;
      const response = await fetch(remote);
      if (response.ok) {
        const body = Buffer.from(await response.arrayBuffer());
        const file = join(roots[0], path);
        await mkdir(dirname(file), {recursive: true});
        await writeFile(file, body);
        log.recorded.push(path);
        return {status: 200, body, type: contentType(file)};
      }
      // Tiles outside a source's data can 404 upstream: record nothing, answer the same.
      log.misses.push(`${path} (upstream ${response.status})`);
      return {status: response.status};
    }
    log.misses.push(path);
    return {status: 404};
  }

  return {
    name: 'basemap-conformance-fixtures',
    configureServer(server: any) {
      server.middlewares.use(async (request: any, response: any, next: () => void) => {
        const url: string = request.url || '';
        try {
          if (url.startsWith(FIXTURE_PREFIX)) {
            const result = await serveFixture(url.slice(FIXTURE_PREFIX.length));
            response.statusCode = result.status;
            response.setHeader('Access-Control-Allow-Origin', '*');
            // Every request must reach the log: no render may be served from the browser cache.
            response.setHeader('Cache-Control', 'no-store');
            if (result.body) {
              response.setHeader('Content-Type', result.type!);
              response.end(result.body);
            } else {
              response.end();
            }
            return;
          }
          if (url.startsWith(LOG_PATH)) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(log));
            log = {requests: [], misses: [], recorded: []};
            return;
          }
          if (url.startsWith(INPUTS_PATH) && request.method === 'POST') {
            const body = JSON.parse((await readBody(request)).toString('utf8'));
            const inputs = computeRenderInputs({
              scene: body.scene,
              styleFixture: body.styleFixture,
              fixtureRequests: body.fixtureRequests,
              fixtureRoots: roots
            });
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(inputs));
            return;
          }
          if (url.startsWith(OUTPUT_PREFIX) && request.method === 'POST') {
            const path = normalize(decodeURIComponent(url.slice(OUTPUT_PREFIX.length)));
            if (path.startsWith('..')) {
              throw new Error(`Output path escapes its directory: ${path}`);
            }
            const file = join(output, path);
            await mkdir(dirname(file), {recursive: true});
            await writeFile(file, await readBody(request));
            response.end('ok');
            return;
          }
        } catch (error) {
          response.statusCode = 500;
          response.end(String((error as Error)?.stack || error));
          return;
        }
        next();
      });
    }
  };
}

/**
 * Chromium flags that make every host but the test server unresolvable, for the page and its
 * workers alike: a request that would leave the machine fails instead of reaching the network.
 */
export const HERMETIC_CHROMIUM_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'
];
