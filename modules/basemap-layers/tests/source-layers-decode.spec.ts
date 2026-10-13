/* eslint-disable import/no-extraneous-dependencies */
import {parse} from '@loaders.gl/core';
import {MVTLoader} from '@loaders.gl/mvt';
import {describe, expect, test} from 'vitest';
import {getSourceLoadOptions} from '../src/globe-layers';

// A minimal Mapbox Vector Tile encoder: layers of one point feature each.

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return bytes;
}

const zigzag = (value: number) => (value << 1) ^ (value >> 31);

/** A length-delimited field. */
function field(fieldNumber: number, bytes: number[]): number[] {
  return [...varint((fieldNumber << 3) | 2), ...varint(bytes.length), ...bytes];
}

/** A varint field. */
function uint(fieldNumber: number, value: number): number[] {
  return [...varint(fieldNumber << 3), ...varint(value)];
}

function encodeLayer(name: string, x: number, y: number): number[] {
  const geometry = [...varint((1 << 3) | 1), ...varint(zigzag(x)), ...varint(zigzag(y))];
  const feature = [...uint(3, 1), ...field(4, geometry)];
  return [
    ...uint(15, 2),
    ...field(1, [...new TextEncoder().encode(name)]),
    ...field(2, feature),
    ...uint(5, 4096)
  ];
}

function encodeTile(names: string[]): ArrayBuffer {
  const bytes = names.flatMap((name, index) => field(3, encodeLayer(name, 100 * (index + 1), 50)));
  return new Uint8Array(bytes).buffer;
}

/** Decodes `tile` as the shared vector tilesets do, with `loadOptions`. */
async function decode(tile: ArrayBuffer, loadOptions: any): Promise<string[]> {
  const features = (await parse(tile, MVTLoader, {
    ...loadOptions,
    mvt: {
      ...loadOptions?.mvt,
      shape: 'geojson',
      coordinates: 'local',
      tileIndex: {x: 0, y: 0, z: 0}
    }
  })) as any[];
  return features.map(feature => feature.properties.layerName).sort();
}

describe('an encoded vector tile', () => {
  const tile = encodeTile(['housenumber', 'poi', 'water']);

  test('decodes every source layer without a selection', async () => {
    expect(await decode(tile, getSourceLoadOptions(undefined, null))).toEqual([
      'housenumber',
      'poi',
      'water'
    ]);
  });

  test('decodes only the source layers the style draws', async () => {
    expect(await decode(tile, getSourceLoadOptions(undefined, ['poi', 'water']))).toEqual([
      'poi',
      'water'
    ]);
  });

  test("keeps an application's own selection", async () => {
    const loadOptions = getSourceLoadOptions({mvt: {layers: ['housenumber']}} as any, ['water']);
    expect(await decode(tile, loadOptions)).toEqual(['housenumber']);
  });
});
