// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The stage: one `Deck`, one `LightingEffect`, the film's layers in draw order, `renderAt` for
 * tools, and the clock for a person dialing the film in.
 *
 *   stage.html                   The film, paused at the start of the cycle, with debug tools.
 *   stage.html?t=52.3            Opens at this cycle second.
 *   stage.html?only=ground,pot   Only these layers, against a plain sky. See `LAYERS`.
 *   stage.html?aspect=9:16       A frame of this shape inside the window.
 *   stage.html?dpr=2             Device pixels per CSS pixel. @default 1
 *   stage.html?lodBias=-1        `TreeLayer.lodBias`, always. See `STILL_LOD_BIAS`.
 *   stage.html?pickable=1        Every layer `pickable`, for `pickStage`.
 *   stage.html?capture=1         For tools: no debug tools and no playback.
 *   stage.html?finish=0          Deck's frame as it is: no bloom, grade, fade, grain or overlay.
 *   stage.html?overlay=0         No timeline or captions. With `only`, there are none unless asked.
 *   stage.html?msaa=0            No MSAA on the canvas, which accumulation has no use for.
 *   stage.html?world=end         A second inside `LOOP.cover` composed from this side of the swap,
 *                                `end` or `start`, for the seam check. A capture reads it too.
 *
 * `stage-query.ts` reads these. Without `capture`, `debug-panel.ts` adds the keys, a timeline, a
 * toolbar, settings, stats and guides, and keeps `only`, `overlay`, `finish` and the rest of the
 * URL in step with them. It changes the stage only through `StageHost` and `StageOptions`, and has
 * parameters of its own, as `override`, `water`, `loop`, `seam` and `gust`. See `FILM.md`.
 *
 * Time is cycle seconds. Every time the stage is given, played to, scrubbed to, prerolled at or
 * jittered to is taken mod `CYCLE_SECONDS` with `getCycleSeconds`, and nothing clamps: the second
 * before 0 is 63.9667, and a step from it to 0 follows on as any other does. A frame is a function
 * of its second mod the cycle.
 *
 * The stage draws every frame itself, in one go: a frame's layers are updated and drawn before
 * anything else can run, and Deck's own animation loop is stopped, so nothing is drawn behind its
 * back. That also holds for `state.trees`, whose numbers are only good until the next
 * `getStoryState`.
 *
 * A frame on screen is always finished. `renderAt` takes `samples`, and draws that many sub-frames
 * into a float target, each with its clock, lens, pixel grid and sun moved a little; a single
 * sample, as the preview plays, goes through the canvas with no jitter. See `accumulator.ts`.
 */

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  type Layer,
  LightingEffect,
  OrbitView
} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {TreeLayer} from '@deck.gl-community/layers';
import type {Framebuffer, Shader} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {createGrassLayer} from '../layers/grass-layer';
import {createGroundLayer} from '../layers/ground-layer';
import {createNetLayer} from '../layers/net-layer';
import {createOrangeLayer} from '../layers/orange-layer';
import {createPotLayer} from '../layers/pot-layer';
import {createSeedLayer} from '../layers/seed-layer';
import {createSkyLayer} from '../layers/sky-layer';
import {createWeatherLayer} from '../layers/weather-layer';
import {getCycleSeconds, getSeamSeconds, getWorld, isInSeamWindow} from '../story/beats';
import {getOrbitViewProps} from '../story/camera';
import {BEAT_TABLE, CYCLE_SECONDS, getStoryState, LOOP} from '../story/story';
import type {StoryDirectionalLight, StoryGrade, StoryState, StoryWorld} from '../story/story-types';
import {
  Accumulator,
  DEFAULT_FPS,
  DEFAULT_SHUTTER,
  getFarBlurRadius,
  getFocusedCamera,
  getFocusPull,
  getJitteredDirection,
  getLensAngles,
  getLensSamples,
  getPixelPadding,
  getSubFrameSeconds,
  getSubFrames,
  PINHOLE_SUB_FRAME,
  type SubFrame
} from './accumulator';
import type {DebugContext, DebugPlayback} from './debug-settings';
import {
  formatStageSeconds,
  getFrameDifference,
  getFrameSeconds,
  getFrameShutter,
  getPlaybackPlace,
  parseAspect,
  parseDevicePixels,
  parseLodBias,
  parseOnlyLayers,
  parseStageSeconds,
  parseSwitch,
  parseWorld,
  SEAM_CHECK,
  type FrameDifference
} from './stage-query';
import {
  createCanvasMeasure,
  drawTimelineOverlay,
  findFlagOverlaps,
  findPoleCrossings,
  getOverlayMetrics,
  layOutTimelineOverlay,
  type MeasureText,
  type OverlayMetrics
} from './timeline-overlay';

declare global {
  interface Window {
    /** A tool's ear for `encodeSegment`. */
    onExportFrame?: (progress: {frame: number; renderMs: number; totalMs: number}) => void;
  }
}

type LayerFactory = (state: StoryState) => Layer | Layer[] | null;

/** What `renderAt` takes. */
export type RenderOptions = {
  /**
   * Draw `t - 1/60` first, so falling things have their rates. By default only when `t` does not
   * follow on from the last frame.
   */
  preroll?: boolean;
  /** Sub-frames to average. 1 has no jitter at all, which is what the preview plays. @default 1 */
  samples?: number;
  /**
   * Raises `samples` for a lens wide enough to show its points as ghosts of what is out of focus,
   * as `getLensSamples` says. An export does. @default false
   */
  adaptive?: boolean;
  /**
   * Fraction of a frame the shutter is open at full speed. Slow motion closes it down by its time
   * rate, as `getFrameShutter` says: 0.5 is open 0.06 of a frame at a rate of 0.12. 0 stops motion
   * blur. @default 0.5
   */
  shutter?: number;
  /** Frames per second, which the shutter is a fraction of. @default 30 */
  fps?: number;
  /** Scales `camera.aperture`. 0 is a pinhole, with no depth of field. @default 1 */
  apertureScale?: number;
  /** Scales `key.softness`. 0 is a sharp sun, with a map's hard shadows. @default 1 */
  softnessScale?: number;
  /** Scales how far the pixel grid moves. 0 is no antialiasing. @default 1 */
  pixelScale?: number;
  /** Replaces parts of the frame's grade, for a comparison or a check. */
  grade?: Partial<StoryGrade>;
  /** Draws a single sample into the float target too, as many samples would, for a check. */
  useTarget?: boolean;
  /**
   * The side of the swap a second inside `LOOP.cover` is composed from, for this frame alone, as
   * `?world=` says for every frame. A change of it from the last frame is a jump. Outside the
   * cover the second decides.
   */
  world?: StoryWorld | null;
};

