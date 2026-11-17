// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The scorer (Node only): scores every saved render against the MapLibre reference render of the
 * same scene, and writes the report. `scripts/score.ts` runs it from the command line.
 *
 * Reads `<output>/<renderer>/<scene>.{png,json}` and `<output>/<renderer>/renderer.json`, as any
 * runner saves them, and writes `<output>/report.md`, `<output>/scores.json`, and per scene
 * `<output>/images/<scene>.png` (every renderer side by side, the reference first) and
 * `<output>/images/<scene>--<renderer>.png` (reference, candidate, SSIM map, edge overlay). The
 * reference is `maplibre`. Other `maplibre*` directories (MapLibre rendered by another runner or at
 * another version) are scored like any other renderer, which checks that the references agree.
 *
 * Before it scores a render, it checks the render's inputs against its own checkout of the corpus:
 * the scene's camera, and the input digests (`provenance.ts`). Each scene lists every renderer: a
 * render is `scored`, `invalid` (with the reasons), `missing` (no output: an incomplete run) or
 * `unsupported` (the renderer declined the scene).
 *
 * It only reports: it throws when it cannot read the renders, never on a score.
 */

import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {computeSceneMetrics} from './metrics.ts';
import {edgePanel, ssimPanel} from './panels.ts';
import {cameraDifferences, computeRenderInputs, INPUTS_ALGORITHM} from './provenance.ts';
import {SCENES, STYLES} from './scenes.ts';
import type {ConformanceScene, RendererManifest, SavedRender} from './types.ts';

export const REFERENCE = 'maplibre';

export type RenderStatus = 'scored' | 'invalid' | 'missing' | 'unsupported';

export type ScoreOptions = {
  /** The output directory of the runners. The report is written there too. */
  output: string;
  /** The fixture roots of the corpus checkout the renders must match, in search order. */
  fixtureRoots: string[];
  /** The corpus catalog (default: this checkout's). */
  scenes?: ConformanceScene[];
  styles?: Record<string, {fixture: string}>;
};

export type ScoreResult = {
  report: string;
  scores: Record<string, Record<string, Record<string, unknown>>>;
};

type Loaded = SavedRender & {pixels: Uint8ClampedArray};

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

