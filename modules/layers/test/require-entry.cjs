// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

const assert = require('node:assert/strict');
const root = require('@deck.gl-community/layers');
const common = require('@deck.gl-community/layers/common-layers');
const tree = require('@deck.gl-community/layers/tree-layers');
const extensions = require('@deck.gl-community/layers/extensions');

assert.equal(root.PathOutlineLayer, common.PathOutlineLayer);
assert.equal(root.TreeLayer, tree.TreeLayer);
assert.equal(root.SelectionPulseExtension, extensions.SelectionPulseExtension);
assert.equal(common.SelectionPulseExtension, extensions.SelectionPulseExtension);