/** What `renderAt` resolves to. */
export type FrameInfo = {
  /** Cycle seconds. */
  t: number;
  /** Signed seconds from the swap, and the side of it the frame was composed from. */
  seam: number;
  world: StoryWorld;
  beat: string;
  year: number;
  width: number;
  height: number;
  /** Sub-frames added. */
  samples: number;
  /** Ids of the top-level layers drawn. */
  layers: string[];
  /** All problems so far, as `window.stageErrors`. */
  errors: string[];
};

/**
 * What the URL asks of the stage, and what a debug panel may change while the page is open. Every
 * frame reads it. Under `capture` nothing changes it, so a frame is what the URL says.
 */
export type StageOptions = {
  /** Layers drawn, by the names of `LAYERS`. */
  layers: Set<string>;
  /** Timeline and captions, while there is a finish. */
  overlay: boolean;
  /** Bloom, grade, fade and grain, by the accumulator. */
  finish: boolean;
  /** Device pixels per CSS pixel. A panel changing it also sets the deck's `useDevicePixels`. */
  devicePixels: number;
  /** `TreeLayer.lodBias`, or null for `STILL_LOD_BIAS` and `MOVING_LOD_BIAS`. */
  lodBias: number | null;
  /**
   * The side of the swap a second inside `LOOP.cover` is composed from, or null for the second's
   * own: `?world=`.
   */
  world: StoryWorld | null;
  /**
   * How playback runs: at a speed, from cycle second `from` forward to `to`, which may be past the
   * end of the cycle, looping or not.
   */
  playback: DebugPlayback;
  /**
   * Changes each frame's state after `getStoryState`, as overrides and a free camera do. `preroll`
   * says it is the frame drawn 1/60 s before a jump's, which a free camera leaves to the story's, so
   * that a frame made anew from the story's view is the same frame with either camera.
   */
  transformState: ((state: StoryState, preroll: boolean) => StoryState) | null;
  /** Hears of each frame shown, as readouts do. */
  onFrame: ((state: StoryState) => void) | null;
};

/**
 * How long before a jump's frame `renderAt` draws, so falling things have their rates: mod the
 * cycle, so the frame at 0 has its rates from 63.983.
 */
const PREROLL_SECONDS = 1 / 60;
/**
 * A frame this soon after the last, round the cycle, carries on from it: 0 after 63.9667 does.
 * Anything else is a jump, so the frame it draws does not depend on what was drawn before it.
 */
const MOST_FOLLOW_SECONDS = 0.05;
/**
 * Most story time a frame of playback covers. A slower machine sees the film slow down, as
 * `TreeLayer` loses its rates past a clock step of 0.25 s.
 */
const MOST_PLAY_SECONDS = 0.2;
/** What the arrow keys step by, and with Shift. */
const STEP_SECONDS = 1 / 30;
const LONG_STEP_SECONDS = 1;
/** How long to wait for a layer that is still loading something, in frames. */
const MOST_LOAD_FRAMES = 1800;
const MOST_ERRORS = 50;
/** What a segment's VP9 aims for, well above the H.264 it becomes, so it does not eat the grain. */
const DEFAULT_BITRATE = 40e6;
/**
 * `TreeLayer.lodBias` of a still, always explicit, so that a frame is a function of its view alone.
 * See `SCALE.md`. While the preview plays or the scrubber is dragged, speed matters more than the
 * last leaf.
 */
const STILL_LOD_BIAS = 0;
const MOVING_LOD_BIAS = 1;

const PLAIN_GROUND_EXTENT = 4000;
const PLAIN_GROUND_DATA = [{}];
const PLAIN_GROUND_MESH = {
  attributes: {
    POSITION: {
      size: 3,
      value: new Float32Array([
        -PLAIN_GROUND_EXTENT,
        -PLAIN_GROUND_EXTENT,
        0,
        PLAIN_GROUND_EXTENT,
        -PLAIN_GROUND_EXTENT,
        0,
        PLAIN_GROUND_EXTENT,
        PLAIN_GROUND_EXTENT,
        0,
        -PLAIN_GROUND_EXTENT,
        PLAIN_GROUND_EXTENT,
        0
      ])
    },
    NORMAL: {size: 3, value: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])},
    TEXCOORD_0: {size: 2, value: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])}
  },
  indices: {size: 1, value: new Uint16Array([0, 1, 2, 0, 2, 3])}
};

const query = new URLSearchParams(window.location.search);
const IS_CAPTURE = query.has('capture');
const IS_PICKABLE = query.has('pickable');
const HAS_MSAA = parseSwitch(query.get('msaa'), true);
/** Whether the page opened with a finish, which under capture decides if there is an accumulator. */
const HAS_FINISH = parseSwitch(query.get('finish'), true);
/**
 * Without `capture`, a jump makes `TreeLayer` anew before its preroll. Its levels of detail, and the
 * leaves and crops it lists near the camera, hold on through small changes of view and of its
 * props, so a layer that has drawn other frames, or other settings, can draw this one a little
 * differently. Made anew, it draws the frame a capture's first shot of this second draws, and a
 * change undone gives back the frame there was. A capture is left as it has always been.
 */
const RENEWS_TREES = !IS_CAPTURE;
/** The rows of `state.trees`, whose number and order never change, as `TreeLayer.data`. */
const TREE_ROWS = getStoryState(0).trees.map((_, row) => row);

/**
 * `LightingEffect` draws a shadow map for every directional light once one of them casts, and
 * deck's shadow module then averages shadows over all the maps. Lightning never casts, so it stays
 * out of the effect's own lights, which leaves one shadow pass and one map, and goes to the shaders
 * beside them while it is lit. Until then the shaders have one directional light to do the sums
 * for.
 */
class StageLightingEffect extends LightingEffect {
  private flash: DirectionalLight;

  constructor(ambient: AmbientLight, key: DirectionalLight, flash: DirectionalLight) {
    super({ambient, key});
    this.flash = flash;
  }

  getShaderModuleProps(...args: Parameters<LightingEffect['getShaderModuleProps']>) {
    const props = super.getShaderModuleProps(...args);
    if (this.flash.intensity > 0) props.lighting.lights?.push(this.flash);
    return props;
  }
}

const ambientLight = new AmbientLight();
const keyLight = new DirectionalLight({_shadow: true});
const flashLight = new DirectionalLight();
const lighting = new StageLightingEffect(ambientLight, keyLight, flashLight);

/** Everything wrong so far, without repeats: errors thrown, and those deck, luma and GL report. */
const errors: string[] = [];

function reportError(message: string): void {
  if (errors.length < MOST_ERRORS && !errors.includes(message)) {
    errors.push(message);
    updateProblems();
  }
}

window.addEventListener('error', event => {
  // Browsers report this when resizing outruns a frame. It is harmless, and not the film's.
  if (!event.message?.startsWith('ResizeObserver loop')) reportError(`Error: ${event.message}`);
});
window.addEventListener('unhandledrejection', event => {
  reportError(`Unhandled rejection: ${event.reason?.message ?? event.reason}`);
});

