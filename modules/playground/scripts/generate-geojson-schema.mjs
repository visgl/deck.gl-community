// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mkdir, writeFile} from 'node:fs/promises';
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

  const schema = z.toJSONSchema(GeoJSONSchema, {target: 'draft-2020-12'});
  const jsonSchema = {
    $id: 'urn:deck.gl-community:playground:geojson-schema',
    title: 'GeoJSON',
    description: 'JSON Schema for GeoJSON documents supported by @deck.gl-community/playground.',
    ...schema
  };
  if (jsonSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || !jsonSchema.anyOf) {
    throw new Error('Generated GeoJSON schema is missing its draft 2020-12 union structure.');
  }

  await mkdir(distDir, {recursive: true});
  await writeFile(join(distDir, 'geojson-schema.json'), JSON.stringify(jsonSchema, null, 2));
}

generateSchemaArtifacts().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
