#!/usr/bin/env node
// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Shrinks recorded reference-render fixtures without changing what either renderer draws:
 *
 * - vector tiles keep only the source layers and feature properties that some style refers to, and
 *   only the features that reach into some default scene's view or the half view around it and
 *   pass the filter of a style layer drawn at that scene's zooms (geometry, feature ids and values
 *   are copied byte for byte);
 * - raster tiles keep only the pixels in some default scene's view, posterized to 5 bits per
 *   channel (both renderers read the same pixels; this only makes them compress well);
 * - glyph ranges keep only the characters of the strings left in the tiles and the styles, in
 *   either case, and the Arabic presentation forms;
 * - TileJSON files keep only the fields that `loadReferenceStyle` reads.
 *
 * Run it after recording new fixtures (VITE_REFERENCE_RENDER_MODE=record):
 *
 *   node trim-fixtures.mjs
 *
 * A tile recorded for one scene is trimmed to that scene's view: a new scene that reads it from
 * further away needs it recorded again (delete it first). Trimming is idempotent. A string anywhere in a style layer counts as a reference to a property
 * or source layer of that name, which keeps more than needed but never too little.
 */

import {readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {deflateSync, inflateSync} from 'node:zlib';
import {dirname, join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// --- Protocol buffers: just what vector tiles and glyph ranges use. ---

/** The fields of a message: `{field, type, value}`, with `value` a number or a byte array. */
function readMessage(bytes) {
  const fields = [];
  let offset = 0;
  const readVarint = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  while (offset < bytes.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    const type = key & 7;
    if (type === 0) {
      fields.push({field, type, value: readVarint()});
    } else if (type === 2) {
      const length = readVarint();
      fields.push({field, type, value: bytes.subarray(offset, offset + length)});
      offset += length;
    } else if (type === 1 || type === 5) {
      const length = type === 1 ? 8 : 4;
      fields.push({field, type, value: bytes.subarray(offset, offset + length)});
      offset += length;
    } else {
      throw new Error(`Unsupported protocol buffer wire type ${type}`);
    }
  }
  return fields;
}

function writeVarint(out, value) {
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  out.push(value);
}

function writeMessage(fields) {
  const out = [];
  for (const {field, type, value} of fields) {
    writeVarint(out, field * 8 + type);
    if (type === 0) {
      writeVarint(out, value);
    } else {
      if (type === 2) {
        writeVarint(out, value.length);
      }
      for (const byte of value) {
        out.push(byte);
      }
    }
  }
  return Uint8Array.from(out);
}

function readPackedVarints(bytes) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const byte of bytes) {
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(byte & 0x80)) {
      values.push(value);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

function writePackedVarints(values) {
  const out = [];
  for (const value of values) {
    writeVarint(out, value);
  }
  return Uint8Array.from(out);
}

const decoder = new TextDecoder();

// --- What the styles refer to. ---

/** Every string in a style layer's filter, layout and paint, and every `{token}` in them. */
function collectStrings(value, strings) {
  if (typeof value === 'string') {
    strings.add(value);
    for (const match of value.matchAll(/{([^{}]+)}/g)) {
      strings.add(match[1]);
    }
  } else if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, strings));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStrings(item, strings));
  }
  return strings;
}

/**
 * What the styles read from vector tiles: the source layers, every string (property names among
 * them), and per source layer the filters and zoom ranges of the style layers that draw it.
 */
async function getStyleReferences() {
  const sourceLayers = new Set();
  const strings = new Set();
  const drawn = new Map();
  const lineLabeled = new Set();
  for (const file of await readdir(join(ROOT, 'styles'))) {
    const style = JSON.parse(await readFile(join(ROOT, 'styles', file), 'utf8'));
    for (const layer of style.layers) {
      const sourceLayer = layer['source-layer'];
      if (sourceLayer) {
        sourceLayers.add(sourceLayer);
        if (String(layer.layout?.['symbol-placement']).startsWith('line')) {
          lineLabeled.add(sourceLayer);
        }
        if (layer.layout?.visibility !== 'none') {
          if (!drawn.has(sourceLayer)) {
            drawn.set(sourceLayer, []);
          }
          drawn.get(sourceLayer).push({
            filter: featureFilter(layer.filter).filter,
            minZoom: layer.minzoom ?? 0,
            maxZoom: layer.maxzoom ?? 24
          });
        }
      }
      collectStrings([layer.filter, layer.layout, layer.paint], strings);
    }
  }
  return {sourceLayers, strings, drawn, lineLabeled};
}

// --- Where the scenes look. ---

