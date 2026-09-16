// deck.gl-community
// SPDX-License-Identifier: MIT

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const distDir = join(packageRoot, 'dist');

async function generate() {
  const module = await import(pathToFileURL(join(distDir, 'schemas', 'deckgl.js')).href);
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const schema = module.DeckGLDocumentSchema;
  if (!schema) {
    throw new Error('DeckGLDocumentSchema export not found.');
  }

  const jsonSchema = module.z?.toJSONSchema
    ? module.z.toJSONSchema(schema, {target: 'draft-2020-12'})
    : (await import('zod')).z.toJSONSchema(schema, {target: 'draft-2020-12'});
  jsonSchema.$id = `urn:deck.gl-community:playground:${packageJson.version}:deckgl-schema`;
  jsonSchema.title = 'Deck.gl JSON configuration';
  jsonSchema.description =
    'JSON schema for deck.gl layers, views, and document configuration supported by the playground.';
  jsonSchema.$schema = 'https://json-schema.org/draft/2020-12/schema';

  await mkdir(distDir, {recursive: true});
  await writeFile(join(distDir, 'deckgl-schema.json'), JSON.stringify(jsonSchema, null, 2));
}

generate().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
