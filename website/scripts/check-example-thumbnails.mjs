import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {examplesSidebar} = require('../src/examples-sidebar.js');
const thumbnails = JSON.parse(readFileSync(new URL('../src/examples/thumbnails.json', import.meta.url)));

function getExampleIds(items) {
  return items.flatMap(item => {
    if (typeof item === 'string') return [item];
    if (item.items) return getExampleIds(item.items);
    return item.id ? [item.id] : [];
  });
}

const ids = getExampleIds(examplesSidebar).filter(id => id !== 'index');
for (const id of ids) {
  assert.ok(Object.hasOwn(thumbnails, id), `${id}: add a dedicated thumbnail or explicit null`);
  const image = thumbnails[id];
  if (image === null) continue;
  assert.ok(image.startsWith('/images/examples/'), `${id}: generic gallery images are not allowed`);
  const asset = new URL(`../static${image}`, import.meta.url);
  assert.ok(existsSync(asset), `${id}: missing thumbnail ${fileURLToPath(asset)}`);
}
for (const id of Object.keys(thumbnails)) {
  assert.ok(ids.includes(id), `${id}: thumbnail has no gallery entry`);
}
const unavailable = ids.filter(id => thumbnails[id] === null);
console.log(`Validated ${ids.length - unavailable.length} example previews; ${unavailable.length} explicitly unavailable.`);
