// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The stage's debug settings as plain data: their schema, how they go to and from the URL, and how
 * they change a frame. All of it pure, for Node tests. `debug-panel.ts` shows them with the panels
 * and widgets of `@deck.gl-community`, and `?capture=1` loads neither file.
 *
 * Settings are one `SettingsState`, keyed by the dot paths of `createDebugSchema`. What changes the
 * picture goes to the URL, so a reload or a shared link shows the same thing. A preference, such as
 * the speed, stays in local storage, and an action, such as a jump to a beat, nowhere. Parameters
 * the stage reads too are read with `stage-query.ts`, as the stage reads them.
 *
 * Times are cycle seconds and wrap, as the stage's do: an A-B range with B before A runs through
 * the swap, as 62 to 2 does.
 */

import {
  getSettingDefinitions,
  getValueAtPath,
  normalizeOption,
  resolveSettingValue,
  setValueAtPath,
  URLManager,
  type SettingDescriptor,
  type SettingsSchema,
  type SettingsState,
  type SettingValue,
  type URLParameter,
  type URLParameterValue
} from '@deck.gl-community/panels';
import {getCycleSeconds} from '../story/beats';
import {RADIANS_PER_DEGREE} from '../story/story-math';
import type {StoryCamera, StoryState, StoryWorld, Vec3} from '../story/story-types';
import {
  parseAspect,
  parseDevicePixels,
  parseLodBias,
  parseOnlyLayers,
  parseSwitch,
  parseWorld
} from './stage-query';
import {DESIGN_SIZE, PORTRAIT_BELOW, PORTRAIT_SAFE_AREA} from './timeline-overlay';

/** How many objects deep `NumberPath` goes, so a type that refers to itself still ends. */
type MostPathDepth = 4;

/**
 * Every dot path of `T` that ends in a number, through objects but not through arrays, and at most
 * `MostPathDepth` objects deep.
 */
type NumberPath<
  T,
  Prefix extends string = '',
  Depth extends readonly unknown[] = []
> = Depth['length'] extends MostPathDepth
  ? never
  : {
      [Key in keyof T & string]: T[Key] extends number
        ? `${Prefix}${Key}`
        : T[Key] extends readonly unknown[]
          ? never
          : T[Key] extends object
            ? NumberPath<T[Key], `${Prefix}${Key}.`, [...Depth, unknown]>
            : never;
    }[keyof T & string];

/** A number in `StoryState` by its dot path, such as `weather.rain`. */
export type StoryNumberPath = NumberPath<StoryState>;

/** A number of `StoryState` that the panel can pin, and its slider. */
export type OverrideField = {
  path: StoryNumberPath;
  label: string;
  min: number;
  max: number;
  step: number;
};

/**
 * What the Overrides tab offers, in its order. A number the story adds later takes one line here
 * once `story-types.ts` has it.
 */
export const OVERRIDE_FIELDS: readonly OverrideField[] = [
  {path: 'weather.rain', label: 'Rain', min: 0, max: 1, step: 0.01},
  {path: 'weather.curtains', label: 'Rain curtains', min: 0, max: 1, step: 0.01},
  {path: 'weather.spray', label: 'Spray', min: 0, max: 1, step: 0.01},
  {path: 'weather.debris', label: 'Debris', min: 0, max: 1, step: 0.01},
  {path: 'wind.strength', label: 'Wind strength', min: 0, max: 1, step: 0.01},
  {path: 'wind.gust', label: 'Wind gust', min: 0, max: 1, step: 0.01},
  {path: 'wind.bearing', label: 'Wind bearing', min: 0, max: 360, step: 1},
  {path: 'sky.storm', label: 'Storm sky', min: 0, max: 1, step: 0.01},
  {path: 'ground.flood.level', label: 'Flood level', min: -0.75, max: 0.3, step: 0.005},
  {path: 'ground.wetness', label: 'Ground wetness', min: 0, max: 1, step: 0.01},
  {path: 'ground.silt', label: 'Silt', min: 0, max: 1, step: 0.01},
  {path: 'treeWetness', label: 'Tree wetness', min: 0, max: 1, step: 0.01}
];

/** The override `?water=` pins: metres of the flood's surface. */
export const WATER_PATH = 'ground.flood.level' satisfies StoryNumberPath;

