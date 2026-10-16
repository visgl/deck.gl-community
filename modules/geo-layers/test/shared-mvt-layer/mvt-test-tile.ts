// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Hand-encoded Mapbox Vector Tiles for browser tests.

/** Appends `value` to `out` as a protobuf varint. */
function writeVarint(out: number[], value: number): void {
  while (value > 127) {
    out.push((value & 127) | 128);
    value >>>= 7;
  }
  out.push(value);
}

/** Appends a length-delimited protobuf field. */
function writeBytes(out: number[], field: number, bytes: ArrayLike<number>): void {
  writeVarint(out, (field << 3) | 2);
  writeVarint(out, bytes.length);
  out.push(...Array.from(bytes));
}

/** Appends a varint protobuf field. */
function writeVarintField(out: number[], field: number, value: number): void {
  writeVarint(out, field << 3);
  writeVarint(out, value);
}

const TILE_EXTENT = 4096;

/** Position of a longitude/latitude in tile 0/0/0, in tile units. */
function toTileCoordinates([longitude, latitude]: [number, number]): [number, number] {
  const mercatorY = Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  return [
    Math.round(((longitude + 180) / 360) * TILE_EXTENT),
    Math.round(((1 - mercatorY / Math.PI) / 2) * TILE_EXTENT)
  ];
}

/**
 * Encodes tile 0/0/0 holding one polygon, a longitude/latitude box, in the source layer `shapes`.
 * The ring is clockwise in tile coordinates, as the MVT specification requires of an exterior ring.
 */
export function encodeBoxTile([west, south, east, north]: [
  number,
  number,
  number,
  number
]): Uint8Array {
  const ring = [
    toTileCoordinates([west, north]),
    toTileCoordinates([east, north]),
    toTileCoordinates([east, south]),
    toTileCoordinates([west, south])
  ];
  const zigzag = (value: number) => (value << 1) ^ (value >> 31);
  // Command and parameter integers, packed into varints below.
  const geometry: number[] = [];
  let cursor = [0, 0];
  ring.forEach(([x, y], index) => {
    if (index === 0) {
      geometry.push((1 << 3) | 1); // MoveTo, once
    } else if (index === 1) {
      geometry.push(((ring.length - 1) << 3) | 2); // LineTo, for the other corners
    }
    geometry.push(zigzag(x - cursor[0]), zigzag(y - cursor[1]));
    cursor = [x, y];
  });
  geometry.push((1 << 3) | 7); // ClosePath

  const packedGeometry: number[] = [];
  geometry.forEach(value => writeVarint(packedGeometry, value));
  const feature: number[] = [];
  writeVarintField(feature, 1, 1); // id
  writeVarintField(feature, 3, 3); // type: polygon
  writeBytes(feature, 4, packedGeometry);

  const layer: number[] = [];
  writeVarintField(layer, 15, 2); // version
  writeBytes(layer, 1, new TextEncoder().encode('shapes'));
  writeBytes(layer, 2, feature);
  writeVarintField(layer, 5, TILE_EXTENT);

  const tile: number[] = [];
  writeBytes(tile, 3, layer);
  return new Uint8Array(tile);
}