/**
 * Takes luma's errors, and adds to a failed link what the compiler said, against the lines it said
 * it of, as a device that is not in debug mode only says a shader did not compile.
 */
function reportDeviceError(error: Error, context: unknown): boolean {
  const {vs, fs} = (context ?? {}) as {vs?: Shader; fs?: Shader};
  const lines = [vs, fs].flatMap(shader =>
    (shader?.getCompilationInfoSync() ?? [])
      .filter(message => message.type === 'error')
      .map(({lineNum, message}) => {
        const source = shader?.source.split('\n')[lineNum - 1]?.trim();
        return `${shader?.stage} line ${lineNum}: ${message}\n  ${source}`;
      })
  );
  // Link logs end in a NUL, which tools take to mean binary.
  const message = error.message.replaceAll('\0', '').trim();
  reportError([`${context ?? 'Device'}: ${message}`, ...lines].join('\n'));
  return true;
}

function createTreeLayer(state: StoryState): Layer {
  return new TreeLayer<number>({
    id: 'trees',
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    coordinateOrigin: [0, 0, 0],
    data: TREE_ROWS,
    getTree: (row: number) => state.trees[row],
    updateTriggers: {getTree: frameCount},
    windStrength: state.wind.strength,
    windDirection: state.wind.bearing,
    // The scene clock, which slows around the swap, and the gust clock the storm locks its fronts to.
    windTime: state.wind.time,
    windGustTime: state.wind.gustTime,
    wetness: state.treeWetness,
    frost: state.treeFrost,
    fog: state.fog.density > 0 ? state.fog : null,
    lodBias: stageOptions.lodBias ?? (playing || dragging ? MOVING_LOD_BIAS : STILL_LOD_BIAS)
  });
}

/**
 * A plain sand plane, until `createGroundLayer` returns something, so shadows have somewhere to
 * land. Its far edge is the far plane, which a real ground must reach past.
 */
function createPlainGroundLayer(): Layer {
  return new SimpleMeshLayer({
    id: 'plain-ground',
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    coordinateOrigin: [0, 0, 0],
    data: PLAIN_GROUND_DATA,
    mesh: PLAIN_GROUND_MESH as never,
    getPosition: [0, 0, -0.002],
    getColor: [196, 176, 142, 255],
    material: {ambient: 0.32, diffuse: 0.34, shininess: 1, specularColor: [0, 0, 0]},
    shadowEnabled: false
  });
}

/**
 * The film's layers, in draw order, by the names `?only=` takes. `props` in `?only=` means the
 * orange, the seed and the pot. `plain` is the stand-in ground alone, and is off unless asked for.
 */
const LAYERS: readonly (readonly [name: string, createLayer: LayerFactory])[] = [
  ['sky', createSkyLayer],
  ['ground', state => createGroundLayer(state) ?? createPlainGroundLayer()],
  ['plain', createPlainGroundLayer],
  ['grass', createGrassLayer],
  ['trees', createTreeLayer],
  ['orange', createOrangeLayer],
  ['seed', createSeedLayer],
  ['pot', createPotLayer],
  ['net', createNetLayer],
  ['weather', createWeatherLayer]
];

const LAYER_NAMES = LAYERS.map(([name]) => name);
const LAYER_GROUPS: Record<string, string[]> = {props: ['orange', 'seed', 'pot']};
/** What is drawn when `?only=` is not given. */
const DEFAULT_LAYERS = LAYER_NAMES.filter(name => name !== 'plain');

function getShownLayers(): Set<string> {
  const only = query.get('only');
  if (only === null) return new Set(DEFAULT_LAYERS);
  const {layers, unknown} = parseOnlyLayers(only, LAYER_NAMES, LAYER_GROUPS);
  for (const name of unknown) reportError(`Unknown layer in only=: ${name}`);
  return new Set(layers);
}

const stageOptions: StageOptions = {
  layers: getShownLayers(),
  overlay: parseSwitch(query.get('overlay'), !query.has('only')),
  finish: HAS_FINISH,
  devicePixels: parseDevicePixels(query.get('dpr')),
  lodBias: parseLodBias(query.get('lodBias')),
  world: parseWorld(query.get('world')),
  // Round the cycle, without end.
  playback: {speed: 1, loop: true, from: 0, to: CYCLE_SECONDS},
  transformState: null,
  onFrame: null
};

function isOverlayShown(): boolean {
  return stageOptions.finish && stageOptions.overlay;
}

function createStageLayers(state: StoryState): Layer[] {
  const layers: Layer[] = [];
  for (const [name, createLayer] of LAYERS) {
    if (stageOptions.layers.has(name)) {
      try {
        const created = createLayer(state);
        if (created) layers.push(...(Array.isArray(created) ? created : [created]));
      } catch (error) {
        // One layer's bug should not stop its author seeing what the others do.
        reportError(`${name} layer: ${(error as Error).message}`);
      }
    }
  }
  return IS_PICKABLE ? layers.map(layer => layer.clone({pickable: true})) : layers;
}

function setDirectionalLight(light: DirectionalLight, from: StoryDirectionalLight): void {
  light.direction = from.direction;
  light.color = from.color;
  light.intensity = from.intensity;
}

function setLights(state: StoryState): void {
  ambientLight.color = state.ambient.color;
  ambientLight.intensity = state.ambient.intensity;
  setDirectionalLight(keyLight, state.key);
  setDirectionalLight(flashLight, state.flash);
  lighting.shadowColor = state.shadowColor;
}

/** What shows where no layer draws, 0-1: the color of the horizon, until there is a sky. */
let plainSky: number[] = [0, 0, 0, 1];
/** What a check clears to instead, as `checkCover` does, or null. */
let clearOverride: number[] | null = null;
let stageGl: WebGL2RenderingContext | null = null;
let frameCount = 0;
/** The cycle second last drawn, sub-frame or not, and the side of the swap it was asked for. */
let lastSeconds = Number.NaN;
let lastWorld: StoryWorld | null = stageOptions.world;
/** The frame on screen: its cycle second, and its state. */
let shownSeconds = Number.NaN;
let lastState: StoryState | null = null;
/** Where deck draws: a float target while accumulating, else the canvas. */
let drawTarget: Framebuffer | null = null;
let accumulator: Accumulator | null = null;

let onDeckLoaded: () => void;
const deckLoaded = new Promise<void>(resolve => {
  onDeckLoaded = resolve;
});

const frame = document.getElementById('frame') as HTMLDivElement;
if (IS_CAPTURE) document.documentElement.classList.add('capture');

