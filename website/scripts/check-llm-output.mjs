import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const buildDirectory = fileURLToPath(new URL('../build/', import.meta.url));
const siteUrl = 'https://visgl.github.io/deck.gl-community/';
const index = readFileSync(path.join(buildDirectory, 'llms.txt'), 'utf8');
assert.ok(index.startsWith('# deck.gl-community\n'), 'Unexpected index title');
assert.equal(index.match(/^## .+$/m)?.[0], '## docs', 'Unexpected index hierarchy');
assert.ok(!existsSync(path.join(buildDirectory, 'llms-full.txt')), 'Full corpus is disabled');
assert.ok(!index.includes('/examples/'), 'Examples must be excluded');
for (const route of ['docs.md', 'docs/working-with-ai.md', 'docs/whats-new.md']) {
  assert.ok(existsSync(path.join(buildDirectory, route)), `Missing ${route}`);
  assert.ok(index.includes(`${siteUrl}${route}`), `Index is missing ${route}`);
}

// Sample prose, fenced examples, migration tables and rendered admonitions.
// File existence alone does not prove that HTML-to-Markdown extraction succeeded.
const requiredContent = {
  'docs.md': ['Some modules may no longer have dedicated maintainers.'],
  'docs/working-with-ai.md': [
    'Check local versions and capabilities',
    'Inspect the application',
    'Community support is limited'
  ],
  'docs/modules/layers/api-reference/path-marker-layer.md': [
    'Create directional markers along a path',
    '```',
    "import {PathMarkerLayer} from '@deck.gl-community/layers';",
    'const layer = new PathMarkerLayer({',
    'Accessor that returns the RGBA color of each marker.'
  ],
  'docs/modules/editable-layers.md': [
    '| nebula.gl import',
    '| deck.gl-community import',
    '| Optional edit modes',
    'Some modules may no longer have dedicated maintainers.'
  ]
};
for (const [route, snippets] of Object.entries(requiredContent)) {
  const content = readFileSync(path.join(buildDirectory, route), 'utf8');
  for (const snippet of snippets) {
    assert.ok(content.includes(snippet), `Missing extracted content in ${route}: ${snippet}`);
  }
  assert.ok(!/<(?:LayerLiveExample|Tabs|TabItem)\b/.test(content), `Unprocessed MDX in ${route}`);
}

function findMarkdownFiles(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? findMarkdownFiles(entryPath)
      : entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

const markdownFiles = findMarkdownFiles(buildDirectory);
assert.ok(markdownFiles.length > 50, 'Documentation extraction is incomplete');
for (const filePath of [path.join(buildDirectory, 'llms.txt'), ...markdownFiles]) {
  const content = readFileSync(filePath, 'utf8');
  assert.ok(content.trim().length > 40, `Empty content: ${filePath}`);
  assert.ok(!content.includes(`${siteUrl}deck.gl-community/`), `Duplicated base: ${filePath}`);
  for (const match of content.matchAll(/\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g)) {
    const url = new URL(match[1]);
    if (url.href.startsWith(siteUrl) && url.pathname.endsWith('.md')) {
      const relativePath = decodeURIComponent(url.pathname).slice('/deck.gl-community/'.length);
      assert.ok(existsSync(path.join(buildDirectory, relativePath)), `Broken link: ${url.href}`);
    }
  }
}
console.log(`Validated llms.txt and ${markdownFiles.length} Markdown pages.`);
