// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {writeFileSync} from 'node:fs';

writeFileSync(
  new URL('../dist/index.cjs', import.meta.url),
  `module.exports = {
  ...require('./common-layers/index.cjs'),
  ...require('./vegetation-layers/index.cjs')
};
`
);