function loadRender(output: string, renderer: string, scene: string): Loaded | null {
  const base = join(output, renderer, scene);
  if (!existsSync(`${base}.json`) || !existsSync(`${base}.png`)) {
    return null;
  }
  const saved = readJson<SavedRender>(`${base}.json`)!;
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

/**
 * Why a render does not match the corpus: an unknown scene, another camera, or input digests that
 * differ from the ones this checkout gives. Empty when it matches.
 */
export function checkProvenance(
  render: SavedRender,
  corpus: Map<string, ConformanceScene>,
  styles: Record<string, {fixture: string}>,
  fixtureRoots: string[]
): string[] {
  const scene = corpus.get(render.scene?.id);
  if (!scene) {
    return [`scene ${render.scene?.id} is not in the corpus`];
  }
  const reasons = cameraDifferences(render.scene, scene).map(
    difference => `camera differs: ${difference}`
  );
  const style = styles[scene.style];
  if (!style) {
    return [...reasons, `style ${scene.style} is not in the corpus`];
  }
  if (!render.inputs) {
    return [...reasons, 'no input digests (saved by an older runner)'];
  }
  if (render.inputs.algorithm !== INPUTS_ALGORITHM) {
    return [
      ...reasons,
      `input digest algorithm ${render.inputs.algorithm}, not ${INPUTS_ALGORITHM}`
    ];
  }
  const expected = computeRenderInputs({
    scene,
    styleFixture: style.fixture,
    fixtureRequests: render.fixtureRequests || [],
    fixtureRoots
  });
  if (render.inputs.scene !== expected.scene) {
    reasons.push(
      `stale scene: the scene or style digest is ${render.inputs.scene.slice(0, 12)}, the corpus gives ${expected.scene.slice(0, 12)}`
    );
  }
  if (render.inputs.fixtures !== expected.fixtures) {
    reasons.push(
      `stale fixtures: the fixture digest is ${render.inputs.fixtures.slice(0, 12)}, the corpus gives ${expected.fixtures.slice(0, 12)}`
    );
  }
  return reasons;
}

function sortRenderers(ids: string[]): string[] {
  return ids.sort((a, b) => (a === REFERENCE ? -1 : b === REFERENCE ? 1 : a.localeCompare(b)));
}

/** Scores the renders in `output` and writes the report, the scores and the images there. */
export function scoreRenders(options: ScoreOptions): ScoreResult {
  const {output, fixtureRoots} = options;
  const corpus = new Map((options.scenes || SCENES).map(scene => [scene.id, scene]));
  const styles = options.styles || STYLES;
  if (!existsSync(join(output, REFERENCE))) {
    throw new Error(`No ${REFERENCE} renders in ${output}`);
  }
  const renderers = sortRenderers(
    readdirSync(output, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && entry.name !== 'images')
      .map(entry => entry.name)
  );
  const manifests = new Map<string, RendererManifest>();
  const names: Record<string, string> = {};
  const sceneIds = new Set<string>();
  for (const id of renderers) {
    const manifest = readJson<RendererManifest>(join(output, id, 'renderer.json'));
    if (manifest) {
      manifests.set(id, manifest);
      names[id] = manifest.rendererName;
      Object.keys(manifest.scenes).forEach(scene => sceneIds.add(scene));
    }
    readdirSync(join(output, id))
      .filter(name => name.endsWith('.json') && name !== 'renderer.json')
      .forEach(name => sceneIds.add(name.slice(0, -'.json'.length)));
  }
  const scenes = [...sceneIds].sort();
  mkdirSync(join(output, 'images'), {recursive: true});

  const rows: string[] = [];
  const invalid: string[] = [];
  const counts: Record<RenderStatus, number> = {scored: 0, invalid: 0, missing: 0, unsupported: 0};
  const scores: ScoreResult['scores'] = {};
  const name = (id: string) => names[id] || id;

  for (const sceneId of scenes) {
    scores[sceneId] = {};
    const reference = loadRender(output, REFERENCE, sceneId);
    if (reference) {
      names[REFERENCE] = reference.rendererName;
    }
    const referenceReasons = reference
      ? checkProvenance(reference, corpus, styles, fixtureRoots).map(
          reason => `reference: ${reason}`
        )
      : [];
    const width = reference?.width ?? 0;
    const height = reference?.height ?? 0;
    const sideBySide = reference ? [reference.pixels] : [];
    if (!reference) {
      rows.push(`| ${sceneId} | (no reference render) | | | | | | |`);
    }

    for (const rendererId of renderers.filter(id => id !== REFERENCE)) {
      const declared = manifests.get(rendererId)?.scenes[sceneId];
      const candidate = declared === 'unsupported' ? null : loadRender(output, rendererId, sceneId);
      if (candidate) {
        names[rendererId] = candidate.rendererName;
      }
      const record = (status: RenderStatus, entry: Record<string, unknown>, cells: string) => {
        counts[status]++;
        scores[sceneId][rendererId] = {status, valid: status === 'scored', ...entry};
        const mark =
          status === 'scored'
            ? ''
            : status === 'unsupported'
              ? ' (unsupported)'
              : ` **(${status})**`;
        rows.push(`| ${sceneId} | ${name(rendererId)}${mark} | ${cells} |`);
      };
      const blank = ' | | | | | ';
      if (declared === 'unsupported') {
        record('unsupported', {}, blank);
        continue;
      }
      if (!candidate) {
        const reason =
          declared === 'expected'
            ? 'the renderer expected this scene but saved no render'
            : 'no render saved for this scene';
        record('missing', {problems: [reason]}, blank);
        continue;
      }
      if (!reference) {
        record('invalid', {problems: ['no reference render']}, blank);
        invalid.push(`- ${sceneId} / ${name(rendererId)}: no reference render`);
        continue;
      }
      const inputProblems = [
        ...referenceReasons,
        ...checkProvenance(candidate, corpus, styles, fixtureRoots)
      ];
      if (candidate.width !== width || candidate.height !== height) {
        inputProblems.push(`${candidate.width}x${candidate.height}, not ${width}x${height}`);
      }
      if (inputProblems.length) {
        // Not a measurement of these inputs: no scores.
        record('invalid', {problems: inputProblems, renderMs: candidate.durationMs}, blank);
        invalid.push(`- ${sceneId} / ${name(rendererId)}: ${inputProblems.join('; ')}`);
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
      const status: RenderStatus = problems.length ? 'invalid' : 'scored';
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
        problems,
        renderMs: candidate.durationMs,
        meta: candidate.meta
      };
      if (problems.length) {
        invalid.push(`- ${sceneId} / ${name(rendererId)}: ${problems.join('; ')}`);
      }
      record(
        status,
        entry,
        `${format(entry.ssim)} | ${format(entry.edgeF)} | ${format(entry.labelRecall)} | ${format(entry.labelPrecision)} | ${entry.referenceLabels} / ${entry.candidateLabels ?? 'n/a'} | ${(candidate.durationMs / 1000).toFixed(1)} s`
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
    if (reference) {
      writeFileSync(
        join(output, 'images', `${sceneId}.png`),
        composeRow(sideBySide, width, height)
      );
    }
  }

  const candidates = renderers.filter(id => id !== REFERENCE);
  const report = [
    `Reference: ${name(REFERENCE)}. Candidates: ${candidates.map(name).join(', ') || 'none'}.`,
    '',
    `Renders: ${counts.scored} scored, ${counts.invalid} invalid, ${counts.missing} missing, ${counts.unsupported} unsupported.`,
    '',
    '| Scene | Candidate | SSIM | Edge F | Label recall | Label precision | Labels (ref / cand) | Render time |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...(invalid.length ? ['Invalid renders:', '', ...invalid, ''] : []),
    '**invalid**: not a measurement of the corpus inputs (see "Invalid renders").',
    '**missing**: the renderer saved no render of the scene (an incomplete run).',
    '(unsupported): the renderer declined the scene.',
    '',
    'Images: `images/<scene>.png` shows the reference, then each candidate in the order above.',
    '`images/<scene>--<candidate>.png` shows the reference, the candidate, the SSIM map',
    '(red: dissimilar) and the edges (magenta: reference only, green: candidate only, black: both).',
    ''
  ].join('\n');
  writeFileSync(join(output, 'report.md'), report);
  writeFileSync(join(output, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`);
  return {report, scores};
}