const deck = new Deck({
  parent: frame,
  width: '100%',
  height: '100%',
  useDevicePixels: stageOptions.devicePixels,
  deviceProps: {
    type: 'webgl',
    adapters: [webgl2Adapter],
    onError: reportDeviceError,
    webgl: {antialias: HAS_MSAA}
  },
  views: new OrbitView({id: 'film', orbitAxis: 'Z'}),
  viewState: {target: [0, 0, 0], rotationOrbit: 0, rotationX: 0, zoom: 0},
  effects: [lighting],
  layers: [],
  controller: false,
  getCursor: () => 'default',
  // Not a view's `clearColor`, which is what the shadow pass would clear its map to as well.
  _customRender: reason =>
    deck._drawLayers(reason, {clearColor: plainSky, target: drawTarget ?? undefined} as never),
  onLoad: () => {
    // From here on the stage draws every frame itself. See `drawAt`.
    deck['animationLoop']?.stop();
    onDeckLoaded();
  },
  onResize: () => requestDraw(),
  onError: (error, layer) => reportError(`${layer ? `${layer.id}: ` : ''}${error.message}`),
  onAfterRender: ({gl}) => {
    stageGl = gl;
  }
});

/**
 * The state of cycle second `seconds`, composed from `world` inside `LOOP.cover`, or from its own
 * side of the swap for null.
 */
function getStateAt(
  seconds: number,
  preroll = false,
  world: StoryWorld | null = stageOptions.world
): StoryState {
  const state = getStoryState(seconds, {
    aspect: Math.max(deck.width, 1) / Math.max(deck.height, 1),
    ...(world ? {world} : {})
  });
  return stageOptions.transformState ? stageOptions.transformState(state, preroll) : state;
}

/** A sub-frame's jitter, and what scales it. */
type SubFrameDraw = {
  subFrame: SubFrame;
  apertureScale: number;
  softnessScale: number;
  pixelScale: number;
};

const NO_JITTER: SubFrameDraw = {
  subFrame: PINHOLE_SUB_FRAME,
  apertureScale: 1,
  softnessScale: 1,
  pixelScale: 1
};

/**
 * Sets everything for cycle second `seconds` and draws it, before this returns, as Deck's own frame
 * would with `deck.setProps` and an animation frame's wait. The canvas or the float target then
 * holds the frame, until the next one. `draw` moves the lens, pixel grid and sun for a sub-frame,
 * `preroll` says it is the frame before a jump's, and `world` is as `getStateAt` takes it.
 */
function drawAt(
  seconds: number,
  draw: SubFrameDraw = NO_JITTER,
  preroll = false,
  world: StoryWorld | null = stageOptions.world
): StoryState {
  frameCount++;
  const state = getStateAt(getCycleSeconds(seconds), preroll, world);
  const {subFrame, apertureScale, softnessScale, pixelScale} = draw;
  // A hand shakes the camera around its target, and the lens then moves around where it is focused.
  const shaken = {
    ...state.camera,
    orbit: state.camera.orbit + state.shake[0],
    pitch: state.camera.pitch + state.shake[1]
  };
  const camera =
    subFrame === PINHOLE_SUB_FRAME ? shaken : getFocusedCamera(shaken, getFocusPull(state));
  const lens = getLensAngles(camera, subFrame.lens, apertureScale);
  const {view, viewState} = getOrbitViewProps(camera, Math.max(deck.height, 1), lens);
  const padding = getPixelPadding(
    [subFrame.pixel[0] * pixelScale, subFrame.pixel[1] * pixelScale],
    stageOptions.devicePixels
  );
  state.key = {
    ...state.key,
    direction: getJitteredDirection(
      state.key.direction,
      subFrame.sun,
      state.key.softness * softnessScale
    )
  };
  const [red, green, blue] = state.fog.color;
  plainSky = clearOverride ?? [red / 255, green / 255, blue / 255, 1];
  setLights(state);
  // A panel may turn the overlay off, and then its canvas must not show the last one drawn.
  overlayCanvas.hidden = !isOverlayShown();
  deck.setProps({
    views: new OrbitView({id: 'film', ...view, padding}),
    viewState,
    layers: createStageLayers(state)
  });
  deck['layerManager']?.updateLayers();
  deck.redraw('stage');
  lastSeconds = state.t;
  lastWorld = world;
  lastState = state;
  return state;
}

/** Has deck finalize `TreeLayer`, so that the next frame's is made anew. See `RENEWS_TREES`. */
function forgetTreeLayer(): void {
  const layers = deck.props.layers as Layer[];
  if (layers.some(layer => layer.id === 'trees')) {
    deck.setProps({layers: layers.filter(layer => layer.id !== 'trees')});
    deck['layerManager']?.updateLayers();
  }
}

/**
 * Draws a frame, with the one before it if asked or if it is a jump. `renew` makes it a jump,
 * whatever it follows on from, as a change of settings does, and so does a change of the world it
 * is asked for. Time runs round the cycle: a frame at 0 after one at 63.9667 follows on, and the
 * one before a jump to 0 is at 63.983.
 */
function drawFrame(
  seconds: number,
  preroll?: boolean,
  draw: SubFrameDraw = NO_JITTER,
  renew = false,
  world: StoryWorld | null = stageOptions.world
): StoryState {
  const elapsed = getSeamSeconds(seconds - lastSeconds);
  const follows = elapsed >= 0 && elapsed <= MOST_FOLLOW_SECONDS;
  const jumps = renew || world !== lastWorld || (preroll ?? !follows);
  if (jumps && RENEWS_TREES) forgetTreeLayer();
  if (jumps) drawAt(getCycleSeconds(seconds - PREROLL_SECONDS), draw, true, world);
  return drawAt(seconds, draw, false, world);
}

/** The size of a frame in device pixels, with any pending resize of the drawing buffer done. */
function getFrameSize(): [width: number, height: number] {
  const context = deck['device']?.getDefaultCanvasContext();
  context?.getCurrentFramebuffer();
  return context?.getDrawingBufferSize() ?? [0, 0];
}

// The overlay sits on the canvas in the page. `getComposite` flattens both for a capture or an
// encoder.

const overlayCanvas = document.createElement('canvas');
overlayCanvas.style.cssText =
  'position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none;';
const overlayContext = overlayCanvas.getContext('2d') as CanvasRenderingContext2D;
const measureOverlayText = createCanvasMeasure(overlayContext);
let overlayMetrics: OverlayMetrics | null = null;
// Under capture, only a frame with an overlay has its canvas. Otherwise a panel may turn one on.
if (!IS_CAPTURE || isOverlayShown()) frame.append(overlayCanvas);

const compositeCanvas = document.createElement('canvas');
const compositeContext = compositeCanvas.getContext('2d', {
  alpha: false
}) as CanvasRenderingContext2D;

function getOverlayMetricsFor(width: number, height: number): OverlayMetrics {
  if (overlayMetrics?.width !== width || overlayMetrics?.height !== height) {
    overlayMetrics = getOverlayMetrics(width, height);
    overlayCanvas.width = width;
    overlayCanvas.height = height;
  }
  return overlayMetrics;
}