/**
 * The world area each default scene can draw, in Web Mercator `[0, 1]` units: its view and
 * `margin` views around it (for labels whose anchors lie just outside the view), with the tile
 * zooms the scene reads: MapLibre's floor zoom, deck.gl's rounded zoom, the next zoom of 256 pixel
 * raster tiles, and the zoom below for sources whose `maxzoom` is just below the scene's.
 */
async function getSceneWindows(margin) {
  const source = await readFile(join(dirname(ROOT), 'scenes.ts'), 'utf8');
  const block = source.slice(source.indexOf('DEFAULT_SCENES'), source.indexOf('const PLACES'));
  return [...block.matchAll(/center: \[([-\d.]+), ([-\d.]+)\],\s*zoom: ([\d.]+)/g)].map(match => {
    const [longitude, latitude, zoom] = match.slice(1).map(Number);
    const x = (longitude + 180) / 360;
    const sin = Math.sin((latitude * Math.PI) / 180);
    const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    // The views are 512 pixels square, and the world is 512 pixels wide at zoom 0.
    const half = (0.5 + margin) * 2 ** -zoom;
    return {
      west: x - half,
      east: x + half,
      north: y - half,
      south: y + half,
      zoom,
      minZoom: Math.floor(zoom) - 1,
      maxZoom: Math.ceil(zoom)
    };
  });
}

/** The tile-local `[minX, minY, maxX, maxY]` of a feature's geometry commands. */
function getGeometryBounds(commands) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let x = 0;
  let y = 0;
  for (let i = 0; i < commands.length; ) {
    const command = commands[i] & 7;
    const count = Math.floor(commands[i++] / 8);
    if (command === 7) {
      continue;
    }
    for (let j = 0; j < count; j++) {
      const dx = commands[i++];
      const dy = commands[i++];
      x += dx % 2 ? -(dx + 1) / 2 : dx / 2;
      y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  }
  return bounds;
}

/** The windows of `windows` that a feature of tile `{x, y, z}` with `extent` reaches into. */
function getFeatureWindows(bounds, tile, extent, windows) {
  const size = 2 ** -tile.z;
  const west = (tile.x + bounds[0] / extent) * size;
  const east = (tile.x + bounds[2] / extent) * size;
  const north = (tile.y + bounds[1] / extent) * size;
  const south = (tile.y + bounds[3] / extent) * size;
  return windows.filter(
    window =>
      tile.z >= window.minZoom &&
      tile.z <= window.maxZoom &&
      west <= window.east &&
      east >= window.west &&
      north <= window.south &&
      south >= window.north
  );
}

// --- Vector tiles. ---

/** A vector tile `Value` message as a JavaScript value. */
function readValue(bytes) {
  const [{field, value}] = readMessage(bytes);
  switch (field) {
    case 1:
      return decoder.decode(value);
    case 2:
      return Buffer.from(value).readFloatLE(0);
    case 3:
      return Buffer.from(value).readDoubleLE(0);
    case 6:
      return value % 2 ? -(value + 1) / 2 : value / 2;
    case 7:
      return Boolean(value);
    default:
      // int64 and uint64; negative int64 values do not occur in the recorded tiles.
      return value;
  }
}

/**
 * Whether a style layer draws a feature in any of the scenes of `windows`: MapLibre evaluates
 * filters at the tile's zoom, deck.gl at the view's.
 */
function isDrawn(drawn, type, properties, id, tile, windows) {
  const zooms = new Set([tile.z]);
  for (const window of windows) {
    zooms.add(Math.floor(window.zoom)).add(Math.round(window.zoom)).add(window.zoom);
  }
  const feature = {type, properties, id};
  return (drawn || []).some(({filter, minZoom, maxZoom}) =>
    [...zooms].some(zoom => zoom >= minZoom && zoom < maxZoom && filter({zoom}, feature))
  );
}

/**
 * Whether a default scene reads tile `{x, y, z}`. A tile recorded only for other scenes (the
 * extended set) keeps its features and pixels: they are trimmed to what the styles refer to only.
 */
function isTileInWindows(tile, windows) {
  const size = 2 ** -tile.z;
  return windows.some(
    window =>
      tile.z >= window.minZoom &&
      tile.z <= window.maxZoom &&
      tile.x * size <= window.east &&
      (tile.x + 1) * size >= window.west &&
      tile.y * size <= window.south &&
      (tile.y + 1) * size >= window.north
  );
}

/**
 * A tile's layers without unreferenced source layers and properties, or features outside the
 * scenes' windows (if any default scene reads the tile). Adds its strings to `text`.
 */
