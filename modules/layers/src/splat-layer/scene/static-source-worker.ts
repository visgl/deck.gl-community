// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {load} from '@loaders.gl/core';
import {SPLATLoader, KSPLATLoader, SPZLoader} from '@loaders.gl/splats';
import type {SplatSource} from '../splat-source';

self.onmessage = async ({
  data
}: MessageEvent<{source: string | Blob; format?: 'splat' | 'ksplat' | 'spz'}>) => {
  try {
    const loaders = {splat: SPLATLoader, ksplat: KSPLATLoader, spz: SPZLoader};
    const result = await load(
      data.source,
      data.format ? [loaders[data.format]] : Object.values(loaders),
      {core: {worker: false, ...(data.format ? {mimeType: `application/x.${data.format}`} : {})}}
    );
    const table = result.data;
    const count = table.numRows;
    const source: SplatSource = {
      positions: new Float32Array(count * 3),
      scales: new Float32Array(count * 3),
      rotations: new Float32Array(count * 4),
      colors: new Float32Array(count * 4),
      opacities: new Float32Array(count)
    };
    const positions = table.getChild('POSITION');
    const column = (name: string, row: number) => Number(table.getChild(name)?.get(row) ?? 0);
    const restCount = table.schema.fields.filter(field => field.name.startsWith('f_rest_')).length;
    if (restCount) source.sphericalHarmonics = new Float32Array(count * restCount);
    for (let row = 0; row < count; row++) {
      const position = positions?.get(row);
      for (let axis = 0; axis < 3; axis++) {
        source.positions[row * 3 + axis] = Number(position?.get(axis) ?? 0);
        source.scales[row * 3 + axis] = column(`scale_${axis}`, row);
        source.colors[row * 4 + axis] = 0.5 + 0.28209479177387814 * column(`f_dc_${axis}`, row);
      }
      for (let axis = 0; axis < 4; axis++)
        source.rotations[row * 4 + axis] = column(`rot_${axis}`, row);
      source.colors[row * 4 + 3] = 1;
      source.opacities[row] = column('opacity', row);
      for (let component = 0; component < restCount; component++)
        source.sphericalHarmonics![row * restCount + component] = column(
          `f_rest_${component}`,
          row
        );
    }
    const transfers = Object.values(source)
      .filter(ArrayBuffer.isView)
      .map(value => value.buffer as ArrayBuffer);
    self.postMessage({source}, {transfer: transfers});
  } catch (error) {
    self.postMessage({error: error instanceof Error ? error.message : String(error)});
  }
};