function drawOverlay(state: StoryState, width: number, height: number): void {
  if (isOverlayShown()) {
    const metrics = getOverlayMetricsFor(width, height);
    const layout = layOutTimelineOverlay(
      state.timeline,
      state.caption,
      metrics,
      measureOverlayText
    );
    drawTimelineOverlay(overlayContext, layout);
  }
}

/** The finished frame and its overlay, flat. */
function getComposite(): HTMLCanvasElement {
  const canvas = deck.getCanvas() as HTMLCanvasElement;
  if (compositeCanvas.width !== canvas.width || compositeCanvas.height !== canvas.height) {
    compositeCanvas.width = canvas.width;
    compositeCanvas.height = canvas.height;
  }
  compositeContext.drawImage(canvas, 0, 0);
  if (isOverlayShown()) compositeContext.drawImage(overlayCanvas, 0, 0);
  return compositeCanvas;
}

/**
 * Grades what the accumulator holds into the canvas, and paints the overlay, for the frame at
 * `seconds`, whatever sub-frames it took to get here. Grain changes with the frame and never with
 * the clock's sub-frames. Nothing else may run on `state.trees` until the next `drawAt`.
 */
function endFrame(
  seconds: number,
  width: number,
  height: number,
  grade?: Partial<StoryGrade>,
  world: StoryWorld | null = stageOptions.world
) {
  const state =
    lastState?.t === seconds && lastWorld === world ? lastState : getStateAt(seconds, false, world);
  accumulator?.finish({
    grade: grade ? {...state.grade, ...grade} : state.grade,
    seed: Math.round(seconds * 1000)
  });
  drawOverlay(state, width, height);
  shownSeconds = seconds;
  lastState = state;
  return state;
}

/** One unjittered frame through the canvas and finished: what the preview plays. */
function showFrame(seconds: number, preroll?: boolean, renew = false): StoryState {
  const state = drawFrame(seconds, preroll, NO_JITTER, renew);
  if (!stageOptions.finish || !accumulator) {
    shownSeconds = seconds;
    return state;
  }
  const [width, height] = getFrameSize();
  accumulator.begin(width, height);
  accumulator.addCanvas();
  return endFrame(seconds, width, height);
}

function isEveryLayerLoaded(): boolean {
  return (deck.props.layers as Layer[]).every(layer => layer.isLoaded);
}

function reportGlErrors(): void {
  const gl = stageGl;
  if (!gl) return;
  if (gl.isContextLost()) {
    reportError(`WebGL context lost by t=${lastSeconds}`);
    return;
  }
  for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) {
    reportError(`GL error 0x${error.toString(16)} at t=${lastSeconds}`);
  }
}

let renderQueue: Promise<unknown> = Promise.resolve();
const ONE_PIXEL = new Uint8Array(4);

/** Draws one sub-frame again and again until everything it needs has loaded. */
async function waitForLayers(
  seconds: number,
  draw: SubFrameDraw,
  world: StoryWorld | null = stageOptions.world
): Promise<void> {
  for (let waited = 0; !isEveryLayerLoaded(); waited++) {
    if (waited >= MOST_LOAD_FRAMES) {
      reportError(`Layers still loading at t=${seconds}`);
      return;
    }
    await new Promise(requestAnimationFrame);
    drawAt(seconds, draw, false, world);
  }
}

/** The world a render asks for: its own, or the stage's. */
function getRenderWorld(options: RenderOptions): StoryWorld | null {
  return options.world === undefined ? stageOptions.world : options.world;
}

/**
 * Sub-frames of a frame, at least `samples` of them, and with `adaptive` more for a lens wide
 * enough to show its points as ghosts, as `getLensSamples` says.
 */
function getFrameSubFrames(seconds: number, options: RenderOptions): readonly SubFrame[] {
  const asked = Math.max(1, Math.floor(options.samples ?? 1));
  if (!options.adaptive) return getSubFrames(asked);
  const state = getStateAt(seconds, false, getRenderWorld(options));
  const camera = getFocusedCamera(state.camera, getFocusPull(state));
  const radius = getFarBlurRadius(camera, getFrameSize()[1], options.apertureScale ?? 1);
  return getSubFrames(getLensSamples(asked, radius));
}

/**
 * The cycle second of a sub-frame of the frame at `seconds`: across the shutter, which slow motion
 * closes down by its time rate (`getFrameShutter`), and mod the cycle.
 */
function getSubFrameTime(seconds: number, subFrame: SubFrame, options: RenderOptions): number {
  const {shutter = DEFAULT_SHUTTER, fps = DEFAULT_FPS} = options;
  const open = getFrameShutter(seconds, shutter);
  return getCycleSeconds(getSubFrameSeconds(seconds, subFrame, open, fps));
}

/** Sub-frames in order of time, each added to the accumulator, and the frame finished. */
async function accumulateFrame(
  seconds: number,
  options: RenderOptions,
  renew: boolean
): Promise<StoryState> {
  const {preroll, apertureScale = 1, softnessScale = 1, pixelScale = 1} = options;
  const world = getRenderWorld(options);
  const subFrames = getFrameSubFrames(seconds, options);
  const samples = subFrames.length;
  const useTarget = samples > 1 || Boolean(options.useTarget);
  const active = accumulator as Accumulator;
  const [width, height] = getFrameSize();
  active.begin(width, height);
  drawTarget = useTarget ? active.getTarget() : null;
  const add = () => (useTarget ? active.addTarget() : active.addCanvas());
  const getDraw = (subFrame: SubFrame): SubFrameDraw => ({
    subFrame,
    apertureScale,
    softnessScale,
    pixelScale
  });
  try {
    // Sub-frame times are mod the cycle too: the frame at 0 opens its shutter at 63.999.
    const firstSeconds = getSubFrameTime(seconds, subFrames[0], options);
    drawFrame(firstSeconds, preroll, getDraw(subFrames[0]), renew, world);
    await waitForLayers(firstSeconds, getDraw(subFrames[0]), world);
    add();
    for (let index = 1; index < samples; index++) {
      drawAt(
        getSubFrameTime(seconds, subFrames[index], options),
        getDraw(subFrames[index]),
        false,
        world
      );
      add();
      // Hands the GPU each sub-frame as it comes, rather than a frame's worth at the end.
      stageGl?.flush();
    }
  } finally {
    drawTarget = null;
  }
  return endFrame(seconds, width, height, options.grade, world);
}

/**
 * Blocks until the GPU has finished all that was asked of it. `gl.finish` does not, under ANGLE on
 * Metal: a frame of the storm is still being drawn seconds after it returns. A readback does, and
 * without one a canvas drawn into a 2D canvas may come out as the frame before this one, grain and
 * all.
 */
