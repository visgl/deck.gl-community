// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = resolve(HERE, '../..');

/**
 * Node tests of the film's pure logic. From the repository root:
 * `yarn vitest run --config dev/tree-lifecycle/vitest.config.ts`.
 */
export default defineConfig({
  root: HERE,
  resolve: {
    alias: [
      {
        find: /^@deck\.gl-community\/layers$/,
        replacement: resolve(REPOSITORY, 'modules/layers/src/index.ts')
      }
    ]
  },
  test: {
    name: 'tree-lifecycle',
    environment: 'node',
    include: ['test/**/*.spec.ts']
  }
});
