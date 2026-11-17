// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {PNG} from 'pngjs';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {computeRenderInputs, digestFixtures, digestScene} from './provenance';
import {scoreRenders} from './scorer';
import type {ConformanceScene, RendererManifest, SavedRender} from './types';

const SIZE = 32;
const STYLES = {streets: {fixture: 'styles/streets.json'}};
const SCENES: ConformanceScene[] = [
  {id: 'city', style: 'streets', center: [2, 48], zoom: 13},
  {id: 'world', style: 'streets', center: [0, 0], zoom: 1}
];

let root: string;
let fixtures: string;
let output: string;

function write(file: string, content: string | Buffer): void {
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, content);
}

/** A white image with a dark square. */
function png(): Buffer {
  const image = new PNG({width: SIZE, height: SIZE});
  image.data.fill(255);
  for (let y = 8; y < 20; y++) {
    for (let x = 8; x < 20; x++) {
      image.data.fill(40, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
    }
  }
  return PNG.sync.write(image);
}

/** Saves a render as a runner does, with the input digests of the fixtures as they are now. */
function saveRender(
  renderer: string,
  scene: ConformanceScene,
  fixtureRequests: string[],
  overrides: Partial<SavedRender> = {}
): void {
  const saved: SavedRender = {
    renderer,
    rendererName: `${renderer} 1.0`,
    scene,
    width: SIZE,
    height: SIZE,
    labels: [],
    problems: [],
    fixtureRequests,
    fixtureMisses: [],
    recorded: [],
    durationMs: 100,
    inputs: computeRenderInputs({
      scene,
      styleFixture: STYLES.streets.fixture,
      fixtureRequests,
      fixtureRoots: [fixtures]
    }),
    ...overrides
  };
  write(join(output, renderer, `${scene.id}.json`), JSON.stringify(saved));
  write(join(output, renderer, `${scene.id}.png`), png());
}

function saveManifest(renderer: string, scenes: RendererManifest['scenes']): void {
  const manifest: RendererManifest = {renderer, rendererName: `${renderer} 1.0`, scenes};
  write(join(output, renderer, 'renderer.json'), JSON.stringify(manifest));
}

function score() {
  return scoreRenders({output, fixtureRoots: [fixtures], scenes: SCENES, styles: STYLES});
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'basemap-conformance-'));
  fixtures = join(root, 'fixtures');
  output = join(root, 'output');
  write(join(fixtures, STYLES.streets.fixture), '{"version": 8}');
  write(join(fixtures, 'tiles/1/0/0.pbf'), 'tile a');
  write(join(fixtures, 'tiles/1/1/0.pbf'), 'tile b');
});

afterEach(() => {
  rmSync(root, {recursive: true, force: true});
});

describe('scoreRenders input checks', () => {
  test('scores a render whose inputs match the corpus', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json', 'tiles/1/0/0.pbf']);
    saveRender('candidate', SCENES[0], ['styles/streets.json', 'tiles/1/1/0.pbf']);
    const entry = score().scores.city.candidate;
    expect(entry.status).toBe('scored');
    expect(entry.ssim).toBeCloseTo(1);
  });

  test('rejects a stale render whose fixtures changed since', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json', 'tiles/1/0/0.pbf']);
    saveRender('candidate', SCENES[0], ['styles/streets.json', 'tiles/1/1/0.pbf']);
    write(join(fixtures, 'tiles/1/1/0.pbf'), 'tile b, recorded again');
    const {scores, report} = score();
    expect(scores.city.candidate.status).toBe('invalid');
    expect(scores.city.candidate.ssim).toBeUndefined();
    expect(String(scores.city.candidate.problems)).toContain('stale fixtures');
    expect(report).toContain('candidate 1.0 **(invalid)**');
    expect(report).toContain('stale fixtures');
  });

  test('rejects a render of another style, and every candidate of a stale reference', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json']);
    saveRender('candidate', SCENES[0], ['styles/streets.json']);
    write(join(fixtures, STYLES.streets.fixture), '{"version": 8, "layers": []}');
    const entry = score().scores.city.candidate;
    expect(entry.status).toBe('invalid');
    expect(String(entry.problems)).toContain('reference: stale scene');
    expect(String(entry.problems)).toContain('stale scene');
  });

  test('rejects a render of another camera', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json']);
    saveRender('candidate', {...SCENES[0], zoom: 14}, ['styles/streets.json']);
    const entry = score().scores.city.candidate;
    expect(entry.status).toBe('invalid');
    expect(String(entry.problems)).toContain('camera differs: zoom 14, corpus 13');
  });

  test('rejects a render without input digests', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json']);
    saveRender('candidate', SCENES[0], ['styles/streets.json'], {inputs: undefined});
    const entry = score().scores.city.candidate;
    expect(entry.status).toBe('invalid');
    expect(String(entry.problems)).toContain('no input digests');
  });
});

