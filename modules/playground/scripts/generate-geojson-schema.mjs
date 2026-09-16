// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {z} from 'zod';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(packageRoot, 'dist');
const schemaPath = join(distDir, 'index.js');

async function generateSchemaArtifacts() {
  let module;
  try {
    module = await import(pathToFileURL(schemaPath).href);
  } catch (error) {
    throw new Error(
      `Failed to import compiled playground module from "${relative(packageRoot, schemaPath)}". ` +
        `Ensure TypeScript build succeeds before running this script. ${error}`
    );
  }

  const {GeoJSONSchema} = module;
  if (!GeoJSONSchema) {
    throw new Error('GeoJSONSchema export not found.');
  }

  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const cdnUrl = `https://cdn.jsdelivr.net/npm/${packageJson.name}@${packageJson.version}/dist/geojson-schema.json`;
  const schema = z.toJSONSchema(GeoJSONSchema, {target: 'draft-2020-12'});
  const jsonSchema = {
    $id: cdnUrl,
    title: 'GeoJSON',
    description: 'JSON Schema for GeoJSON documents supported by @deck.gl-community/playground.',
    ...schema
  };
  if (jsonSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || !jsonSchema.anyOf) {
    throw new Error('Generated GeoJSON schema is missing its draft 2020-12 union structure.');
  }

  await mkdir(distDir, {recursive: true});
  await writeFile(join(distDir, 'geojson-schema.json'), JSON.stringify(jsonSchema, null, 2));
  await writeFile(
    join(distDir, 'geojson-schema.cdn.js'),
    `export const GEOJSON_SCHEMA_CDN_URL = '${cdnUrl}';\nexport default GEOJSON_SCHEMA_CDN_URL;\n`
  );
  await writeFile(
    join(distDir, 'geojson-schema.cdn.d.ts'),
    'export declare const GEOJSON_SCHEMA_CDN_URL: string;\nexport default GEOJSON_SCHEMA_CDN_URL;\n'
  );
}

generateSchemaArtifacts().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