/** The speeds playback offers, in the toolbar and in the Time tab. */
export const PLAYBACK_SPEEDS: readonly {label: string; value: number}[] = [
  {label: '¼×', value: 0.25},
  {label: '½×', value: 0.5},
  {label: '1×', value: 1},
  {label: '2×', value: 2},
  {label: '4×', value: 4}
];

/** A pinned number: where it goes in `StoryState`, and its value. */
export type StoryOverride = readonly [path: StoryNumberPath, value: number];

/** What the settings are built from, which the stage knows at runtime. */
export type DebugContext = {
  /** The stage's layers in draw order, by the names `?only=` takes. */
  layerNames: readonly string[];
  /** The layers shown when the URL has no `only`. */
  defaultLayers: readonly string[];
  /** Names `?only=` takes for several layers at once, as `props`. */
  layerGroups: Readonly<Record<string, readonly string[]>>;
  /** The beat table, as the story has it now. */
  beats: readonly {id: string; start: number}[];
  /** Length of the cycle in seconds, `CYCLE_SECONDS`. */
  cycleSeconds: number;
  /** The cycle second the file starts on, `LOOP.fileStart`. */
  fileStart: number;
};

/** Settings as the stage applies them. */
export type DebugValues = {
  speed: number;
  /** Whether playback starts again at its end. The cycle itself just goes on. */
  loop: boolean;
  /** Whether playback runs as the file does, from `LOOP.fileStart` round the cycle: `?loop=1`. */
  file: boolean;
  /** A and B in cycle seconds, kept while the range is off. */
  a: number;
  b: number;
  /**
   * Cycle seconds playback runs from and to, forward, through the swap when the second is before
   * the first, or null for no range.
   */
  range: readonly [from: number, to: number] | null;
  /** Names of the layers shown, in draw order. */
  layers: string[];
  overlay: boolean;
  finish: boolean;
  overrides: StoryOverride[];
  /** `TreeLayer.lodBias`, or null for the stage's own choice. */
  lodBias: number | null;
  /** Sub-frames of a still, before a wide lens adds some. */
  samples: number;
  /** As `?aspect=` takes it, or '' for the window's shape. */
  aspect: string;
  guides: boolean;
  devicePixels: number;
  msaa: boolean;
  camera: 'story' | 'orbit';
  readout: boolean;
  /** The side of the swap a second inside `LOOP.cover` is composed from, or null: `?world=`. */
  world: StoryWorld | null;
  /** The seam strip: `?seam=1`. */
  seam: boolean;
  /** The gust plot: `?gust=1`. */
  gust: boolean;
};

/**
 * How playback runs: at a speed, from cycle second `from` forward to `to`, which may be past the
 * end of the cycle, as a range through the swap is, looping or not. A window of the whole cycle
 * just goes on round it while it loops.
 */
export type DebugPlayback = {speed: number; loop: boolean; from: number; to: number};

/** A range shorter than this is no range. */
const LEAST_RANGE_SECONDS = 0.1;
const WORLDS = [
  {label: 'The second decides', value: ''},
  {label: 'End: the Year 30 grove', value: 'end'},
  {label: 'Start: the Day 0 field', value: 'start'}
];
const LOD_BIASES = ['auto', '-2', '-1', '0', '1', '2'];
const DEVICE_PIXELS = [1, 1.5, 2];
const ASPECTS = [
  {label: 'Window', value: ''},
  {label: '16:9', value: '16:9'},
  {label: '9:16', value: '9:16'}
];
const LAYER_LABELS: Record<string, string> = {
  plain: 'Plain stand-in'
};

