// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Layer, type Deck} from '@deck.gl/core';
import {luma} from '@luma.gl/core';

/** Optional instrumentation, kept out of presentation-only runs. Counts submitted indices, not unique vertices. */
export function createFieldProfile(
  deck: Deck,
  Tree: typeof Layer,
  gl?: WebGL2RenderingContext,
  debug = false
) {
  const frames: Record<string, number>[] = [];
  const glErrors: {name: string; error: number; args: string[]; stack?: string}[] = [];
  let current: Record<string, number> = {};
  const restore: (() => void)[] = [];
  const add = (key: string, amount: number) => (current[key] = (current[key] ?? 0) + amount);
  const wrap = (target, name: string, measure: (args: any[]) => void, timed = false) => {
    const original = target[name];
    if (!original) return;
    target[name] = function (...args) {
      measure(args);
      const start = timed ? performance.now() : 0;
      try {
        return original.apply(this, args);
      } finally {
        if (timed) add(name + 'Ms', performance.now() - start);
        if (debug && target === gl) {
          const error = gl.getError();
          if (error && glErrors.length < 8)
            glErrors.push({
              name,
              error,
              args: args.map(value =>
                ArrayBuffer.isView(value)
                  ? `${value.constructor.name}(${value.byteLength} bytes)`
                  : String(value)
              ),
              stack: new Error().stack
            });
        }
      }
    };
    restore.push(() => (target[name] = original));
  };
  for (const name of [
    'updateState',
    'renderLayers',
    'updatePhotorealDetail',
    'readTreeSources',
    'writeAppearanceRows',
    'groupPhotorealRows'
  ]) {
    wrap(Tree.prototype, name, () => add(name + 'Calls', 1), true);
  }
  wrap(Layer.prototype, '_updateAttributes', () => {}, true);
  wrap(deck, '_drawLayers', () => {}, true);
  if (gl) {
    if (debug) {
      for (const name of [
        'uniformBlockBinding',
        'bindBufferRange',
        'texImage2D',
        'texSubImage2D',
        'pixelStorei',
        'beginQuery',
        'endQuery',
        'deleteQuery',
        'bindFramebuffer',
        'viewport',
        'scissor'
      ]) {
        wrap(gl, name, () => {});
      }
    }
    for (const [name, vertices, instances] of [
      ['drawArrays', 2, -1],
      ['drawElements', 1, -1],
      ['drawArraysInstanced', 2, 3],
      ['drawElementsInstanced', 1, 4]
    ] as const) {
      wrap(gl, name, args => {
        add('drawCalls', 1);
        add('submittedVertices', args[vertices] * (instances < 0 ? 1 : args[instances]));
      });
    }
    wrap(gl, 'bufferSubData', args => {
      const prefix = args[0] === gl.UNIFORM_BUFFER ? 'uniform' : 'buffer';
      add(prefix + 'Writes', 1);
      add(prefix + 'Bytes', (args[4] ?? args[2]?.length ?? 0) * (args[2]?.BYTES_PER_ELEMENT ?? 1));
    });
    wrap(gl, 'texSubImage2D', () => add('textureWrites', 1));
  }
  return {
    frame() {
      const memory = luma.stats.get('GPU Time and Memory');
      for (const name of ['GPU Memory', 'Buffer Memory', 'Texture Memory']) {
        current[name] = memory.get(name).count;
      }
      const heap = (performance as Performance & {memory?: {usedJSHeapSize: number}}).memory;
      if (heap) current.heapBytes = heap.usedJSHeapSize;
      frames.push(current);
      current = {};
    },
    finish() {
      for (const callback of restore.reverse()) callback();
      return {frames, glErrors};
    }
  };
}