function waitForGpu(): void {
  stageGl?.readPixels(0, 0, 1, 1, stageGl.RGBA, stageGl.UNSIGNED_BYTE, ONE_PIXEL);
}

async function renderFrame(t: number, options: RenderOptions): Promise<FrameInfo> {
  const seconds = getCycleSeconds(t);
  const world = getRenderWorld(options);
  // This frame stands for one owed, which a change of settings may have asked to be made anew.
  const renew = Boolean(wanted?.renew);
  wanted = null;
  let state: StoryState;
  if (stageOptions.finish && accumulator) {
    state = await accumulateFrame(seconds, options, renew);
  } else {
    state = drawFrame(seconds, options.preroll, NO_JITTER, renew, world);
    await waitForLayers(seconds, NO_JITTER, world);
    shownSeconds = seconds;
  }
  waitForGpu();
  reportGlErrors();
  updateControls();
  return {
    t: state.t,
    seam: state.cycle.seam,
    world: state.cycle.world,
    beat: state.beat,
    year: state.year,
    width: stageGl?.drawingBufferWidth ?? 0,
    height: stageGl?.drawingBufferHeight ?? 0,
    samples: accumulator?.getInfo().added ?? 1,
    layers: (deck.props.layers as Layer[]).map(layer => layer.id),
    errors
  };
}

/**
 * Draws second `t`, mod the cycle, and resolves once the GPU has finished the frame, whatever came
 * before it, with `t - 1/60` drawn first when it is a jump. Pauses playback. Calls run one at a
 * time.
 */
function renderAt(t: number, options: RenderOptions = {}): Promise<FrameInfo> {
  setPlaying(false);
  const pending = renderQueue.then(() => motionReady).then(() => renderFrame(t, options));
  renderQueue = pending.catch(() => undefined);
  return pending;
}

/** What is on screen, overlay and all, as a PNG data URL. */
function captureStage(): string {
  return getComposite().toDataURL('image/png');
}

/** What is on screen, overlay and all, as pixels. */
function captureFrame(): ImageData {
  const canvas = getComposite();
  return compositeContext.getImageData(0, 0, canvas.width, canvas.height);
}

/** Frames kept by `keepStage`, by name, for `compareStage`. */
const keptFrames = new Map<string, ImageData>();

/** Keeps what is on screen under `name`, for a comparison, and says how big it is. */
function keepStage(name: string): {width: number; height: number} {
  const frame = captureFrame();
  keptFrames.set(name, frame);
  return {width: frame.width, height: frame.height};
}

/**
 * How two kept frames differ, over all their rows or over rows `top` up to `bottom`. A tool keeps
 * two worlds' frames of one second, as the seam check does, without moving them out of the page.
 */
function compareStage(
  a: string,
  b: string,
  rows?: readonly [top: number, bottom: number]
): FrameDifference {
  const first = keptFrames.get(a);
  const second = keptFrames.get(b);
  if (!first || !second) throw new Error(`No frame kept as ${first ? b : a}`);
  return getFrameDifference(first.data, second.data, first.width, first.height, rows);
}

/** Forgets every frame kept by `keepStage`. */
function forgetKeptFrames(): void {
  keptFrames.clear();
}

/** What `checkCover` finds at a second. */
export type CoverCheck = {
  t: number;
  seam: number;
  world: StoryWorld;
  /** Pixels in a frame, and for each sub-frame, in order, how many showed the clear colour. */
  pixels: number;
  uncovered: number[];
};

/**
 * For the check of the hidden swap: draws each sub-frame of second `t` on its own, at the time,
 * lens position, pixel offset and sun of the sub-frame an export draws, over `SEAM_CHECK.clear`,
 * which no layer draws, and counts the pixels of each that still show it. Opened with
 * `only=orange&finish=0&msaa=0`, a pixel is the orange's or the clear colour, never a blend, so
 * a count of 0 is a frame that is all rind.
 */
async function checkCover(t: number, options: RenderOptions = {}): Promise<CoverCheck> {
  setPlaying(false);
  const run = async (): Promise<CoverCheck> => {
    const seconds = getCycleSeconds(t);
    const world = getRenderWorld(options);
    const {apertureScale = 1, softnessScale = 1, pixelScale = 1} = options;
    const subFrames = getFrameSubFrames(seconds, options);
    const device = deck['device'] as WebGLDevice;
    const {gl} = device;
    const [red, green, blue] = SEAM_CHECK.clear;
    const uncovered: number[] = [];
    let pixels = 0;
    wanted = null;
    clearOverride = [red / 255, green / 255, blue / 255, 1];
    try {
      for (const [index, subFrame] of subFrames.entries()) {
        const time = getSubFrameTime(seconds, subFrame, options);
        const draw = {subFrame, apertureScale, softnessScale, pixelScale};
        if (index === 0) drawFrame(time, options.preroll, draw, false, world);
        else drawAt(time, draw, false, world);
        await waitForLayers(time, draw, world);
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const data = new Uint8Array(width * height * 4);
        // The drawing buffer, with luma's own state given back as the accumulator does.
        device.pushState();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        device.popState();
        let count = 0;
        for (let offset = 0; offset < data.length; offset += 4) {
          if (data[offset] === red && data[offset + 1] === green && data[offset + 2] === blue) {
            count++;
          }
        }
        pixels = width * height;
        uncovered.push(count);
      }
    } finally {
      clearOverride = null;
    }
    reportGlErrors();
    shownSeconds = seconds;
    // The frame's own second, whose sub-frames may lie either side of the swap.
    const side = world && isInSeamWindow(seconds, LOOP.cover) ? world : getWorld(seconds);
    return {t: seconds, seam: getSeamSeconds(seconds), world: side, pixels, uncovered};
  };
  const pending = renderQueue.then(() => motionReady).then(run);
  renderQueue = pending.catch(() => undefined);
  return pending;
}

/** What `encodeSegment` takes, besides how each frame is to be rendered. */
export type EncodeRequest = RenderOptions & {
  /** The film's frame number of the first frame, and how many. */
  firstFrame: number;
  frames: number;
  /**
   * Frames per second, and the second of frame 0. Frame times run on past the end of the cycle and
   * are taken mod it, in whole frames: one cycle from `LOOP.fileStart` is 61.3 to 125.3.
   */
  fps: number;
  from: number;
  /** Bits per second, or for constant quality the quantizer, 0-63. */
  bitrate?: number;
  quantizer?: number;
};

/** One encoded frame, by film frame number, as base64 so it crosses to a tool whole. */
export type EncodedChunk = {frame: number; base64: string};

function getBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** How many frames the encoder may hold before rendering waits for it. */
const MOST_ENCODE_QUEUE = 3;

/**
 * Renders frames in order and encodes them to VP9 as one segment that starts on a key frame, so a
 * tool can keep whole segments and start again from any of them. `onExportFrame` on the window
 * hears of each frame.
 */
