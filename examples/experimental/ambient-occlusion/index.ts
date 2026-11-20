// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {CORTAOEffectProps} from '@deck.gl-community/experimental';
import {getStandaloneExampleContainer} from '../../mount-example';
import {mountAmbientOcclusionExample, type SceneId} from './app';

const parameters = new URLSearchParams(location.search);
/** Reads a number parameter. Returns `undefined` if it is missing or not a number. */
const getNumber = (name: string) => {
  const value = parameters.get(name);
  return value === null || Number.isNaN(Number(value)) ? undefined : Number(value);
};
const effectProps: CORTAOEffectProps = {showOcclusion: parameters.get('show') === '1'};
for (const [name, prop] of [
  ['samples', 'sampleCount'],
  ['radius', 'radius'],
  ['screenRadius', 'maxScreenSpaceRadius'],
  ['intensity', 'intensity']
] as const) {
  const value = getNumber(name);
  if (value !== undefined) {
    effectProps[prop] = value;
  }
}
if (parameters.get('filter') === '0') {
  effectProps.filter = false;
}

const example = mountAmbientOcclusionExample(getStandaloneExampleContainer(), {
  scene: (parameters.get('scene') ?? undefined) as SceneId | undefined,
  ambientOcclusion: parameters.get('ao') !== '0',
  controls: parameters.get('controls') !== '0',
  effectProps
});
// Lets scripts toggle the effect and read the frame state.
(globalThis as Record<string, unknown>).ambientOcclusionExample = example;
import.meta.hot?.dispose(() => example.finalize());
