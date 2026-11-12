// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {getSettingDefinitions, getValueAtPath, setValueAtPath} from '@deck.gl-community/panels';
import {describe, expect, it} from 'vitest';
import {
  applyStoryOverrides,
  createDebugSchema,
  getCameraFromViewState,
  getDebugPlayback,
  getDefaultDebugSettings,
  getOnlyLayers,
  getOverrideName,
  getOverrideOfSetting,
  getPlaybackPieces,
  getSafeAreaInsets,
  getShakenCamera,
  getStageUrlParameters,
  OVERRIDE_FIELDS,
  parseDebugQuery,
  PLAYBACK_SPEEDS,
  readDebugValues,
  setStoryOverride,
  WATER_PATH,
  writeDebugQuery,
  type DebugContext
} from '../stage/debug-settings';
import {parseDevicePixels, parseLodBias} from '../stage/stage-query';
import {HURRICANE} from '../story/beats';
import {getOrbitViewProps} from '../story/camera';
import {BEAT_TABLE, CYCLE_SECONDS, getStoryState, LOOP} from '../story/story';
import type {StoryCamera} from '../story/story-types';

const LAYER_NAMES = [
  'sky',
  'ground',
  'plain',
  'grass',
  'trees',
  'orange',
  'seed',
  'pot',
  'net',
  'weather'
];

const CONTEXT: DebugContext = {
  layerNames: LAYER_NAMES,
  defaultLayers: LAYER_NAMES.filter(name => name !== 'plain'),
  layerGroups: {props: ['orange', 'seed', 'pot']},
  beats: BEAT_TABLE,
  cycleSeconds: CYCLE_SECONDS,
  fileStart: LOOP.fileStart
};

/** A second of the first wall at a gust peak: rain, wind and a shaking camera. */
const STORM_SECOND = HURRICANE.gustPeaks[1];
/** The middle of each beat, and the seconds either side of the file's wrap and of the swap. */
const CYCLE_TIMES = [
  ...BEAT_TABLE.map(
    (beat, index) => (beat.start + (BEAT_TABLE[index + 1]?.start ?? CYCLE_SECONDS)) / 2
  ),
  LOOP.fileStart - 1 / 30,
  LOOP.fileStart,
  CYCLE_SECONDS - 1 / 30,
  0
];

function parse(search: string) {
  return parseDebugQuery(new URLSearchParams(search), CONTEXT);
}

function read(search: string) {
  return readDebugValues(parse(search), CONTEXT);
}

/** What the URL says after the settings it gave are written back into it. */
function roundTrip(search: string): string {
  const query = new URLSearchParams(search);
  return writeDebugQuery(parseDebugQuery(query, CONTEXT), query, CONTEXT).toString();
}

describe('debug settings', () => {
  it('has a control for every setting it reads, and defaults that read as the stage does', () => {
    const names = [...getSettingDefinitions(createDebugSchema(CONTEXT)).keys()];
    expect(names).toContain('time.speed');
    expect(names).toContain('layers.weather');
    expect(names).toContain('override.value.weather.rain');
    expect(names).toContain('override.value.ground.flood.level');
    expect(names).toContain('loop.world');
    expect(new Set(names).size).toBe(names.length);

    const values = readDebugValues(getDefaultDebugSettings(CONTEXT), CONTEXT);
    expect(values).toMatchObject({
      speed: 1,
      // A loop film loops.
      loop: true,
      file: false,
      a: 0,
      b: CYCLE_SECONDS,
      range: null,
      overlay: true,
      finish: true,
      overrides: [],
      lodBias: null,
      aspect: '',
      devicePixels: 1,
      msaa: true,
      camera: 'story',
      world: null,
      seam: false,
      gust: false
    });
    expect(values.layers).toEqual(CONTEXT.defaultLayers);
    expect(values).not.toHaveProperty('treeQuality');
    expect(names).not.toContain('trees.quality');
  });

  it('offers the speeds the toolbar offers, from one list', () => {
    const speed = getSettingDefinitions(createDebugSchema(CONTEXT)).get('time.speed');
    expect(speed?.options).toEqual(PLAYBACK_SPEEDS);
  });

  it('keeps A and B while the range is off', () => {
    const {eyeOpen, eyeClose} = HURRICANE;
    let settings = parse(`ab=${eyeOpen},${eyeClose}`);
    expect(readDebugValues(settings, CONTEXT)).toMatchObject({
      a: eyeOpen,
      b: eyeClose,
      range: [eyeOpen, eyeClose]
    });
    settings = setValueAtPath(settings, 'time.range', false);
    expect(readDebugValues(settings, CONTEXT)).toMatchObject({
      a: eyeOpen,
      b: eyeClose,
      range: null
    });
  });

  it('offers each beat of the table by id, whatever the table says', () => {
    const schema = createDebugSchema({
      ...CONTEXT,
      beats: [
        {id: 'a', start: 0},
        {id: 'b', start: 9}
      ]
    });
    const beat = getSettingDefinitions(schema).get('time.beat');
    // A prompt first, so that choosing any beat, the one playing too, is a change.
    expect(beat?.options).toEqual([
      {label: 'Choose a beat', value: ''},
      {label: 'a · 0 s', value: 'a'},
      {label: 'b · 9 s', value: 'b'}
    ]);
    expect(beat?.defaultValue).toBe('');
    expect(beat?.persist).toBe('none');
  });

  it('offers every beat of the cycle', () => {
    const beat = getSettingDefinitions(createDebugSchema(CONTEXT)).get('time.beat');
    expect(beat?.options?.slice(1)).toEqual(
      BEAT_TABLE.map(({id, start}) => ({label: `${id} · ${start} s`, value: id}))
    );
  });
});