function getLayerLabel(name: string): string {
  return LAYER_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** The name of an override's pin, or of its value. */
export function getOverrideName(part: 'on' | 'value', path: StoryNumberPath): string {
  return `override.${part}.${path}`;
}

/** Options of a select, with `current` added when it is not one of them, so it is never lost. */
function getOptionsWithCurrent<ValueT extends string | number>(
  options: readonly (ValueT | {label: string; value: ValueT})[],
  current: unknown
): (ValueT | {label: string; value: ValueT})[] {
  const known = options.some(option => normalizeOption(option).value === current);
  const isValue = typeof current === 'string' || typeof current === 'number';
  return known || !isValue ? [...options] : [...options, current as ValueT];
}

/**
 * The settings and their controls, in tabs. Selects keep any value `current` has that they do not
 * offer, such as an `aspect` of 4:5 from the URL.
 */
export function createDebugSchema(
  context: DebugContext,
  current: SettingsState = {}
): SettingsSchema {
  const {cycleSeconds, fileStart} = context;
  const valueOf = (name: string) => getValueAtPath(current, name);
  return {
    title: 'Stage',
    sections: [
      {
        id: 'time',
        name: 'Time',
        description: 'Playback',
        settings: [
          {
            name: 'time.speed',
            label: 'Speed',
            group: 'Playback',
            type: 'select',
            options: [...PLAYBACK_SPEEDS],
            defaultValue: 1,
            persist: 'local-storage'
          },
          {
            name: 'time.loop',
            label: 'Loop',
            description:
              'Round the cycle without end, or from B back to A. Off, it stops at the end or at B.',
            group: 'Playback',
            type: 'boolean',
            defaultValue: true,
            persist: 'local-storage'
          },
          {
            name: 'time.file',
            label: 'Play as the file',
            description: `From the file's first frame, ${fileStart} s, round the cycle, as a feed loops it.`,
            group: 'Playback',
            type: 'boolean',
            defaultValue: false,
            persist: 'url'
          },
          {
            name: 'time.beat',
            label: 'Jump to beat',
            description: 'To the start of any beat, the one playing too. Up and down arrows step.',
            group: 'Beats',
            type: 'select',
            options: [
              {label: 'Choose a beat', value: ''},
              ...context.beats.map(beat => ({
                label: `${beat.id} · ${beat.start} s`,
                value: beat.id
              }))
            ],
            defaultValue: '',
            persist: 'none'
          },
          {
            name: 'time.range',
            label: 'A-B range',
            description:
              'Play only from A to B. B before A runs through the swap, as 62 to 2 does.',
            group: 'A-B range',
            type: 'boolean',
            defaultValue: false,
            persist: 'url'
          },
          {
            name: 'time.a',
            label: 'A',
            group: 'A-B range',
            type: 'number',
            min: 0,
            max: cycleSeconds,
            step: 0.01,
            defaultValue: 0,
            persist: 'url'
          },
          {
            name: 'time.b',
            label: 'B',
            group: 'A-B range',
            type: 'number',
            min: 0,
            max: cycleSeconds,
            step: 0.01,
            defaultValue: cycleSeconds,
            persist: 'url'
          }
        ]
      },
      {
        id: 'loop',
        name: 'Loop',
        description: 'The swap and the seam',
        settings: [
          {
            name: 'loop.world',
            label: 'World',
            description:
              'Which side of the swap a second inside the rind is composed from. Outside it, the second decides.',
            group: 'Swap',
            type: 'select',
            options: WORLDS,
            defaultValue: '',
            persist: 'url'
          },
          {
            name: 'loop.seam',
            label: 'Seam strip',
            description:
              'Seam −2/30, −1/60 (end), +1/60 (start) and +2/30 s side by side, grain off, with the MAD and PSNR between them and between the worlds.',
            group: 'Checks',
            type: 'boolean',
            defaultValue: false,
            persist: 'url'
          },
          {
            name: 'loop.gust',
            label: 'Gust plot',
            description:
              'wind.gust at the storm view point through the storm, with the peaks it is locked to.',
            group: 'Checks',
            type: 'boolean',
            defaultValue: false,
            persist: 'url'
          }
        ]
      },
      {
        id: 'layers',
        name: 'Layers',
        description: 'As ?only= and ?finish=',
        settings: [
          ...context.layerNames.map(
            (name): SettingDescriptor => ({
              name: `layers.${name}`,
              label: getLayerLabel(name),
              group: 'Layers',
              type: 'boolean',
              defaultValue: context.defaultLayers.includes(name),
              persist: 'url'
            })
          ),
          {
            name: 'layers.overlay',
            label: 'Timeline and captions',
            description: 'Needs the finish.',
            group: 'Frame',
            type: 'boolean',
            defaultValue: true,
            persist: 'url'
          },
          {
            name: 'layers.finish',
            label: 'Finish',
            description: 'Bloom, grade, fade and grain. Off is what deck drew.',
            group: 'Frame',
            type: 'boolean',
            defaultValue: true,
            persist: 'url'
          }
        ]
      },
      {
        id: 'overrides',
        name: 'Overrides',
        description: 'Story numbers',
        settings: OVERRIDE_FIELDS.flatMap((field): SettingDescriptor[] => [
          {
            name: getOverrideName('on', field.path),
            label: 'Pinned',
            description: `${field.path}. Unpinned, the story decides.`,
            group: field.label,
            type: 'boolean',
            defaultValue: false,
            persist: 'url'
          },
          {
            name: getOverrideName('value', field.path),
            label: 'Value',
            group: field.label,
            type: 'number',
            min: field.min,
            max: field.max,
            step: field.step,
            defaultValue: field.min,
            persist: 'url'
          }
        ])
      },
      {
        id: 'trees',
        name: 'Trees',
        description: 'TreeLayer',
        settings: [
          {
            name: 'trees.lodBias',
            label: 'LOD bias',
            description: 'lodBias. Auto is 0 for a still and 1 while moving.',
            group: 'TreeLayer',
            type: 'select',
            options: getOptionsWithCurrent(LOD_BIASES, valueOf('trees.lodBias')).map(value =>
              value === 'auto' ? {label: 'Auto', value} : value
            ),
            defaultValue: 'auto',
            persist: 'url'
          }
        ]
      },
      {
        id: 'render',
        name: 'Render',
        description: 'Stills and frame',
        settings: [
          {
            name: 'render.samples',
            label: 'Still samples',
            description: 'Sub-frames of a still, as an export renders it: more for a wide lens.',
            group: 'Still',
            type: 'number',
            min: 1,
            max: 64,
            step: 1,
            defaultValue: 16,
            persist: 'local-storage'
          },
          {
            name: 'render.aspect',
            label: 'Aspect',
            group: 'Frame',
            type: 'select',
            options: getOptionsWithCurrent(ASPECTS, valueOf('render.aspect')),
            defaultValue: '',
            persist: 'url'
          },
          {
            name: 'render.guides',
            label: 'Safe area guides',
            description: 'What TikTok, Reels and Shorts leave clear, on a portrait frame.',
            group: 'Frame',
            type: 'boolean',
            defaultValue: false,
            persist: 'local-storage'
          },
          {
            name: 'render.dpr',
            label: 'Device pixels',
            description: 'Per CSS pixel. Changes at once.',
            group: 'Canvas',
            type: 'select',
            options: getOptionsWithCurrent(DEVICE_PIXELS, valueOf('render.dpr')),
            defaultValue: 1,
            persist: 'url'
          },
          {
            name: 'render.msaa',
            label: 'MSAA (reloads)',
            description: 'The canvas keeps its antialiasing for life, so this reloads the page.',
            group: 'Canvas',
            type: 'boolean',
            defaultValue: true,
            persist: 'url'
          }
        ]
      },
      {
        id: 'camera',
        name: 'Camera',
        description: 'View',
        settings: [
          {
            name: 'camera.mode',
            label: 'Camera',
            description: 'Free orbit: drag to orbit, Shift-drag to pan, wheel to zoom.',
            group: 'Camera',
            type: 'select',
            options: [
              {label: 'Story', value: 'story'},
              {label: 'Free orbit', value: 'orbit'}
            ],
            defaultValue: 'story',
            persist: 'url'
          },
          {
            name: 'camera.readout',
            label: 'Readout',
            description: "The story camera's values, and the free camera's.",
            group: 'Camera',
            type: 'boolean',
            defaultValue: false,
            persist: 'local-storage'
          }
        ]
      }
    ]
  };
}

/** Every setting at its default. */
export function getDefaultDebugSettings(context: DebugContext): SettingsState {
  let settings: SettingsState = {};
  for (const descriptor of getSettingDefinitions(createDebugSchema(context)).values()) {
    settings = setValueAtPath(settings, descriptor.name, resolveSettingValue(descriptor, {}));
  }
  return settings;
}

/** `settings` as the stage applies them, with defaults for what is missing. */
export function readDebugValues(settings: SettingsState, context: DebugContext): DebugValues {
  const definitions = getSettingDefinitions(createDebugSchema(context, settings));
  const get = (name: string): SettingValue => {
    const descriptor = definitions.get(name);
    if (!descriptor) throw new Error(`No debug setting ${name}`);
    return resolveSettingValue(descriptor, settings);
  };
  const lodBias = get('trees.lodBias');
  const a = Number(get('time.a'));
  const b = Number(get('time.b'));
  return {
    speed: Number(get('time.speed')),
    loop: Boolean(get('time.loop')),
    file: Boolean(get('time.file')),
    a,
    b,
    range: get('time.range') ? [getCycleSeconds(a), getCycleSeconds(b)] : null,
    layers: context.layerNames.filter(name => get(`layers.${name}`)),
    overlay: Boolean(get('layers.overlay')),
    finish: Boolean(get('layers.finish')),
    overrides: OVERRIDE_FIELDS.filter(field => get(getOverrideName('on', field.path))).map(
      (field): StoryOverride => [field.path, Number(get(getOverrideName('value', field.path)))]
    ),
    lodBias: lodBias === 'auto' ? null : parseLodBias(String(lodBias)),
    samples: Math.round(Number(get('render.samples'))),
    aspect: String(get('render.aspect')),
    guides: Boolean(get('render.guides')),
    devicePixels: Number(get('render.dpr')),
    msaa: Boolean(get('render.msaa')),
    camera: get('camera.mode') === 'orbit' ? 'orbit' : 'story',
    readout: Boolean(get('camera.readout')),
    world: parseWorld(String(get('loop.world'))),
    seam: Boolean(get('loop.seam')),
    gust: Boolean(get('loop.gust'))
  };
}

/** `settings` with an override pinned or not, and its value when one is given. */
export function setStoryOverride(
  settings: SettingsState,
  path: StoryNumberPath,
  pinned: boolean,
  value?: number
): SettingsState {
  const next = setValueAtPath(settings, getOverrideName('on', path), pinned);
  return value === undefined ? next : setValueAtPath(next, getOverrideName('value', path), value);
}

/** Which override a setting's name belongs to, and whether it is its pin or its value. */
export function getOverrideOfSetting(
  name: string
): {field: OverrideField; part: 'on' | 'value'} | null {
  for (const field of OVERRIDE_FIELDS) {
    if (name === getOverrideName('on', field.path)) return {field, part: 'on'};
    if (name === getOverrideName('value', field.path)) return {field, part: 'value'};
  }
  return null;
}

/**
 * `state` with each pinned number in place. Objects are copied along each path, with
 * `setValueAtPath`, so `state` and what it shares with other frames, as its trees, are untouched.
 * Every tree authors its own `wind`, which `TreeLayer` bends it by rather than `windStrength`, so a
 * pinned `wind.strength` scales each tree's, on copies of them: in still air, where there is no
 * share to scale, each tree takes it whole.
 */
export function applyStoryOverrides(
  state: StoryState,
  overrides: readonly StoryOverride[]
): StoryState {
  let next = state as unknown as SettingsState;
  for (const [path, value] of overrides) next = setValueAtPath(next, path, value);
  const result = next as unknown as StoryState;
  const strength = result.wind.strength;
  if (strength === state.wind.strength) return result;
  const share = state.wind.strength > 0 ? strength / state.wind.strength : null;
  return {
    ...result,
    trees: state.trees.map(tree => ({
      ...tree,
      wind:
        share === null
          ? strength
          : typeof tree.wind === 'number'
            ? Math.min(tree.wind * share, 1)
            : tree.wind
    }))
  };
}

/**
 * How playback runs for these values: from A forward to B, through the swap when B is before A,
 * or round the whole cycle from its start, or from the file's with `file`. A range shorter than a
 * tenth of a second is no range.
 */
export function getDebugPlayback(values: DebugValues, context: DebugContext): DebugPlayback {
  const {speed, loop} = values;
  if (values.range) {
    const from = getCycleSeconds(values.range[0]);
    const length = getCycleSeconds(values.range[1] - from);
    if (length >= LEAST_RANGE_SECONDS) return {speed, loop, from, to: from + length};
  }
  const from = values.file ? getCycleSeconds(context.fileStart) : 0;
  return {speed, loop, from, to: from + context.cycleSeconds};
}

/** Pieces of the cycle a playback window covers, as the timeline draws it: one, or two through the swap. */
export function getPlaybackPieces(
  playback: Pick<DebugPlayback, 'from' | 'to'>,
  cycleSeconds: number
): [from: number, to: number][] {
  const {from, to} = playback;
  if (to - from >= cycleSeconds) return [[0, cycleSeconds]];
  return to <= cycleSeconds
    ? [[from, to]]
    : [
        [from, cycleSeconds],
        [0, to - cycleSeconds]
      ];
}

// The URL. Each parameter reads into and writes from a box around the settings, so it can replace
// them. Parameters the debug panel does not own, as `t` or `capture`, are kept as they are.

/** Settings in and out of a URL, and what they say, worked out once for all the parameters. */
type SettingsBox = {settings: SettingsState; values?: DebugValues};

function getFirstValue(value: URLParameterValue): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** The layers `?only=` names, by layer or by group, in draw order, as the stage reads them. */
export function getOnlyLayers(text: string, context: DebugContext): string[] {
  return parseOnlyLayers(text, context.layerNames, context.layerGroups).layers;
}

function isSameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(name => b.includes(name));
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function getDebugUrlParameters(
  context: DebugContext,
  baseQuery: URLSearchParams | null
): URLParameter<SettingsBox>[] {
  const read = (box: SettingsBox) => (box.values ??= readDebugValues(box.settings, context));
  const update = (box: SettingsBox, settings: SettingsState) => {
    box.settings = settings;
    box.values = undefined;
  };
  const write = (box: SettingsBox, name: string, value: SettingValue) =>
    update(box, setValueAtPath(box.settings, name, value));
  const isOnlyGiven = (values: DebugValues) => !isSameSet(values.layers, context.defaultLayers);
  return [
    {
      name: 'only',
      description: `Only these layers, in draw order: ${context.layerNames.join(', ')}, or a group as props.`,
      serialize: box => {
        const {layers} = read(box);
        if (isSameSet(layers, context.defaultLayers)) return undefined;
        // What was typed stays, as `props`, while it means the same layers.
        const typed = baseQuery?.get('only');
        if (typed !== null && typed !== undefined) {
          if (isSameSet(getOnlyLayers(typed, context), layers)) return typed;
        }
        return layers.join(',');
      },
      deserialize: (value, box) => {
        const shown = getOnlyLayers(getFirstValue(value), context);
        for (const name of context.layerNames) write(box, `layers.${name}`, shown.includes(name));
      }
    },
    {
      name: 'overlay',
      description: 'Timeline and captions, 1 or 0. On by default, and off by default with only.',
      serialize: box => {
        const values = read(box);
        return values.overlay === !isOnlyGiven(values) ? undefined : values.overlay ? '1' : '0';
      },
      deserialize: (value, box) =>
        write(box, 'layers.overlay', parseSwitch(getFirstValue(value), true))
    },
    {
      name: 'finish',
      description: 'finish=0 shows what deck drew: no bloom, grade, fade, grain or overlay.',
      serialize: box => (read(box).finish ? undefined : '0'),
      deserialize: (value, box) =>
        write(box, 'layers.finish', parseSwitch(getFirstValue(value), true))
    },
    {
      name: 'lodBias',
      description: 'TreeLayer.lodBias, always, rather than 0 for a still and 1 while moving.',
      serialize: box => {
        const {lodBias} = read(box);
        return lodBias === null ? undefined : formatNumber(lodBias);
      },
      deserialize: (value, box) => {
        const lodBias = parseLodBias(getFirstValue(value));
        write(box, 'trees.lodBias', lodBias === null ? 'auto' : formatNumber(lodBias));
      }
    },
    {
      name: 'aspect',
      description: 'A frame of this shape inside the window, as 9:16 or 0.5625.',
      serialize: box => read(box).aspect || undefined,
      deserialize: (value, box) => {
        const text = getFirstValue(value);
        write(box, 'render.aspect', parseAspect(text) ? text : '');
      }
    },
    {
      name: 'dpr',
      description: 'Device pixels per CSS pixel. 1 by default.',
      serialize: box => {
        const {devicePixels} = read(box);
        return devicePixels === 1 ? undefined : formatNumber(devicePixels);
      },
      deserialize: (value, box) => write(box, 'render.dpr', parseDevicePixels(getFirstValue(value)))
    },
    {
      name: 'msaa',
      description: 'msaa=0 makes the canvas without MSAA, which many samples have no use for.',
      serialize: box => (read(box).msaa ? undefined : '0'),
      deserialize: (value, box) =>
        write(box, 'render.msaa', parseSwitch(getFirstValue(value), true))
    },
    {
      name: 'override',
      description:
        'Pinned numbers of the story, as weather.rain:0.8,wind.strength:1. The flood level goes as water. Debug panel only.',
      serialize: box => {
        const overrides = read(box).overrides.filter(([path]) => path !== WATER_PATH);
        if (overrides.length === 0) return undefined;
        return overrides.map(([path, value]) => `${path}:${formatNumber(value)}`).join(',');
      },
      deserialize: (value, box) => {
        for (const entry of getFirstValue(value).split(',')) {
          const [path, text] = entry.split(':');
          const field = OVERRIDE_FIELDS.find(candidate => candidate.path === path);
          const number = Number(text);
          if (field && text !== undefined && text !== '' && Number.isFinite(number)) {
            update(box, setStoryOverride(box.settings, field.path, true, number));
          }
        }
      }
    },
    {
      name: 'water',
      description: `The flood's surface pinned at these metres, as water=0.05: the ${WATER_PATH} override. Debug panel only.`,
      serialize: box => {
        const water = read(box).overrides.find(([path]) => path === WATER_PATH);
        return water ? formatNumber(water[1]) : undefined;
      },
      deserialize: (value, box) => {
        const text = getFirstValue(value);
        const metres = Number(text);
        if (text.trim() !== '' && Number.isFinite(metres)) {
          update(box, setStoryOverride(box.settings, WATER_PATH, true, metres));
        }
      }
    },
    {
      name: 'ab',
      description:
        'Play only from A to B, in cycle seconds, as 44,52, or through the swap, as 62,2. Debug panel only.',
      serialize: box => {
        const {range} = read(box);
        return range ? `${formatNumber(range[0])},${formatNumber(range[1])}` : undefined;
      },
      deserialize: (value, box) => {
        const [a, b] = getFirstValue(value).split(',').map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          write(box, 'time.range', true);
          write(box, 'time.a', getCycleSeconds(a));
          write(box, 'time.b', getCycleSeconds(b));
        }
      }
    },
    {
      name: 'loop',
      description:
        'loop=1 plays as the file does, from its first frame round the cycle. Debug panel only.',
      serialize: box => (read(box).file ? '1' : undefined),
      deserialize: (value, box) => write(box, 'time.file', parseSwitch(getFirstValue(value), false))
    },
    {
      name: 'world',
      description:
        'world=end or world=start: which side of the swap a second inside the rind is composed from. A capture reads it too.',
      serialize: box => read(box).world ?? undefined,
      deserialize: (value, box) => write(box, 'loop.world', parseWorld(getFirstValue(value)) ?? '')
    },
    {
      name: 'seam',
      description:
        'seam=1 shows the seconds either side of the swap side by side, with their MAD and PSNR. Debug panel only.',
      serialize: box => (read(box).seam ? '1' : undefined),
      deserialize: (value, box) => write(box, 'loop.seam', parseSwitch(getFirstValue(value), false))
    },
    {
      name: 'gust',
      description: 'gust=1 plots wind.gust through the storm, with its peaks. Debug panel only.',
      serialize: box => (read(box).gust ? '1' : undefined),
      deserialize: (value, box) => write(box, 'loop.gust', parseSwitch(getFirstValue(value), false))
    },
    {
      name: 'camera',
      description:
        'camera=orbit starts the free camera where the story camera is. Where a drag takes it is not kept. Debug panel only.',
      serialize: box => (read(box).camera === 'orbit' ? 'orbit' : undefined),
      deserialize: (value, box) =>
        write(box, 'camera.mode', getFirstValue(value) === 'orbit' ? 'orbit' : 'story')
    }
  ];
}