async function encodeSegment(request: EncodeRequest): Promise<{
  width: number;
  height: number;
  chunks: EncodedChunk[];
  errors: string[];
}> {
  const {firstFrame, frames, fps, from, bitrate, quantizer, ...renderOptions} = request;
  const chunks: EncodedChunk[] = [];
  let failure: Error | null = null;
  const microsecondsPerFrame = 1e6 / fps;
  const encoder = new VideoEncoder({
    output: chunk => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      const frame = Math.round(chunk.timestamp / microsecondsPerFrame);
      chunks.push({frame, base64: getBase64(bytes)});
    },
    error: error => {
      failure = error;
    }
  });
  let width = 0;
  let height = 0;
  try {
    for (let index = 0; index < frames; index++) {
      const frame = firstFrame + index;
      const began = performance.now();
      await renderAt(getFrameSeconds(from, frame, fps), {...renderOptions, fps});
      const rendered = performance.now();
      const canvas = getComposite();
      if (failure) throw failure;
      if (index === 0) {
        width = canvas.width;
        height = canvas.height;
        encoder.configure({
          codec: 'vp09.00.10.08',
          width,
          height,
          framerate: fps,
          latencyMode: 'quality',
          ...(quantizer === undefined
            ? {bitrate: bitrate ?? DEFAULT_BITRATE}
            : {bitrateMode: 'quantizer' as VideoEncoderBitrateMode})
        });
      }
      const image = new VideoFrame(canvas, {
        timestamp: Math.round(frame * microsecondsPerFrame),
        duration: Math.round(microsecondsPerFrame)
      });
      encoder.encode(image, {
        keyFrame: index === 0,
        ...(quantizer === undefined ? {} : {vp9: {quantizer}})
      } as VideoEncoderEncodeOptions);
      image.close();
      while (encoder.encodeQueueSize > MOST_ENCODE_QUEUE) {
        await new Promise(resolve => setTimeout(resolve, 2));
      }
      window.onExportFrame?.({
        frame,
        renderMs: rendered - began,
        totalMs: performance.now() - began
      });
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    encoder.close();
  }
  chunks.sort((a, b) => a.frame - b.frame);
  return {width, height, chunks, errors};
}

/** Runs the picking pass at a point in CSS pixels, and says what it hit, for `?pickable=1`. */
function pickStage(x: number, y: number): string | null {
  return deck.pickObject({x, y, radius: 1})?.layer?.id ?? null;
}

/**
 * Real frame time: plays `frames` frames of story at 1/30 s from where it stands, waiting for the
 * GPU after each, so it says what a frame costs on its own, in milliseconds. `scriptMean` is the
 * part before the GPU was waited for: story, layer updates and draw calls.
 */
async function measureStage(frames = 60): Promise<{
  frames: number;
  mean: number;
  median: number;
  worst: number;
  scriptMean: number;
}> {
  const gl = stageGl as WebGL2RenderingContext;
  const pixel = new Uint8Array(4);
  const start = Number.isNaN(shownSeconds) ? 0 : shownSeconds;
  const totals: number[] = [];
  let scripts = 0;
  for (let index = 1; index <= frames; index++) {
    const began = performance.now();
    showFrame(getCycleSeconds(start + index * STEP_SECONDS), false);
    scripts += performance.now() - began;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    totals.push(performance.now() - began);
  }
  totals.sort((a, b) => a - b);
  return {
    frames,
    mean: totals.reduce((sum, time) => sum + time, 0) / frames,
    median: totals[frames >> 1],
    worst: totals[frames - 1],
    scriptMean: scripts / frames
  };
}

/** What a tool may want to know about the stage. */
function getStageInfo() {
  const gl = stageGl as WebGL2RenderingContext;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    antialias: gl.getContextAttributes()?.antialias,
    samples: gl.getParameter(gl.SAMPLES),
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    t: shownSeconds,
    cycle: lastState?.cycle,
    beat: lastState?.beat,
    camera: lastState?.camera,
    frames: frameCount,
    accumulator: accumulator?.getInfo(),
    layers: (deck.props.layers as Layer[]).map(layer => layer.id),
    /** The loop, for a tool that wraps times as the stage does. */
    loop: {cycleSeconds: CYCLE_SECONDS, ...LOOP},
    errors
  };
}

/**
 * The overlay's layout at second `t`, mod the cycle, as text is measured here, and what is wrong
 * with it.
 */
function checkOverlay(t: number): {flagOverlaps: string[]; poleCrossings: string[]; flags: number} {
  const [width, height] = getFrameSize();
  const state = getStateAt(getCycleSeconds(t));
  const layout = layOutTimelineOverlay(
    state.timeline,
    state.caption,
    getOverlayMetricsFor(width, height),
    measureOverlayText as MeasureText
  );
  return {
    flagOverlaps: findFlagOverlaps(layout),
    poleCrossings: findPoleCrossings(layout),
    flags: layout.flags.filter(flag => flag.textAlpha > 0).length
  };
}

// The preview: playback. None of it under capture. The debug panel adds the keys and the rest.

let playing = false;
let dragging = false;
/**
 * A frame the next animation frame owes the screen. `preroll` and `renew` are as `drawFrame` takes
 * them.
 */
let wanted: {seconds: number; preroll?: boolean; renew?: boolean} | null = null;
let lastTick = Number.NaN;
let urlTimer = 0;

function getElement<ElementT extends HTMLElement>(id: string): ElementT {
  return document.getElementById(id) as ElementT;
}

function updateProblems(): void {
  if (!IS_CAPTURE) getElement('problems').textContent = errors.join('\n');
}

let frameAspect = parseAspect(query.get('aspect'));

/** Sizes the frame to `frameAspect` inside the stage's area, as that area is now. */
function layOutFrame(): void {
  if (frameAspect) {
    const area = getElement('stage').getBoundingClientRect();
    const height = Math.floor(Math.min(area.height, area.width / frameAspect));
    frame.style.height = `${height}px`;
    frame.style.width = `${Math.floor(height * frameAspect)}px`;
  } else {
    frame.style.width = '100%';
    frame.style.height = '100%';
  }
}

/** A frame of this shape, as `?aspect=` takes it, or of the window's for null. */
function setAspect(text: string | null): void {
  frameAspect = parseAspect(text);
  layOutFrame();
}

function saveToUrl(): void {
  window.clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    // To the frame, so a reload or a link shows this frame and not one beside it.
    if (Number.isFinite(shownSeconds)) query.set('t', formatStageSeconds(shownSeconds));
    const search = query.toString().replaceAll('%3A', ':').replaceAll('%2C', ',');
    window.history.replaceState(null, '', `?${search}`);
  }, 300);
}

function updateControls(): void {
  if (IS_CAPTURE || !lastState) return;
  stageOptions.onFrame?.(lastState);
}

