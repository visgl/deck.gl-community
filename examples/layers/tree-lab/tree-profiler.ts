// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {SplatLayer} from '../../../modules/layers/src/splat-layer/splat-layer';
import {TreeWoodLayer} from '../../../modules/layers/src/tree-layer/tree-wood-layer';

type ProfileLayer = {
  props: {data: unknown[]};
  state: {shadow?: unknown[]; shadowGroups?: unknown[][]};
};
type ProfileMethod = (this: ProfileLayer, ...args: unknown[]) => unknown;
type Sample = {calls: number; milliseconds: number; selectedOwners: number; inputOwners: number};

type ProfileListener = (layer: ProfileLayer, milliseconds: number) => void;
type ProfileEntry = {
  original: ProfileMethod;
  wrapper: ProfileMethod;
  listeners: Set<ProfileListener>;
};
const PROFILE_METHODS = new WeakMap<object, Map<string, ProfileEntry>>();

/** Opt-in CPU attribution, restored when the last profiling host unmounts. */
export function createTreeProfiler() {
  let samples: Record<string, Sample> = {};
  const restorations: (() => void)[] = [];
  for (const [prototype, prefix] of [
    [TreeWoodLayer.prototype, 'wood'],
    [SplatLayer.prototype, 'canopy']
  ] as const) {
    let methods = PROFILE_METHODS.get(prototype);
    if (!methods) {
      methods = new Map();
      PROFILE_METHODS.set(prototype, methods);
    }
    for (const method of prefix === 'canopy'
      ? ['updateState', 'prepareShadow', 'updateRefinement', 'getRefinementGroups', 'renderLayers']
      : ['updateState', 'prepareShadow']) {
      const target = prototype as unknown as Record<typeof method, ProfileMethod>;
      let entry = methods.get(method);
      if (!entry) {
        const original = target[method];
        const listeners = new Set<ProfileListener>();
        const wrapper: ProfileMethod = function (...args: unknown[]) {
          const start = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            const milliseconds = performance.now() - start;
            for (const listener of listeners) listener(this, milliseconds);
          }
        };
        entry = {original, wrapper, listeners};
        methods.set(method, entry);
        target[method] = wrapper;
      }
      const label = prefix + '.' + method;
      const listener: ProfileListener = (layer, milliseconds) => {
        samples[label] ??= {
          calls: 0,
          milliseconds: 0,
          selectedOwners: 0,
          inputOwners: 0
        };
        const sample = samples[label];
        sample.calls++;
        sample.milliseconds += milliseconds;
        sample.inputOwners += layer.props.data.length;
        if (method === 'prepareShadow') {
          const state = layer.state;
          sample.selectedOwners +=
            prefix === 'wood'
              ? (state.shadow?.length ?? 0)
              : (state.shadowGroups ?? []).reduce((sum, rows) => sum + rows.length, 0);
        }
      };
      entry.listeners.add(listener);
      const ownedEntry = entry;
      restorations.push(() => {
        ownedEntry.listeners.delete(listener);
        if (!ownedEntry.listeners.size) {
          if (target[method] === ownedEntry.wrapper) target[method] = ownedEntry.original;
          methods.delete(method);
        }
      });
    }
  }
  return {
    reset() {
      samples = {};
    },
    read() {
      return structuredClone(samples);
    },
    dispose() {
      for (const restore of restorations.splice(0)) restore();
    }
  };
}