/**
 * The URL parameters the stage reads but the debug panel leaves alone, for the help panel. They
 * never write anything.
 */
const READ_ONLY_URL_PARAMETERS: readonly URLParameter<SettingsBox>[] = [
  {
    name: 't',
    description:
      'The cycle second to open at, taken mod the cycle and kept to the frame. Kept up to date while the page is open.',
    serialize: () => undefined,
    deserialize: () => undefined
  },
  {
    name: 'pickable',
    description: 'Every layer pickable, for pickStage.',
    serialize: () => undefined,
    deserialize: () => undefined
  },
  {
    name: 'capture',
    description:
      'For tools: no debug panel, no playback, and nothing of the debug-only parameters.',
    serialize: () => undefined,
    deserialize: () => undefined
  }
];

/** Every URL parameter, documented, for `URLParametersPanel`. */
export function getStageUrlParameters(context: DebugContext): URLParameter<SettingsBox>[] {
  return [...READ_ONLY_URL_PARAMETERS, ...getDebugUrlParameters(context, null)];
}

/** Settings from a URL query, with defaults for what it does not say. */
export function parseDebugQuery(query: URLSearchParams, context: DebugContext): SettingsState {
  const box: SettingsBox = {settings: getDefaultDebugSettings(context)};
  const parsed = new URLManager(getDebugUrlParameters(context, null)).parseIntoState(box, query);
  // As the stage has it, `only` hides the overlay unless `overlay` says otherwise.
  if (!('overlay' in parsed) && 'only' in parsed) {
    box.settings = setValueAtPath(box.settings, 'layers.overlay', false);
  }
  return box.settings;
}

