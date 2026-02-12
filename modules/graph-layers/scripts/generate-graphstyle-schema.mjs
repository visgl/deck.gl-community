// deck.gl-community
// SPDX-License-Identifier: MIT

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {zodToJsonSchema} from 'zod-to-json-schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const distDir = join(packageRoot, 'dist');

async function loadGraphStylesheetModule() {
  const schemaPath = join(distDir, 'style', 'graph-stylesheet-schema.js');
  try {
    const moduleUrl = pathToFileURL(schemaPath).href;
    return await import(moduleUrl);
  } catch (error) {
    const relativePath = relative(packageRoot, schemaPath);
    throw new Error(
      `Failed to import compiled schema from "${relativePath}". Ensure TypeScript build succeeds before running this script.\n${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

async function createSchemaArtifacts() {
  const module = await loadGraphStylesheetModule();
  const {GraphStylesheetSchema} = module;
  if (!GraphStylesheetSchema) {
    throw new Error('GraphStylesheetSchema export not found.');
  }

  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const packageName = packageJson.name;
  const packageVersion = packageJson.version;
  const cdnUrl = `https://cdn.jsdelivr.net/npm/${packageName}@${packageVersion}/dist/graph-style-schema.json`;

  const schema = zodToJsonSchema(GraphStylesheetSchema, 'GraphStylesheet');
  const {definitions, ...schemaBody} = schema;

  const jsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: cdnUrl,
    title: 'Deck.gl Graph Stylesheet',
    description:
      'JSON schema describing the declarative stylesheet format supported by @deck.gl-community/graph-layers.',
    ...schemaBody,
    ...(definitions ? {definitions} : {})
  };

  await mkdir(distDir, {recursive: true});
  await writeFile(join(distDir, 'graph-style-schema.json'), JSON.stringify(jsonSchema, null, 2));

  const cdnModule = `export const GRAPH_STYLE_SCHEMA_CDN_URL = '${cdnUrl}';\nexport default GRAPH_STYLE_SCHEMA_CDN_URL;\n`;
  const cdnTypes = `export declare const GRAPH_STYLE_SCHEMA_CDN_URL: string;\nexport default GRAPH_STYLE_SCHEMA_CDN_URL;\n`;

  await writeFile(join(distDir, 'graph-style-schema.cdn.js'), cdnModule);
  await writeFile(join(distDir, 'graph-style-schema.cdn.d.ts'), cdnTypes);
}

createSchemaArtifacts().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
