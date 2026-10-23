// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * deck.gl 9.4 has no WGSL shader hooks. A layer accepts vertex color filters on WebGPU by placing
 * this line in its vertex entry point where `vertexColor` (a mutable `vec4<f32>`) and
 * `instanceIndex` (`u32`) are in scope; filters inject code after it. The splat canopy and tree
 * mesh layers expose it for `SelectionPulseExtension` in `@deck.gl-community/extensions`, which
 * matches this literal.
 */
export const WGSL_FILTER_COLOR_ANCHOR = '// DECKGL_FILTER_COLOR(vertexColor, instanceIndex)';
