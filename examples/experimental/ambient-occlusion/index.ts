// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {getStandaloneExampleContainer} from '../../mount-example';
import {mountAmbientOcclusionExample} from './app';

const parameters = new URLSearchParams(location.search);
const example = mountAmbientOcclusionExample(getStandaloneExampleContainer(), {
  ambientOcclusion: parameters.get('ao') !== '0',
  controls: parameters.get('controls') !== '0',
  effectProps: {showOcclusion: parameters.get('show') === '1'}
});
// Lets scripts toggle the effect and read the frame state.
(globalThis as Record<string, unknown>).ambientOcclusionExample = example;
import.meta.hot?.dispose(() => example.finalize());
