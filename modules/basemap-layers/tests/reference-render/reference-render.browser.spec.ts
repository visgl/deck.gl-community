// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Reference-render comparison: each scene is drawn by MapLibre GL JS and by `BasemapLayer` from the
 * same style JSON, at the same size and pixel ratio, and scored with SSIM, edge alignment and label
 * recall/precision. The scores may not fall below `baseline.json` by more than a small tolerance;
 * they only tighten.
 *
 * Environment variables (all optional):
 * - `VITE_REFERENCE_RENDER_MODE`: `check` (default) fails on a regression; `update` raises the
 *   baseline where the scores improved (it never lowers it); `reset` overwrites the baseline with
 *   the scores measured (for a deliberate change of scenes, fixtures or metrics); `record`
 *   downloads the fixtures the scenes need and then reports like `check`, without failing.
 * - `VITE_REFERENCE_RENDER_SCENES`: `default`, `extended`, `all` or a comma-separated list of ids.
 * - `VITE_REFERENCE_RENDER_SABOTAGE`: breaks the `BasemapLayer` render on purpose, to show that the
 *   metrics catch it (report only, never checked): `no-labels`, `reverse-order` (style layers drawn
 *   in reverse) or `offset` (camera moved 3 pixels east).
 *
 * Every run writes `report.md` (a table of scores and their change from the baseline, for a PR
 * description), `metrics.json` and a comparison image per scene to `__output__/`.
 *
 * `baseline.json` holds the scores of the CI renderer (`yarn test-headless` in headless Chrome on
 * the GitHub Actions Linux runner, which has no GPU), taken from the `metrics.json` of the
 * `basemap-reference-render` CI artifact. Canvas text
 * is drawn differently on each OS, so scores measured on another machine can differ by more than the
 * tolerance (up to 0.024 edge F in `new-york-dark-z12.3`); use local runs to compare changes, and the
 * CI artifact to set the baseline.
 */

import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-400-italic.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-400-italic.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-500-italic.css';
import '@fontsource/open-sans/latin-400-italic.css';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {commands} from 'vitest/browser';
import committedBaseline from './baseline.json';
import {
  fromFixtureUrl,
  getFixturePath,
  hasFixture,
  loadReferenceStyle,
  recordMissingFixtures
} from './fixtures';
import {createComparisonImage} from './images';
import {
  computeSceneMetrics,
  formatDeltaTable,
  getRegressions,
  tightenBaseline,
  type Baseline,
  type SceneMetrics
} from '../../../../dev/basemap-conformance/src/metrics';
import {renderBasemapLayer, renderMapLibre, type Render} from './renderers';
import {DEFAULT_SCENES, VIEWPORT, selectScenes, type ReferenceScene} from './scenes';

const DIRECTORY = 'modules/basemap-layers/tests/reference-render';
const OUTPUT = `${DIRECTORY}/__output__`;
const env = (import.meta as any).env || {};
const MODE: 'check' | 'update' | 'reset' | 'record' = env.VITE_REFERENCE_RENDER_MODE || 'check';
const SCENES = selectScenes(env.VITE_REFERENCE_RENDER_SCENES);
const SABOTAGE: 'no-labels' | 'reverse-order' | 'offset' | undefined =
  env.VITE_REFERENCE_RENDER_SABOTAGE || undefined;

/** The `BasemapLayer` inputs for a scene, broken on purpose when `SABOTAGE` is set. */
function getCandidateInputs(style: any, scene: ReferenceScene) {
  const candidateStyle = structuredClone(style);
  let candidateScene = scene;
  let layerProps: Record<string, unknown> = {};
  if (SABOTAGE === 'no-labels') {
    layerProps = {globe: {config: {basemap: true, labels: false}}};
  } else if (SABOTAGE === 'reverse-order') {
    candidateStyle.layers.reverse();
  } else if (SABOTAGE === 'offset') {
    const degreesPerPixel = 360 / (512 * 2 ** scene.zoom);
    candidateScene = {
      ...scene,
      center: [scene.center[0] + 3 * degreesPerPixel, scene.center[1]]
    };
  }
  return {candidateStyle, candidateScene, layerProps};
}
const baseline = committedBaseline as Baseline;

/** The fonts the styles' `text-font` stacks map to, loaded so labels draw the same on every OS. */
const FONTS = [
  '400 16px "Noto Sans"',
  'italic 400 16px "Noto Sans"',
  '700 16px "Noto Sans"',
  '400 16px Montserrat',
  'italic 400 16px Montserrat',
  '500 16px Montserrat',
  'italic 500 16px Montserrat',
  'italic 400 16px "Open Sans"'
];

const measured: Baseline = {};
/**
 * The scenes whose renders read only their fixtures, all present, and drew from sorted font atlases:
 * only they may set a baseline.
 */
const valid = new Set<string>();
const regressions: Record<string, string[]> = {};
const details: Record<string, unknown> = {};