/**
 * `query` with what `settings` says in place of what the debug panel owns. Any other parameter
 * stays where it was, and a parameter at its default is left out.
 */
export function writeDebugQuery(
  settings: SettingsState,
  query: URLSearchParams,
  context: DebugContext
): URLSearchParams {
  return new URLManager(getDebugUrlParameters(context, query)).createSearchParams(
    {settings},
    {baseParams: query, preserveUnknownParams: true}
  );
}

// The frame and the camera.

/** Insets of a frame, in its own pixels. */
export type FrameInsets = {top: number; right: number; bottom: number; left: number};

/**
 * Where `PORTRAIT_SAFE_AREA` falls on a frame of this size, as insets in the same units, or null
 * for a frame that is not portrait, as the overlay decides.
 */
export function getSafeAreaInsets(width: number, height: number): FrameInsets | null {
  if (!(width > 0 && height > 0) || width / height >= PORTRAIT_BELOW) return null;
  const unit = width / DESIGN_SIZE;
  return {
    top: PORTRAIT_SAFE_AREA.top * unit,
    right: PORTRAIT_SAFE_AREA.right * unit,
    bottom: PORTRAIT_SAFE_AREA.bottom * unit,
    left: PORTRAIT_SAFE_AREA.left * unit
  };
}

/** What deck's `OrbitController` changes of a view state. */
export type OrbitViewState = {
  target: readonly number[];
  rotationOrbit: number;
  rotationX: number;
  zoom: number;
};