function trimTile(bytes, {sourceLayers, strings, drawn, lineLabeled}, tile, windows, text) {
  const windowed = isTileInWindows(tile, windows);
  const layers = [];
  for (const layerField of readMessage(bytes)) {
    if (layerField.field !== 3) {
      layers.push(layerField);
      continue;
    }
    const fields = readMessage(layerField.value);
    const name = decoder.decode(fields.find(({field}) => field === 1).value);
    if (!sourceLayers.has(name)) {
      continue;
    }
    const keys = fields.filter(({field}) => field === 3).map(({value}) => decoder.decode(value));
    const values = fields.filter(({field}) => field === 4).map(({value}) => value);
    const keyIndex = new Map();
    const valueIndex = new Map();
    const extent = fields.find(({field}) => field === 5)?.value ?? 4096;
    const features = [];
    for (const {value} of fields.filter(({field}) => field === 2)) {
      const feature = readMessage(value);
      const geometry = feature.find(({field}) => field === 4);
      const type = feature.find(({field}) => field === 3)?.value ?? 0;
      // MapLibre joins the lines of a line label before placing it along them, so a line far
      // outside the view can still move a label inside it.
      const featureWindows = !windowed
        ? null
        : geometry && !(type === 2 && lineLabeled.has(name))
          ? getFeatureWindows(
              getGeometryBounds(readPackedVarints(geometry.value)),
              tile,
              extent,
              windows
            )
          : windows.filter(window => tile.z >= window.minZoom && tile.z <= window.maxZoom);
      if (featureWindows && !featureWindows.length) {
        continue;
      }
      const tags = readPackedVarints(feature.find(({field}) => field === 2)?.value ?? []);
      const properties = {};
      for (let i = 0; i < tags.length; i += 2) {
        properties[keys[tags[i]]] = readValue(values[tags[i + 1]]);
      }
      const id = feature.find(({field}) => field === 1)?.value;
      if (featureWindows && !isDrawn(drawn.get(name), type, properties, id, tile, featureWindows)) {
        continue;
      }
      const featureFields = feature.map(featureField => {
        if (featureField.field !== 2) {
          return featureField;
        }
        const tags = readPackedVarints(featureField.value);
        const kept = [];
        for (let i = 0; i < tags.length; i += 2) {
          const key = keys[tags[i]];
          if (!strings.has(key)) {
            continue;
          }
          if (!keyIndex.has(tags[i])) {
            keyIndex.set(tags[i], keyIndex.size);
          }
          if (!valueIndex.has(tags[i + 1])) {
            valueIndex.set(tags[i + 1], valueIndex.size);
          }
          kept.push(keyIndex.get(tags[i]), valueIndex.get(tags[i + 1]));
        }
        return {...featureField, value: writePackedVarints(kept)};
      });
      features.push({field: 2, type: 2, value: writeMessage(featureFields)});
    }
    for (const index of valueIndex.keys()) {
      for (const {field, value} of readMessage(values[index])) {
        if (field === 1) {
          text.add(decoder.decode(value));
        }
      }
    }
    const rest = fields.filter(({field}) => field !== 2 && field !== 3 && field !== 4);
    layers.push({
      field: 3,
      type: 2,
      value: writeMessage([
        ...rest,
        ...features,
        ...[...keyIndex.keys()].map(index => fields.filter(({field}) => field === 3)[index]),
        ...[...valueIndex.keys()].map(index => ({field: 4, type: 2, value: values[index]}))
      ])
    });
  }
  return writeMessage(layers);
}

// --- Raster tiles. ---

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The pixels of an 8-bit, non-interlaced RGB or RGBA PNG, or `null` for any other PNG. */
function decodePng(bytes) {
  const chunks = [];
  let header = null;
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      chunks.push(data);
    }
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.interlace || ![2, 6].includes(header.color)) {
    return null;
  }
  const channels = header.color === 2 ? 3 : 4;
  const stride = header.width * channels;
  const filtered = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = filtered[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const raw = filtered[y * (stride + 1) + 1 + i];
      const a = i >= channels ? pixels[y * stride + i - channels] : 0;
      const b = y ? pixels[(y - 1) * stride + i] : 0;
      const c = y && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      pixels[y * stride + i] = (raw + predictor) & 0xff;
    }
  }
  return {...header, channels, stride, pixels};
}

function encodePng({width, height, color, channels, stride, pixels}) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    // The filter with the smallest sum of absolute differences, as encoders usually choose.
    let best = null;
    for (let filter = 0; filter < 5; filter++) {
      const row = Buffer.alloc(stride + 1);
      row[0] = filter;
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? pixels[y * stride + i - channels] : 0;
        const b = y ? pixels[(y - 1) * stride + i] : 0;
        const c = y && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
        const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
        row[1 + i] = (pixels[y * stride + i] - predictor) & 0xff;
        cost += row[1 + i] < 128 ? row[1 + i] : 256 - row[1 + i];
      }
      if (!best || cost < best.cost) {
        best = {row, cost};
      }
    }
    rows.push(best.row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = color;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), {level: 9})),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * A raster tile with the pixels outside `windows` cleared and the rest posterized, if a default
 * scene reads it (`tileWindows`).
 */
