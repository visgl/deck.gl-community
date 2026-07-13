import {readdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const OSS_TRACE_LAYERS_ROOT = path.resolve('modules/trace-layers/src');
const OSS_TRACEVIS_DEMO_ROOT = path.resolve('examples/trace-layers/tracevis');

const OSS_TRACE_LAYERS_ONLY = new Set([
  'arrow-utils.ts',
  'layers.ts',
  'layers/layers/trace-graph-layer.ts',
  'layers/layers/trace-prepared-state-layer.ts',
  'layers/layers/trace-store-layer.ts',
  'layers/layers/trace-top-level-layers.test.ts',
  'loaders.ts',
  'protobufjs-light-browser.d.ts',
  'react.ts',
  'trace.ts',
  'trace/loaders/chrome-trace-loader.ts',
]);

const OSS_TRACEVIS_DEMO_ONLY = new Set([
  'app.tsx',
  'components/tracevis-panel.tsx',
  'index.html',
  'index.tsx',
  'package.json',
  'postcss.config.mjs',
  'styles.css',
  'tailwind.config.ts',
  'tsconfig.json',
  'vite.config.ts',
]);

const CANDIDATE_TRACE_LAYERS_ARG = '--candidate-trace-layers';
const CANDIDATE_DEMO_ARG = '--candidate-demo';

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  writeError(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

const checks = [
  args?.candidateTraceLayers
    ? {
        label: 'trace-layers candidate',
        candidateRoot: args.candidateTraceLayers,
        ossRoot: OSS_TRACE_LAYERS_ROOT,
        ossOnly: OSS_TRACE_LAYERS_ONLY,
      }
    : null,
  args?.candidateDemo
    ? {
        label: 'tracevis demo candidate',
        candidateRoot: args.candidateDemo,
        ossRoot: OSS_TRACEVIS_DEMO_ROOT,
        ossOnly: OSS_TRACEVIS_DEMO_ONLY,
      }
    : null,
].filter(Boolean);

if (checks.length === 0) {
  printUsage();
  process.exitCode = 1;
} else {
  const failures = [];

  for (const check of checks) {
    const failure = await compareFileSets(check);
    if (failure) {
      failures.push(failure);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      writeError(`${failure}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write('Trace layers portable source structure matches the documented OSS boundary.\n');
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    candidateTraceLayers: null,
    candidateDemo: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const nextArg = rawArgs[index + 1];

    if (arg === CANDIDATE_TRACE_LAYERS_ARG || arg === CANDIDATE_DEMO_ARG) {
      if (!nextArg || nextArg.startsWith('--')) {
        throw new Error(`Missing path after ${arg}.`);
      }
      const resolvedPath = path.resolve(nextArg);
      if (arg === CANDIDATE_TRACE_LAYERS_ARG) {
        parsed.candidateTraceLayers = resolvedPath;
      } else {
        parsed.candidateDemo = resolvedPath;
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function compareFileSets({label, candidateRoot, ossRoot, ossOnly}) {
  const candidateFiles = new Set(await listFiles(candidateRoot));
  const ossFiles = new Set(await listFiles(ossRoot));
  const missingFromCandidate = [...ossFiles]
    .filter((file) => !ossOnly.has(file) && !candidateFiles.has(file))
    .sort();
  const candidateOnlyFiles = [...candidateFiles].filter((file) => !ossFiles.has(file)).sort();

  if (missingFromCandidate.length === 0 && candidateOnlyFiles.length === 0) {
    return null;
  }

  return [
    `${label} drift detected against OSS boundary:`,
    formatFileList('missing from candidate', missingFromCandidate),
    formatFileList('candidate-only files to audit', candidateOnlyFiles),
  ]
    .filter(Boolean)
    .join('\n');
}

async function listFiles(root) {
  const files = [];
  await walk(root, root, files);
  return files.sort();
}

async function walk(root, currentPath, files) {
  const entries = await readdir(currentPath, {withFileTypes: true});

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.vite') {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walk(root, entryPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  }
}

function formatFileList(label, files) {
  if (files.length === 0) {
    return '';
  }
  return `${label}:\n${files.map((file) => `  - ${file}`).join('\n')}`;
}

function printUsage() {
  writeError(
    [
      'Usage:',
      `  node scripts/check-trace-layers-portable-source-structure.mjs ${CANDIDATE_TRACE_LAYERS_ARG} <path>`,
      `  node scripts/check-trace-layers-portable-source-structure.mjs ${CANDIDATE_DEMO_ARG} <path>`,
      `  node scripts/check-trace-layers-portable-source-structure.mjs ${CANDIDATE_TRACE_LAYERS_ARG} <path> ${CANDIDATE_DEMO_ARG} <path>`,
    ].join('\n'),
  );
}

function writeError(message) {
  process.stderr.write(message);
}
