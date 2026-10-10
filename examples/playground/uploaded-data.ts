// deck.gl-community
// SPDX-License-Identifier: MIT
import {load} from '@loaders.gl/core';
import {ArrowLoader} from '@loaders.gl/arrow';
import {CSVLoader} from '@loaders.gl/csv';
import {JSONLoader} from '@loaders.gl/json';
import {Table, tableFromJSON} from 'apache-arrow';
import {GeoJSONSchema} from '@deck.gl-community/playground';

/** An uploaded file's canonical Arrow table and deck.gl 9 row adapter. */
export type UploadedData = {table: Table; data: Record<string, unknown>[]; format: string};

/** Restores nested Arrow values as ordinary objects and arrays for deck.gl accessors. */
function toPlainValue(value: unknown): any {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    return Array.from(value as ArrayLike<unknown>, toPlainValue);
  }
  if ('toJSON' in value && typeof value.toJSON === 'function') {
    return toPlainValue(value.toJSON());
  }
  if (Symbol.iterator in value) return Array.from(value as Iterable<unknown>, toPlainValue);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toPlainValue(child)])
  );
}

/** Adapts an Arrow table once, retaining the table for inspection and future consumers. */
export function createUploadedData(table: Table, format = 'Arrow IPC'): UploadedData {
  return {table, format, data: Array.from(table, row => toPlainValue(row))};
}

/** Loads local data with the pinned loaders.gl version; no remote upload is performed. */
export async function loadUploadedData(file: File): Promise<UploadedData> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'arrow' || extension === 'feather' || extension === 'ipc') {
    const result = await load(file, ArrowLoader, {arrow: {shape: 'arrow-table'}});
    return createUploadedData(result.data as Table);
  }
  const isCsv = extension === 'csv';
  if (!isCsv && extension !== 'json' && extension !== 'geojson') {
    throw new Error('Choose JSON, GeoJSON, CSV, or Arrow IPC (.arrow, .feather, .ipc).');
  }
  const loaded = isCsv
    ? await load(file, CSVLoader, {csv: {shape: 'object-row-table'}})
    : await load(file, JSONLoader);
  const value = isCsv ? (loaded as {data: unknown}).data : loaded;
  if (!isCsv && value && !Array.isArray(value) && typeof value === 'object') {
    const geojson = GeoJSONSchema.parse(value);
    const features =
      geojson.type === 'FeatureCollection'
        ? geojson.features
        : geojson.type === 'Feature'
          ? [geojson]
          : [{type: 'Feature', geometry: geojson, properties: {}}];
    // Lossless feature JSON keeps heterogeneous geometry and foreign members intact in Arrow.
    const table = features.length
      ? tableFromJSON(
          features.map(feature => ({
            feature: JSON.stringify(feature),
            geometry: JSON.stringify(feature.geometry),
            properties: JSON.stringify(feature.properties)
          }))
        )
      : new Table();
    return {table, format: 'GeoJSON', data: Array.from(table, row => JSON.parse(row.feature))};
  }
  if (
    !Array.isArray(value) ||
    value.some(row => !row || typeof row !== 'object' || Array.isArray(row))
  ) {
    throw new Error('JSON data must be an array of row objects or GeoJSON.');
  }
  const table = value.length ? tableFromJSON(value) : new Table();
  return createUploadedData(table, isCsv ? 'CSV' : 'JSON');
}