describe('scoreRenders lists every renderer of every scene', () => {
  test('reports a candidate without a render as missing', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json']);
    saveRender('maplibre', SCENES[1], ['styles/streets.json']);
    saveManifest('candidate', {city: 'expected', world: 'expected'});
    saveRender('candidate', SCENES[0], ['styles/streets.json']);
    const {scores, report} = score();
    expect(scores.city.candidate.status).toBe('scored');
    expect(scores.world.candidate.status).toBe('missing');
    expect(report).toContain('| world | candidate 1.0 **(missing)** |');
    expect(report).toContain('1 scored, 0 invalid, 1 missing, 0 unsupported');
  });

  test('reports a missing render of a renderer without a manifest', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json']);
    saveRender('maplibre', SCENES[1], ['styles/streets.json']);
    saveRender('candidate', SCENES[0], ['styles/streets.json']);
    expect(score().scores.world.candidate.status).toBe('missing');
  });

  test('reports a declined scene as unsupported, not missing', () => {
    saveRender('maplibre', SCENES[0], ['styles/streets.json']);
    saveRender('maplibre', SCENES[1], ['styles/streets.json']);
    saveManifest('candidate', {city: 'expected', world: 'unsupported'});
    saveRender('candidate', SCENES[0], ['styles/streets.json']);
    const {scores, report} = score();
    expect(scores.world.candidate.status).toBe('unsupported');
    expect(report).toContain('| world | candidate 1.0 (unsupported) |');
  });
});

describe('input digests', () => {
  test('do not depend on the order or repetition of the fixture requests', () => {
    const a = digestFixtures(['tiles/1/0/0.pbf', 'tiles/1/1/0.pbf'], [fixtures]);
    const b = digestFixtures(['tiles/1/1/0.pbf', 'tiles/1/0/0.pbf', 'tiles/1/1/0.pbf'], [fixtures]);
    expect(a).toBe(b);
  });

  test('change with any fixture byte, and tell a missing fixture from an empty one', () => {
    const before = digestFixtures(['tiles/1/0/0.pbf', 'tiles/9/9/9.pbf'], [fixtures]);
    write(join(fixtures, 'tiles/1/0/0.pbf'), 'tile A');
    const changed = digestFixtures(['tiles/1/0/0.pbf', 'tiles/9/9/9.pbf'], [fixtures]);
    write(join(fixtures, 'tiles/9/9/9.pbf'), '');
    const empty = digestFixtures(['tiles/1/0/0.pbf', 'tiles/9/9/9.pbf'], [fixtures]);
    expect(new Set([before, changed, empty]).size).toBe(3);
  });

  test('of a scene ignore its note and default pitch and bearing to 0', () => {
    const scene = SCENES[0];
    expect(digestScene({...scene, note: 'x', pitch: 0}, STYLES.streets.fixture, [fixtures])).toBe(
      digestScene(scene, STYLES.streets.fixture, [fixtures])
    );
    expect(digestScene({...scene, bearing: 10}, STYLES.streets.fixture, [fixtures])).not.toBe(
      digestScene(scene, STYLES.streets.fixture, [fixtures])
    );
  });
});