function setPlaying(next: boolean): void {
  if (next === playing) return;
  playing = next;
  lastTick = Number.NaN;
  const {playback} = stageOptions;
  // From the start of the window when the playhead is outside it, or at its end.
  const place = getPlaybackPlace(shownSeconds, playback);
  if (next && !(place < playback.to)) wanted = {seconds: getCycleSeconds(playback.from)};
  if (!next) {
    requestDraw();
    saveToUrl();
  }
  updateControls();
}

/**
 * Asks for what is on screen to be drawn again, at its size now, made anew as a jump is, which a
 * change of settings or of size needs. A frame owed already, as after a seek, is made anew too.
 * `moving` draws it as it stands, quickly, for a camera on the move. Playback will draw soon enough.
 */
function requestDraw(moving = false): void {
  if (IS_CAPTURE || playing || !Number.isFinite(shownSeconds)) return;
  if (moving) wanted ??= {seconds: shownSeconds, preroll: false};
  else wanted = {...(wanted ?? {seconds: shownSeconds}), renew: true};
}

/** Seeks to a second, mod the cycle. */
function seekTo(seconds: number, preroll?: boolean): void {
  setPlaying(false);
  wanted = {seconds: getCycleSeconds(seconds), preroll, renew: wanted?.renew};
  saveToUrl();
}

/** Seeks as a scrubber does: frames without their rates while it moves, then one with them. */
function scrubTo(seconds: number, done: boolean): void {
  dragging = !done;
  seekTo(seconds, done);
}

/** Steps a frame, or with `long` a second, forward or back, round the cycle. */
function stepTime(direction: number, long: boolean): void {
  seekTo(shownSeconds + direction * (long ? LONG_STEP_SECONDS : STEP_SECONDS));
}

/** To the start of the next beat, or of this one or the one before, round the cycle. */
function stepBeat(direction: number): void {
  const starts = BEAT_TABLE.map(beat => beat.start);
  const next =
    direction > 0
      ? (starts.find(start => start > shownSeconds + 1e-3) ?? starts[0])
      : (starts.filter(start => start < shownSeconds - 1e-3).at(-1) ?? starts.at(-1));
  seekTo(next ?? 0);
}

/**
 * The next frame of playback: on through the window, and at its end back to its start, or, for a
 * window of the whole cycle, on round it, or a stop when it does not loop.
 */
function playOn(elapsed: number): void {
  const {playback} = stageOptions;
  const {speed, loop, from, to} = playback;
  const next =
    getPlaybackPlace(shownSeconds, playback) + Math.min(elapsed * speed, MOST_PLAY_SECONDS);
  if (next < to) {
    showFrame(getCycleSeconds(next), false);
  } else if (!loop) {
    showFrame(getCycleSeconds(to), false);
    setPlaying(false);
  } else if (to - from >= CYCLE_SECONDS) {
    // The cycle has no end: its last frame runs on into its first.
    showFrame(getCycleSeconds(next), false);
  } else {
    // Back to A, a jump, so it prerolls.
    showFrame(getCycleSeconds(from));
  }
}

function onAnimationFrame(now: number): void {
  requestAnimationFrame(onAnimationFrame);
  const elapsed = (now - lastTick) / 1000;
  lastTick = now;
  if (wanted) {
    const {seconds, preroll, renew} = wanted;
    wanted = null;
    showFrame(seconds, preroll, renew);
    updateControls();
  } else if (playing) {
    if (Number.isFinite(elapsed)) {
      playOn(elapsed);
      updateControls();
    }
  } else if (!isEveryLayerLoaded()) {
    showFrame(shownSeconds, false);
  }
}

/** What `startDebugPanel` reaches the stage by. */
export type StageHost = {
  deck: typeof deck;
  options: StageOptions;
  /** The page's query, which the stage writes `t` into. Call `saveToUrl` after changing it. */
  query: URLSearchParams;
  /** The element the frame is drawn in. */
  frame: HTMLDivElement;
  context: DebugContext;
  getTime(): number;
  /** The state of the frame on screen, after `transformState`. */
  getState(): StoryState | null;
  isPlaying(): boolean;
  setPlaying(playing: boolean): void;
  seekTo(seconds: number, preroll?: boolean): void;
  scrubTo(seconds: number, done: boolean): void;
  stepTime(direction: number, long: boolean): void;
  stepBeat(direction: number): void;
  requestDraw(moving?: boolean): void;
  setAspect(aspect: string | null): void;
  saveToUrl(): void;
  renderAt: typeof renderAt;
  /** What is on screen, overlay and all, as pixels, after a `renderAt`. */
  captureFrame: typeof captureFrame;
  measureStage: typeof measureStage;
};

const host: StageHost = {
  deck,
  options: stageOptions,
  query,
  frame,
  context: {
    layerNames: LAYER_NAMES,
    defaultLayers: DEFAULT_LAYERS,
    layerGroups: LAYER_GROUPS,
    beats: BEAT_TABLE,
    cycleSeconds: CYCLE_SECONDS,
    fileStart: LOOP.fileStart
  },
  getTime: () => shownSeconds,
  getState: () => lastState,
  isPlaying: () => playing,
  setPlaying,
  seekTo,
  scrubTo,
  stepTime,
  stepBeat,
  requestDraw,
  setAspect,
  saveToUrl,
  renderAt,
  captureFrame,
  measureStage
};

function startControls(): void {
  requestAnimationFrame(onAnimationFrame);
  // Loaded only now, so a capture never has it.
  import('./debug-panel')
    .then(({startDebugPanel}) => startDebugPanel(host))
    .catch(error => reportError(`Debug panel: ${(error as Error).stack ?? error}`));
}

// The stage's area changes with the window, and with the debug panel's bar under it as it fills.
new ResizeObserver(layOutFrame).observe(getElement('stage'));
layOutFrame();

/** Resolves when the first frame has been drawn, and the stage can be asked for any other. */
const motionReady = (async () => {
  await deckLoaded;
  await deck.getCanvasContext()?.initialized;
  // Without capture, a panel may turn the finish on later.
  if (HAS_FINISH || !IS_CAPTURE) accumulator = new Accumulator(deck['device'] as WebGLDevice);
  // A capture's first frame is never what a tool takes, so it draws nothing before it: a tool's
  // first `renderAt` is a jump, with its own frame before it, as it has always been.
  await renderFrame(parseStageSeconds(query.get('t')), IS_CAPTURE ? {preroll: false} : {});
  if (!IS_CAPTURE) startControls();
  updateControls();
})();

Object.assign(window, {
  deck,
  motionReady,
  renderAt,
  captureStage,
  keepStage,
  compareStage,
  forgetKeptFrames,
  checkCover,
  pickStage,
  measureStage,
  getStageInfo,
  checkOverlay,
  encodeSegment,
  drawStageAt: drawAt,
  stageErrors: errors
});