function trimRaster(bytes, tile, windows, tileWindows) {
  const image = isTileInWindows(tile, tileWindows) ? decodePng(Buffer.from(bytes)) : null;
  if (!image) {
    return bytes;
  }
  const {width, height, channels, stride, pixels} = image;
  const size = 2 ** -tile.z;
  for (let y = 0; y < height; y++) {
    const v = (tile.y + (y + 0.5) / height) * size;
    for (let x = 0; x < width; x++) {
      const u = (tile.x + (x + 0.5) / width) * size;
      const shown = windows.some(
        window =>
          tile.z >= window.minZoom &&
          tile.z <= window.maxZoom &&
          u >= window.west &&
          u <= window.east &&
          v >= window.north &&
          v <= window.south
      );
      for (let k = 0; k < channels; k++) {
        const i = y * stride + x * channels + k;
        pixels[i] = shown ? (pixels[i] & 0xf8) | 0x04 : 0;
      }
    }
  }
  return encodePng(image);
}

// --- Glyph ranges. ---

/** A glyph range without the glyphs of characters outside `characters`. */
function trimGlyphs(bytes, characters) {
  return writeMessage(
    readMessage(bytes).map(stack =>
      stack.field !== 1
        ? stack
        : {
            ...stack,
            value: writeMessage(
              readMessage(stack.value).filter(({field, value}) => {
                if (field !== 3) {
                  return true;
                }
                const id = readMessage(value).find(glyphField => glyphField.field === 1)?.value;
                // MapLibre draws Arabic in its presentation forms, which tiles do not contain.
                return characters.has(id) || (id >= 0xfb50 && id <= 0xfeff);
              })
            )
          }
    )
  );
}

// --- Files. ---

async function listFiles(directory) {
  const entries = await readdir(directory, {withFileTypes: true}).catch(() => []);
  const files = await Promise.all(
    entries.map(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
  );
  return files.flat();
}

const isGlyphRange = path => /\/fonts\/[^/]+\/\d+-\d+\.pbf$/.test(path);
const isVectorTile = path => /\.(pbf|mvt)$/.test(path) && !isGlyphRange(path);
const isRasterTile = path => /\/\d+\/\d+\/\d+\.png$/.test(path);
const isTileJson = path => path.endsWith('/index.json') || path.endsWith('/tiles.json');

const references = await getStyleReferences();
const text = collectStrings([...references.strings], new Set());
const files = (await listFiles(ROOT)).map(file => relative(ROOT, file).split(sep).join('/'));
let before = 0;
let after = 0;

async function rewrite(path, transform) {
  const file = join(ROOT, path);
  const bytes = new Uint8Array(await readFile(file));
  const next = transform(bytes);
  before += bytes.length;
  after += next.length;
  await writeFile(file, next);
}

const getTileIndex = path => {
  const [z, x, y] = path.match(/(\d+)\/(\d+)\/(\d+)\.\w+$/).slice(1).map(Number);
  return {x, y, z};
};
const labelWindows = await getSceneWindows(0.5);
for (const path of files.filter(isVectorTile)) {
  await rewrite(path, bytes => trimTile(bytes, references, getTileIndex(path), labelWindows, text));
}
// A few pixels around the view, for texture filtering at its edges.
const viewWindows = await getSceneWindows(0.02);
for (const path of files.filter(isRasterTile)) {
  await rewrite(path, bytes => trimRaster(bytes, getTileIndex(path), viewWindows, labelWindows));
}
const characters = new Set();
for (const string of text) {
  // `text-transform` can draw any string in either case.
  for (const character of `${string}${string.toUpperCase()}${string.toLowerCase()}`) {
    characters.add(character.codePointAt(0));
  }
}
for (const path of files.filter(isGlyphRange)) {
  await rewrite(path, bytes => trimGlyphs(bytes, characters));
}
for (const path of files.filter(isTileJson)) {
  await rewrite(path, bytes => {
    const {tiles, minzoom, maxzoom, bounds, scheme} = JSON.parse(decoder.decode(bytes));
    return new TextEncoder().encode(JSON.stringify({tiles, minzoom, maxzoom, bounds, scheme}));
  });
}

let total = 0;
for (const path of files) {
  total += (await stat(join(ROOT, path))).size;
}
console.log(
  `Trimmed ${(before / 1e6).toFixed(2)} MB to ${(after / 1e6).toFixed(2)} MB; ` +
    `${files.length} fixtures, ${(total / 1e6).toFixed(2)} MB in all`
);