describe('debug settings in the URL', () => {
  it('reads only, overlay and finish as the stage does', () => {
    expect(read('only=ground,pot')).toMatchObject({layers: ['ground', 'pot'], overlay: false});
    expect(read('only=props').layers).toEqual(['orange', 'seed', 'pot']);
    expect(read('only=plain,pot,trees').layers).toEqual(['plain', 'trees', 'pot']);
    expect(read('only=').layers).toEqual([]);
    expect(read('only=sky&overlay=1').overlay).toBe(true);
    expect(read('overlay=0').overlay).toBe(false);
    expect(read('finish=0')).toMatchObject({finish: false, overlay: true});
    expect(getOnlyLayers('props,sky,bogus', CONTEXT)).toEqual(['sky', 'orange', 'seed', 'pot']);
  });

  it('reads what only the debug panel has', () => {
    const {clearing, firstWall} = HURRICANE;
    const values = read(
      'override=weather.rain:0.8,wind.bearing:200,bogus.path:3,sky.storm:x' +
        `&ab=${clearing},${firstWall}&camera=orbit` +
        '&lodBias=-1.5&aspect=4:5&dpr=2&msaa=0'
    );
    expect(values.overrides).toEqual([
      ['weather.rain', 0.8],
      ['wind.bearing', 200]
    ]);
    expect(values).toMatchObject({
      // B before A: a range through the swap.
      range: [clearing, firstWall],
      camera: 'orbit',
      lodBias: -1.5,
      aspect: '4:5',
      devicePixels: 2,
      msaa: false
    });
    expect(read('lodBias=0').lodBias).toBe(0);
  });

  it('reads the loop views, and the flood level as water', () => {
    expect(read('loop=1&world=end&seam=1&gust=1')).toMatchObject({
      file: true,
      world: 'end',
      seam: true,
      gust: true
    });
    expect(read('world=start').world).toBe('start');
    expect(read('world=both').world).toBeNull();
    expect(read('loop=0').file).toBe(false);
    expect(read('water=0.05').overrides).toEqual([[WATER_PATH, 0.05]]);
    expect(read('water=x').overrides).toEqual([]);
    // Written either way, it is one override, and the URL calls it water.
    expect(read(`override=${WATER_PATH}:-0.3`).overrides).toEqual([[WATER_PATH, -0.3]]);
    expect(roundTrip(`override=${WATER_PATH}:-0.3,weather.spray:0.6`)).toBe(
      'override=weather.spray%3A0.6&water=-0.3'
    );
  });

  it('takes A and B mod the cycle', () => {
    expect(read(`ab=-5,${CYCLE_SECONDS + 2}`).range).toEqual([CYCLE_SECONDS - 5, 2]);
    expect(read(`ab=${LOOP.fileStart + CYCLE_SECONDS},${CYCLE_SECONDS}`).range).toEqual([
      LOOP.fileStart,
      0
    ]);
  });

  it('reads what the stage reads too as the stage reads it, odd values and all', () => {
    for (const text of ['abc', '', ' ', '-1', '0', '2.5', 'Infinity']) {
      expect(read(`lodBias=${encodeURIComponent(text)}`).lodBias).toBe(parseLodBias(text));
    }
    for (const text of ['-1', '0', 'abc', '', '1.5', '2']) {
      expect(read(`dpr=${encodeURIComponent(text)}`).devicePixels).toBe(parseDevicePixels(text));
    }
    // An aspect the stage cannot read is the window's, and is not kept.
    expect(read('aspect=abc').aspect).toBe('');
    expect(roundTrip('aspect=abc&t=3')).toBe('t=3');
  });

  it('writes nothing for the defaults, and keeps what it does not own', () => {
    expect(roundTrip('')).toBe('');
    expect(roundTrip('t=50&capture=1&pickable=1')).toBe('t=50&capture=1&pickable=1');
  });

  it('gives back what it read', () => {
    for (const search of [
      'only=ground%2Cpot',
      'only=props',
      'only=',
      'only=sky&overlay=1',
      'overlay=0',
      'finish=0',
      'lodBias=-1',
      'aspect=9%3A16',
      'dpr=2',
      'msaa=0',
      'override=weather.rain%3A0.8%2Cwind.strength%3A1',
      'override=weather.curtains%3A0.75%2Cwind.gust%3A1%2Cground.silt%3A0.5',
      'water=0.05',
      'ab=44%2C52.5',
      'ab=62%2C2',
      'camera=orbit',
      'loop=1',
      'world=end',
      'world=start',
      'seam=1',
      'gust=1'
    ]) {
      expect(roundTrip(search)).toBe(search);
    }
  });

  it('writes the layers a toggle leaves, and the overlay the stage would otherwise drop', () => {
    const query = new URLSearchParams('t=12');
    const settings = setValueAtPath(parseDebugQuery(query, CONTEXT), 'layers.sky', false);
    const written = writeDebugQuery(settings, query, CONTEXT);
    expect(written.get('t')).toBe('12');
    expect(written.get('only')).toBe('ground,grass,trees,orange,seed,pot,net,weather');
    expect(written.get('overlay')).toBe('1');
    expect(read(written.toString())).toMatchObject({
      overlay: true,
      layers: written.get('only')?.split(',')
    });

    // A typed group stays while it still means the same layers, and goes when it does not.
    const props = new URLSearchParams('only=props');
    const fewer = setValueAtPath(parseDebugQuery(props, CONTEXT), 'layers.seed', false);
    expect(writeDebugQuery(fewer, props, CONTEXT).get('only')).toBe('orange,pot');
  });

  it('documents every parameter it reads or writes', () => {
    const names = getStageUrlParameters(CONTEXT).map(parameter => parameter.name);
    for (const name of [
      't',
      'only',
      'overlay',
      'finish',
      'lodBias',
      'aspect',
      'dpr',
      'msaa',
      'override',
      'water',
      'ab',
      'camera',
      'loop',
      'world',
      'seam',
      'gust'
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe('story overrides', () => {
  it('pins numbers on a copy, leaving the state and its trees alone', () => {
    const state = getStoryState(STORM_SECOND);
    const rain = state.weather.rain;
    const next = applyStoryOverrides(state, [
      ['weather.rain', 0.25],
      ['wind.bearing', 10],
      ['treeWetness', 1],
      [WATER_PATH, 0.07]
    ]);
    expect(next.weather.rain).toBe(0.25);
    expect(next.wind.bearing).toBe(10);
    expect(next.treeWetness).toBe(1);
    expect(next.ground.flood.level).toBe(0.07);
    expect(state.weather.rain).toBe(rain);
    expect(next.weather).not.toBe(state.weather);
    expect(next.weather.debris).toBe(state.weather.debris);
    expect(next.ground.flood).not.toBe(state.ground.flood);
    expect(next.ground.flood.splashes).toBe(state.ground.flood.splashes);
    expect(next.sky).toBe(state.sky);
    expect(next.trees).toBe(state.trees);
    expect(applyStoryOverrides(state, [])).toBe(state);
  });

  it('scales every tree’s own wind with a pinned wind strength, on copies of them', () => {
    const state = getStoryState(STORM_SECOND);
    const winds = state.trees.map(tree => tree.wind as number);
    const strength = state.wind.strength;
    expect(strength).toBeGreaterThan(0.1);
    const next = applyStoryOverrides(state, [['wind.strength', strength / 2]]);
    expect(next.wind.strength).toBe(strength / 2);
    expect(next.trees).not.toBe(state.trees);
    next.trees.forEach((tree, index) => {
      expect(tree.wind).toBeCloseTo(winds[index] / 2, 12);
      expect(tree.position).toBe(state.trees[index].position);
    });
    expect(state.trees.map(tree => tree.wind)).toEqual(winds);
    // In still air there is no share to scale, so each tree takes the pinned strength whole.
    const still = getStoryState(LOOP.fileStart);
    expect(still.wind.strength).toBe(0);
    const pinned = applyStoryOverrides(still, [['wind.strength', 0.3]]);
    for (const tree of pinned.trees) expect(tree.wind).toBe(0.3);
  });

  it('has a number in the state, and a range, for every field, all round the cycle', () => {
    for (const t of CYCLE_TIMES) {
      const state = getStoryState(t);
      for (const field of OVERRIDE_FIELDS) {
        expect(typeof getValueAtPath(state, field.path), `${field.path} at ${t}`).toBe('number');
      }
    }
    for (const field of OVERRIDE_FIELDS) expect(field.max).toBeGreaterThan(field.min);
  });

  it('turns the settings of a field into an override, and back to its field', () => {
    let settings = getDefaultDebugSettings(CONTEXT);
    settings = setStoryOverride(settings, 'sky.storm', true, 0.4);
    expect(readDebugValues(settings, CONTEXT).overrides).toEqual([['sky.storm', 0.4]]);
    settings = setStoryOverride(settings, 'sky.storm', false);
    expect(readDebugValues(settings, CONTEXT).overrides).toEqual([]);
    expect(getValueAtPath(settings, 'override.value.sky.storm')).toBe(0.4);
    expect(getOverrideOfSetting(getOverrideName('on', 'sky.storm'))).toMatchObject({part: 'on'});
    expect(getOverrideOfSetting('override.value.wind.strength')?.field.path).toBe('wind.strength');
    expect(getOverrideOfSetting('time.speed')).toBeNull();
  });
});

describe('playback, guides and the free camera', () => {
  const playback = (search: string) => getDebugPlayback(read(search), CONTEXT);

  it('plays round the cycle, as the file, or a range, through the swap too', () => {
    const {eyeOpen, eyeClose} = HURRICANE;
    expect(playback('')).toEqual({speed: 1, loop: true, from: 0, to: CYCLE_SECONDS});
    expect(playback(`ab=${eyeOpen},${eyeClose}`)).toMatchObject({from: eyeOpen, to: eyeClose});
    // From 62 s round through the swap to 2 s.
    expect(playback('ab=62,2')).toMatchObject({from: 62, to: CYCLE_SECONDS + 2});
    expect(playback('ab=-5,500')).toMatchObject({
      from: CYCLE_SECONDS - 5,
      to: CYCLE_SECONDS + (500 % CYCLE_SECONDS)
    });
    // A range too short to play is none.
    expect(playback(`ab=${eyeOpen},${eyeOpen}`)).toMatchObject({from: 0, to: CYCLE_SECONDS});
    expect(playback('loop=1')).toMatchObject({
      from: LOOP.fileStart,
      to: LOOP.fileStart + CYCLE_SECONDS
    });
    expect(playback(`loop=1&ab=${eyeOpen},${eyeClose}`)).toMatchObject({from: eyeOpen});
  });

  it('draws a window on the timeline in one piece, or in two through the swap', () => {
    const pieces = (search: string) => getPlaybackPieces(playback(search), CYCLE_SECONDS);
    expect(pieces('')).toEqual([[0, CYCLE_SECONDS]]);
    expect(pieces('loop=1')).toEqual([[0, CYCLE_SECONDS]]);
    expect(pieces('ab=44,52')).toEqual([[44, 52]]);
    expect(pieces('ab=62,2')).toEqual([
      [62, CYCLE_SECONDS],
      [0, 2]
    ]);
  });

  it('puts the safe area where the overlay keeps clear of, on portrait frames only', () => {
    expect(getSafeAreaInsets(1080, 1920)).toEqual({top: 260, right: 164, bottom: 370, left: 62});
    expect(getSafeAreaInsets(540, 960)).toEqual({top: 130, right: 82, bottom: 185, left: 31});
    expect(getSafeAreaInsets(1920, 1080)).toBeNull();
    expect(getSafeAreaInsets(0, 0)).toBeNull();
  });

  it('undoes getOrbitViewProps', () => {
    const height = 720;
    for (const t of CYCLE_TIMES) {
      const camera: StoryCamera = getStoryState(t).camera;
      const {viewState} = getOrbitViewProps(camera, height);
      const free = getCameraFromViewState(viewState, camera, height);
      expect(free.distance).toBeCloseTo(camera.distance, 9);
      expect(free.near).toBeCloseTo(camera.near, 9);
      expect(free.far).toBeCloseTo(camera.far, 9);
      expect(free.orbit).toBe(camera.orbit);
      expect(free.pitch).toBe(camera.pitch);
      expect(free.target).toEqual(camera.target);
    }
    const camera = getStoryState(STORM_SECOND).camera;
    const {viewState} = getOrbitViewProps(camera, height);
    const farther = getCameraFromViewState(
      {...viewState, zoom: viewState.zoom - 1},
      camera,
      height
    );
    expect(farther.distance).toBeCloseTo(camera.distance * 2, 9);
    expect(farther.far / farther.distance).toBeCloseTo(camera.far / camera.distance, 9);
  });

  it('starts a free camera on the shaken frame, and leaves the story camera alone', () => {
    const height = 720;
    const state = getStoryState(STORM_SECOND);
    expect(state.shake.some(value => value !== 0)).toBe(true);
    const free = getShakenCamera(state.camera, state.shake);
    expect(getOrbitViewProps(free, height).viewState).toEqual(
      getOrbitViewProps(state.camera, height, state.shake).viewState
    );
    expect(free.target).not.toBe(state.camera.target);
    expect(state.camera.orbit).toBe(getStoryState(STORM_SECOND).camera.orbit);
  });
});