/** Fixture URLs a render requested that have no fixture. */
async function getMissingFixtures(render: Render): Promise<string[]> {
  const missing: string[] = [];
  for (const url of new Set(render.requests)) {
    const remote = fromFixtureUrl(url);
    if (remote && !(await hasFixture(getFixturePath(remote)))) {
      missing.push(remote);
    }
  }
  return missing;
}

async function renderScene(scene: ReferenceScene) {
  const record = MODE === 'record';
  // Record mode renders until no fixture is missing: a render with more data can request more.
  for (let attempt = 0; ; attempt++) {
    const style = await loadReferenceStyle(scene.style, {record});
    const reference = await renderMapLibre(structuredClone(style), scene);
    const {candidateStyle, candidateScene, layerProps} = getCandidateInputs(style, scene);
    const candidate = await renderBasemapLayer(candidateStyle, candidateScene, layerProps);
    const missing = [
      ...(await getMissingFixtures(reference)),
      ...(await getMissingFixtures(candidate))
    ];
    if (!record || missing.length === 0 || attempt === 3) {
      return {reference, candidate, missing};
    }
    await recordMissingFixtures(missing);
  }
}

describe('reference render: MapLibre GL JS vs BasemapLayer', () => {
  beforeAll(async () => {
    await Promise.all(FONTS.map(font => document.fonts.load(font)));
  });

  test.each(SCENES)('$id', async scene => {
    const {reference, candidate, missing} = await renderScene(scene);
    const {width, height} = VIEWPORT;
    const result = computeSceneMetrics({
      width,
      height,
      reference: reference.pixels,
      candidate: candidate.pixels,
      referenceLabels: reference.labels,
      candidateLabels: candidate.labels
    });
    measured[scene.id] = result.metrics;
    details[scene.id] = {
      ...result.metrics,
      missingLabels: result.labels.missing,
      extraLabels: result.labels.extra,
      maplibreMs: Math.round(reference.duration),
      // Both draws and the font atlases built between them, then the first draw alone, from empty
      // font atlases, as MapLibre's one draw builds its glyph atlas.
      basemapLayerMs: Math.round(candidate.duration),
      basemapLayerFirstDrawMs: Math.round(candidate.firstDrawDuration ?? 0),
      basemapLayerLayers: candidate.layers,
      basemapLayerDraws: candidate.draws
    };
    await commands.writeFile(
      `${OUTPUT}/${scene.id}.png`,
      createComparisonImage({
        width,
        height,
        reference: reference.pixels,
        candidate: candidate.pixels,
        ssimMap: result.ssimMap,
        referenceEdges: result.referenceEdges,
        candidateEdges: result.candidateEdges
      }),
      'base64'
    );

    const problems = [...reference.problems, ...candidate.problems];
    const unsortedFontAtlases = candidate.unsortedFontAtlases || [];
    if (problems.length === 0 && missing.length === 0 && unsortedFontAtlases.length === 0) {
      valid.add(scene.id);
    }
    expect(problems, 'renders must only read local fixtures').toEqual([]);
    expect(missing, 'missing fixtures: run with VITE_REFERENCE_RENDER_MODE=record').toEqual([]);
    expect(
      unsortedFontAtlases,
      'font atlases the read-back draw built itself, in tile load order'
    ).toEqual([]);

    const sceneBaseline: SceneMetrics | undefined = baseline[scene.id];
    if (sceneBaseline) {
      regressions[scene.id] = getRegressions(result.metrics, sceneBaseline);
    }
    if (MODE === 'check' && !SABOTAGE) {
      if (DEFAULT_SCENES.includes(scene)) {
        expect(sceneBaseline, `no baseline for ${scene.id}: run with MODE=update`).toBeDefined();
      }
      expect(regressions[scene.id] || []).toEqual([]);
    }
  }, 180_000);

  afterAll(async () => {
    const table = formatDeltaTable(baseline, measured, regressions);
    console.log(`\nReference render vs baseline:\n${table}\n`);
    await commands.writeFile(`${OUTPUT}/report.md`, `${table}\n`);
    await commands.writeFile(`${OUTPUT}/metrics.json`, `${JSON.stringify(details, null, 2)}\n`);
    if ((MODE === 'update' || MODE === 'reset') && !SABOTAGE) {
      // A render that missed fixtures or left the page's origin is reported, never recorded.
      const recorded = Object.fromEntries(Object.entries(measured).filter(([id]) => valid.has(id)));
      const next =
        MODE === 'reset' ? {...baseline, ...recorded} : tightenBaseline(baseline, recorded);
      const sorted = Object.fromEntries(
        Object.entries(next).sort(([a], [b]) => a.localeCompare(b))
      );
      await commands.writeFile(
        `${DIRECTORY}/baseline.json`,
        `${JSON.stringify(sorted, null, 2)}\n`
      );
    }
  });
});