/**
 * The camera a view state shows, for a frame `height` CSS pixels tall: the inverse of
 * `getOrbitViewProps`. Lens, field of view and the planes, in proportion to distance, are those of
 * `base`, so that the first frame of a free camera is the story's.
 */
export function getCameraFromViewState(
  viewState: OrbitViewState,
  base: StoryCamera,
  height: number
): StoryCamera {
  const focal = 0.5 / Math.tan((base.fovy / 2) * RADIANS_PER_DEGREE);
  const unitsPerMetre = 2 ** viewState.zoom / Math.max(height, 1);
  const distance = focal / unitsPerMetre;
  const scale = distance / base.distance;
  const [x = 0, y = 0, z = 0] = viewState.target;
  return {
    ...base,
    target: [x, y, z] as Vec3,
    orbit: viewState.rotationOrbit,
    pitch: viewState.rotationX,
    distance,
    near: base.near * scale,
    far: base.far * scale
  };
}

/**
 * The camera of a frame as the stage draws it, with the story's shake made part of it, so a free
 * camera that starts here starts on the same picture and holds it.
 */
export function getShakenCamera(
  camera: StoryCamera,
  shake: readonly [number, number]
): StoryCamera {
  return {
    ...camera,
    target: [...camera.target] as Vec3,
    orbit: camera.orbit + shake[0],
    pitch: camera.pitch + shake[1]
  };
}
