// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The basemap conformance runner (report only, not part of `yarn test`): the headless project's
 * resolution, with the shared fixture server and a browser that cannot reach the network.
 *
 *   yarn test-conformance      renders every scene into dev/basemap-conformance/__output__
 *   yarn conformance-report    scores them: report.md, scores.json, images/
 *
 * VITE_CONFORMANCE_SCENES selects scenes (ids or style ids, default all), and
 * VITE_CONFORMANCE_RENDERERS renderers (default `maplibre,basemap-layer`). CONFORMANCE_RECORD=1
 * downloads missing fixtures; CONFORMANCE_OUTPUT moves the output directory.
 */

import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import ROOT_CONFIG from './vitest.config';
import {
  HERMETIC_CHROMIUM_ARGS,
  conformanceFixtureServer
} from './dev/basemap-conformance/src/fixture-server';

const headless = (ROOT_CONFIG as any).test.projects.find(
  (project: any) => project.test?.name === 'headless'
);
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: headless.resolve,
  optimizeDeps: headless.optimizeDeps,
  plugins: [
    ...headless.plugins,
    conformanceFixtureServer({
      fixtureRoots: [
        path('./dev/basemap-conformance/fixtures'),
        path('./modules/basemap-layers/tests/reference-render/fixtures')
      ],
      outputDirectory:
        process.env.CONFORMANCE_OUTPUT || path('./dev/basemap-conformance/__output__'),
      record: process.env.CONFORMANCE_RECORD === '1'
    })
  ],
  test: {
    name: 'conformance',
    include: ['modules/**/*.conformance.ts'],
    fileParallelism: false,
    testTimeout: 400_000,
    hookTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({launchOptions: {args: HERMETIC_CHROMIUM_ARGS}}),
      instances: [{browser: 'chromium'}]
    }
  }
});
