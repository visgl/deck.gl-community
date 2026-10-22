// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Scores every saved render against the MapLibre reference render of the same scene, and writes
 * the report. Node 22.18 or later runs it as is (type stripping):
 *
 *   node dev/basemap-conformance/scripts/score.ts [output directory]
 *
 * Reads `<output>/<renderer>/<scene>.{png,json}`, as any runner saves them, and writes
 * `<output>/report.md`, `<output>/scores.json`, and per scene `<output>/images/<scene>.png` (every
 * renderer side by side, the reference first) and `<output>/images/<scene>--<renderer>.png`
 * (reference, candidate, SSIM map, edge overlay). The reference is `maplibre`. Other `maplibre*`
 * directories (MapLibre rendered by another runner or at another version) are scored like any
 * other renderer, which checks that the references agree.
 *
 * It only reports: it exits with an error when it cannot read the renders, never on a score.
 */

import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {computeSceneMetrics} from '../src/metrics.ts';
import {edgePanel, ssimPanel} from '../src/panels.ts';
import type {SavedRender} from '../src/types.ts';

const REFERENCE = 'maplibre';
const output = resolve(process.argv[2] || fileURLToPath(new URL('../__output__', import.meta.url)));

type Loaded = SavedRender & {pixels: Uint8ClampedArray};

function loadRender(renderer: string, scene: string): Loaded | null {
  const base = join(output, renderer, scene);
  if (!existsSync(`${base}.json`) || !existsSync(`${base}.png`)) {
    return null;
  }
  const saved = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as SavedRender;
  const png = PNG.sync.read(readFileSync(`${base}.png`));
  if (png.width !== saved.width || png.height !== saved.height) {
    throw new Error(
      `${base}.png is ${png.width}x${png.height}, not ${saved.width}x${saved.height}`
    );
  }
  const {data} = png;
  return {...saved, pixels: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)};
}

/** Panels of equal size side by side, left to right, as PNG. */
function composeRow(panels: Uint8ClampedArray[], width: number, height: number): Buffer {
  const png = new PNG({width: panels.length * width, height});
  panels.forEach((pixels, index) => {
    for (let y = 0; y < height; y++) {
      const row = pixels.subarray(y * width * 4, (y + 1) * width * 4);
      png.data.set(row, (y * panels.length * width + index * width) * 4);
    }
  });
  return PNG.sync.write(png);
}

function format(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

function main() {
  if (!existsSync(join(output, REFERENCE))) {
    throw new Error(`No ${REFERENCE} renders in ${output}`);
  }
  const renderers = readdirSync(output, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name !== 'images')
    .map(entry => entry.name)
    .sort((a, b) => (a === REFERENCE ? -1 : b === REFERENCE ? 1 : a.localeCompare(b)));
  const scenes = readdirSync(join(output, REFERENCE))
    .filter(name => name.endsWith('.json'))
    .map(name => name.slice(0, -'.json'.length))
    .sort();
  mkdirSync(join(output, 'images'), {recursive: true});

  const rows: string[] = [];
  const scores: Record<string, Record<string, unknown>> = {};
  const names: Record<string, string> = {};
  for (const sceneId of scenes) {
    const reference = loadRender(REFERENCE, sceneId);
    if (!reference) {
      rows.push(`| ${sceneId} | (no reference render) | | | | | | |`);
      continue;
    }
    names[REFERENCE] = reference.rendererName;
    const {width, height} = reference;
    const sideBySide = [reference.pixels];
    scores[sceneId] = {};
    for (const rendererId of renderers.filter(id => id !== REFERENCE)) {
      const candidate = loadRender(rendererId, sceneId);
      if (!candidate) {
        continue;
      }
      names[rendererId] = candidate.rendererName;
      if (candidate.width !== width || candidate.height !== height) {
        scores[sceneId][rendererId] = {
          valid: false,
          problems: [`${candidate.width}x${candidate.height}, not ${width}x${height}`]
        };
        rows.push(
          `| ${sceneId} | ${candidate.rendererName} **(invalid: ${candidate.width}x${candidate.height})** | | | | | | |`
        );
        continue;
      }
      const result = computeSceneMetrics({
        width,
        height,
        reference: reference.pixels,
        candidate: candidate.pixels,
        referenceLabels: reference.labels || [],
        candidateLabels: candidate.labels || []
      });
      const hasLabels = candidate.labels !== null && reference.labels !== null;
      const problems = [
        ...reference.problems,
        ...reference.fixtureMisses,
        ...candidate.problems,
        ...candidate.fixtureMisses
      ];
      const valid = problems.length === 0;
      const entry = {
        ssim: result.metrics.ssim,
        edgeF: result.metrics.edgeF,
        labelRecall: hasLabels ? result.metrics.labelRecall : null,
        labelPrecision: hasLabels ? result.metrics.labelPrecision : null,
        referenceLabels: result.metrics.referenceLabels,
        candidateLabels: hasLabels ? result.metrics.candidateLabels : null,
        missingLabels: hasLabels ? result.labels.missing : null,
        extraLabels: hasLabels ? result.labels.extra : null,
        labelNote: candidate.labelNote,
        valid,
        problems,
        renderMs: candidate.durationMs,
        meta: candidate.meta
      };
      scores[sceneId][rendererId] = entry;
      rows.push(
        `| ${sceneId} | ${candidate.rendererName}${valid ? '' : ' **(invalid)**'} | ${format(entry.ssim)} | ${format(entry.edgeF)} | ${format(entry.labelRecall)} | ${format(entry.labelPrecision)} | ${entry.referenceLabels} / ${entry.candidateLabels ?? 'n/a'} | ${(candidate.durationMs / 1000).toFixed(1)} s |`
      );
      sideBySide.push(candidate.pixels);
      writeFileSync(
        join(output, 'images', `${sceneId}--${rendererId}.png`),
        composeRow(
          [
            reference.pixels,
            candidate.pixels,
            ssimPanel(result.ssimMap, width, height),
            edgePanel(result.referenceEdges, result.candidateEdges, width, height)
          ],
          width,
          height
        )
      );
    }
    writeFileSync(join(output, 'images', `${sceneId}.png`), composeRow(sideBySide, width, height));
  }

  const candidates = renderers.filter(id => id !== REFERENCE && names[id]);
  const report = [
    `Reference: ${names[REFERENCE] || REFERENCE}. Candidates: ${candidates.map(id => names[id]).join(', ') || 'none'}.`,
    '',
    '| Scene | Candidate | SSIM | Edge F | Label recall | Label precision | Labels (ref / cand) | Render time |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Images: `images/<scene>.png` shows the reference, then each candidate in the order above.',
    '`images/<scene>--<candidate>.png` shows the reference, the candidate, the SSIM map',
    '(red: dissimilar) and the edges (magenta: reference only, green: candidate only, black: both).',
    ''
  ].join('\n');
  writeFileSync(join(output, 'report.md'), report);
  writeFileSync(join(output, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`);
  console.log(report);
}

main();
