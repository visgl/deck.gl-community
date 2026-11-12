// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/// <reference types="vite/client" />

/**
 * Debug tools for the stage, built from what deck.gl and this repository already have:
 *
 *   TimelineWidget (deck.gl)     Play, pause and scrub, with the beats marked under it.
 *   ToolbarWidget                Steps, beats, speed, loop and A-B, a still, a measurement, a readout.
 *   Studio settings widget       Time, Layers, Overrides, Trees, Render and Camera, as a schema.
 *   StatsWidget (deck.gl)        Frame rate and time, layers and GPU memory.
 *   BoxPanelWidget, MetricsPanel The camera's values, story and free.
 *   ModalPanelWidget             Keys and URL parameters, from the same descriptors the URL uses.
 *   ToastWidget                  What a still or a measurement took.
 *
 * The keys are one list of `KeyboardShortcut`s, which handles them and documents them. A key on a
 * focused control of the panels, as a toggle, a select's list or a slider, is the control's. Settings
 * go through a `SettingsManager`, which keeps preferences in local storage, and the rest go to the
 * URL with `debug-settings.ts`. The stage loads this file only without `?capture=1`, and reaches it
 * through `StageHost` alone, so a capture has none of it: no widgets, no overrides and none of the
 * loop's views (`?loop=1`, `?seam=1`, `?gust=1`, `?water=`). `?world=` is the stage's own.
 */

import type {Layer} from '@deck.gl/core';
import {_StatsWidget as StatsWidget, _TimelineWidget as TimelineWidget} from '@deck.gl/widgets';
import '@deck.gl/widgets/stylesheet.css';
import {
  applyPanelTheme,
  findShortcutMatchingKeyEvent,
  getSettingDefinitions,
  getValueAtPath,
  KeyboardShortcutsPanel,
  MetricsPanel,
  PANEL_THEME_DARK,
  SettingsManager,
  setValueAtPath,
  TabbedPanel,
  toastManager,
  URLParametersPanel,
  type KeyboardShortcut,
  type SettingsChangeDescriptor,
  type SettingValue,
  type ToolbarComponentItem
} from '@deck.gl-community/panels';
import {
  BoxPanelWidget,
  createStudioSettingsWidget,
  ModalPanelWidget,
  ToastWidget,
  ToolbarWidget,
  updateStudioSettingsWidget,
  type StudioSettingsWidgetProps
} from '@deck.gl-community/widgets';
import {luma} from '@luma.gl/core';
import {getCycleSeconds, getSeamSeconds, HURRICANE, LOOP} from '../story/beats';
import {getOrbitViewProps} from '../story/camera';
import {getWind} from '../story/environment';
import type {StoryCamera, StoryState, StoryWorld} from '../story/story-types';
import {
  applyStoryOverrides,
  createDebugSchema,
  getCameraFromViewState,
  getDebugPlayback,
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
  writeDebugQuery,
  type DebugValues,
  type OrbitViewState,
  type StoryOverride
} from './debug-settings';
import type {StageHost} from './stage';
import {
  formatStageSeconds,
  getFrameDifference,
  SEAM_CHECK,
  SEAM_VIEW,
  type FrameDifference
} from './stage-query';

/** Where preferences are kept between visits. */
const STORAGE_KEY = 'thirty-years:stage-debug';
/** How often readouts and the open settings follow the playhead, in milliseconds. */
const READOUT_MS = 100;
const SETTINGS_SYNC_MS = 250;
/** Frames `measureStage` plays. */
const MEASURE_FRAMES = 60;
/** Frames of playback the frame rate and time are averaged over. */
const FRAME_STAT_SAMPLES = 10;
/** What the stats copy from luma's own, as the device has them now. */
const GPU_MEMORY_STATS = ['GPU Memory', 'Texture Memory', 'Buffer Memory'];
/** What deck's controller may do with the free camera. The arrow keys stay the film's. */
const ORBIT_CONTROLLER = {inertia: false, keyboard: false, doubleClickZoom: false};
/** How long after the free camera stops, in milliseconds, its frame is made anew. */
const CAMERA_SETTLE_MS = 250;
/** Story seconds a wheel over the timeline moves by, per pixel: a mouse wheel's notch is a second. */
const WHEEL_SECONDS_PER_PIXEL = 1 / 100;
/** Pixels of a wheel's line and page, for a wheel that counts in those. */
const WHEEL_LINE_PIXELS = 100 / 3;
const WHEEL_PAGE_PIXELS = 800;
/** How long after the wheel stops, in milliseconds, its scrub ends. */
const WHEEL_END_MS = 200;
/** The stretch of cycle seconds the gust plot shows, the storm's, and its step. */
const GUST_PLOT = {from: HURRICANE.arrive, to: HURRICANE.clearing + 1.6, step: 1 / 60};
/** CSS pixels of the gust plot's height. */
const GUST_PLOT_HEIGHT = 112;
/** ARIA roles of the controls a key on them belongs to, rather than to the film. */
const CONTROL_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treeitem'
]);
/** Elements that are controls whatever their role. */
const CONTROL_SELECTOR = 'a[href], button, input, select, textarea, summary, [contenteditable]';

/**
 * deck.gl's `StatsWidget`, whose collapsed button shows the stage's frame rate: deck's own, which
 * it reads, stops with deck's animation loop.
 */
class StageStatsWidget extends StatsWidget {
  private readonly getFrameRate: () => number;

  constructor(props: ConstructorParameters<typeof StatsWidget>[0], getFrameRate: () => number) {
    super(props);
    this.getFrameRate = getFrameRate;
  }

  protected override _getFps = (): number => Math.round(this.getFrameRate());
}

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether a key goes to a focused control of the panels rather than to the film: a field, a
 * button, a toggle, a select that opens a list, a slider, a tab, or anything in an open list or
 * menu. The timeline is the film's own, and its keys stay the film's.
 */
function isOnControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest('#timeline')) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.matches(CONTROL_SELECTOR)) return true;
  const role = target.getAttribute('role');
  if (role && CONTROL_ROLES.has(role)) return true;
  return Boolean(target.closest('[role="listbox"], [role="menu"], [role="combobox"]'));
}

/** Resolves after the next paint, so what was just shown is on screen before the page is busy. */
function waitForPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function formatMetres(metres: number): string {
  return metres < 1
    ? `${(metres * 1000).toFixed(1)} mm`
    : `${metres.toFixed(metres < 10 ? 3 : 1)} m`;
}

/** Seconds with their sign, as seam seconds read: −2.70, +0.10. */
function formatSigned(seconds: number, digits = 2): string {
  const text = Math.abs(seconds).toFixed(digits);
  return seconds < 0 && Number(text) !== 0 ? `−${text}` : `+${text}`;
}

/** A cycle second as the timeline labels it, with its seam second near the swap. */
function formatCycleLabel(seconds: number): string {
  const seam = getSeamSeconds(seconds);
  const label = `${getCycleSeconds(seconds).toFixed(2)} s`;
  return Math.abs(seam) < 5 ? `${label} · seam ${formatSigned(seam)}` : label;
}

/** A difference of two frames, as the seam strip shows it. */
function formatDifference({mad, psnr}: FrameDifference): string {
  return `MAD ${mad.toFixed(2)} · PSNR ${Number.isFinite(psnr) ? psnr.toFixed(1) : '∞'} dB`;
}

/** A camera as rows of a readout, each name with `prefix`. */
function getCameraRows(prefix: string, camera: StoryCamera): Record<string, string> {
  return {
    [`${prefix}target`]: camera.target.map(value => value.toFixed(3)).join(', '),
    [`${prefix}orbit`]: `${camera.orbit.toFixed(2)}°`,
    [`${prefix}pitch`]: `${camera.pitch.toFixed(2)}°`,
    [`${prefix}distance`]: formatMetres(camera.distance),
    [`${prefix}fovy`]: `${camera.fovy.toFixed(1)}°`,
    [`${prefix}planes`]: `${formatMetres(camera.near)}, ${formatMetres(camera.far)}`,
    [`${prefix}aperture`]: formatMetres(camera.aperture)
  };
}

/** The stage's keys, which the panel handles from this list and documents with it. */
function getStageShortcuts(host: StageHost): KeyboardShortcut[] {
  const isForFilm = (event: KeyboardEvent) => !isOnControl(event.target);
  const createFilmKey = (shortcut: KeyboardShortcut): KeyboardShortcut => ({
    shouldHandle: isForFilm,
    preventDefault: true,
    ...shortcut
  });
  return [
    createFilmKey({
      key: ' ',
      name: 'Play or pause',
      description: 'Plays from here, at the speed set.',
      onKeyPress: () => host.setPlaying(!host.isPlaying())
    }),
    createFilmKey({
      key: 'ArrowLeft',
      name: 'Back a frame',
      description: '1/30 s.',
      displayPair: {id: 'frame', position: 'primary', description: 'Step a frame, 1/30 s'},
      onKeyPress: () => host.stepTime(-1, false)
    }),
    createFilmKey({
      key: 'ArrowRight',
      name: 'Forward a frame',
      description: '1/30 s.',
      displayPair: {id: 'frame', position: 'secondary', description: 'Step a frame, 1/30 s'},
      onKeyPress: () => host.stepTime(1, false)
    }),
    createFilmKey({
      key: 'ArrowLeft',
      shiftKey: true,
      name: 'Back a second',
      description: '1 s.',
      displayPair: {id: 'second', position: 'primary', description: 'Step a second'},
      onKeyPress: () => host.stepTime(-1, true)
    }),
    createFilmKey({
      key: 'ArrowRight',
      shiftKey: true,
      name: 'Forward a second',
      description: '1 s.',
      displayPair: {id: 'second', position: 'secondary', description: 'Step a second'},
      onKeyPress: () => host.stepTime(1, true)
    }),
    createFilmKey({
      key: 'ArrowUp',
      name: 'Previous beat',
      description: 'To the start of this beat, or the one before, round the cycle.',
      displayPair: {id: 'beat', position: 'primary', description: 'Go from beat to beat'},
      onKeyPress: () => host.stepBeat(-1)
    }),
    createFilmKey({
      key: 'ArrowDown',
      name: 'Next beat',
      description: 'To the start of the next beat, round the cycle.',
      displayPair: {id: 'beat', position: 'secondary', description: 'Go from beat to beat'},
      onKeyPress: () => host.stepBeat(1)
    }),
    {
      key: 'wheel',
      displayInputs: [{kind: 'mouse', label: 'wheel over the timeline'}],
      displaySection: 'navigation',
      name: 'Scrub',
      description: 'A notch is a second. Home, End, Page Up and Page Down on the timeline seek.'
    },
    {
      key: 'drag',
      dragMouse: true,
      displayInputs: [{kind: 'mouse', label: 'drag'}],
      displaySection: 'navigation',
      name: 'Free camera',
      description: 'With Camera set to free orbit: drag to orbit, Shift-drag to pan, wheel to zoom.'
    }
  ];
}

/** Adds the debug tools to the stage. Called once, after the first frame, without `?capture=1`. */
export function startDebugPanel(host: StageHost): void {
  const {deck, context, options} = host;
  applyPanelTheme(document.body, PANEL_THEME_DARK);

  // Settings: defaults, then this browser's preferences, then the URL.

  const manager = new SettingsManager();
  manager.setLocalStoragePersistence({storageKey: STORAGE_KEY, getStorage: getLocalStorage});
  const fromUrl = parseDebugQuery(host.query, context);
  let schema = createDebugSchema(context, fromUrl);
  manager.setSettingDefinitions(getSettingDefinitions(schema));
  let settings = manager.getSettingsWithLocalStorage(fromUrl);
  manager.setCurrentSettings(settings);
  let values: DebugValues = readDebugValues(settings, context);

  // What changes frames: overrides, and a free camera with the story camera it started from.

  let overrides: readonly StoryOverride[] = [];
  let cameraMode: DebugValues['camera'] = 'story';
  let freeCamera: StoryCamera | null = null;
  let storyCamera: StoryCamera | null = host.getState()?.camera ?? null;
  let storyShake: readonly number[] = host.getState()?.shake ?? [0, 0];
  let cameraTimer = 0;

  function transformState(state: StoryState, preroll: boolean): StoryState {
    storyCamera = state.camera;
    storyShake = state.shake;
    let next = overrides.length > 0 ? applyStoryOverrides(state, overrides) : state;
    // A jump's preroll is the story's view, as a frame made anew with the story camera has it.
    if (cameraMode === 'orbit' && !preroll) {
      freeCamera ??= getShakenCamera(state.camera, state.shake);
      next = {...next, camera: freeCamera, shake: [0, 0]};
    }
    return next;
  }

  const canvas = deck.getCanvas() as HTMLCanvasElement;
  deck.setProps({
    onViewStateChange: ({viewState}) => {
      if (cameraMode !== 'orbit' || !freeCamera) return;
      freeCamera = getCameraFromViewState(viewState as OrbitViewState, freeCamera, deck.height);
      // So the next event of the same frame starts from this one.
      deck.setProps({viewState});
      host.requestDraw(true);
      // Once the camera stops, its frame is made anew, as after any other change.
      window.clearTimeout(cameraTimer);
      cameraTimer = window.setTimeout(() => host.requestDraw(), CAMERA_SETTLE_MS);
    }
  });

  function setCameraMode(mode: DebugValues['camera']): void {
    if (mode === cameraMode) return;
    cameraMode = mode;
    // A free camera starts on the frame on screen, shake and all, and holds it as time moves.
    const shown = host.getState();
    freeCamera = mode === 'orbit' && shown ? getShakenCamera(shown.camera, shown.shake) : null;
    deck.setProps({controller: mode === 'orbit' ? ORBIT_CONTROLLER : false});
    canvas.style.cursor = mode === 'orbit' ? 'grab' : '';
  }

  // Widgets.

  const timelineElement = document.getElementById('timeline') as HTMLElement;
  const toolbarElement = document.getElementById('toolbar') as HTMLElement;

  const timeline = new TimelineWidget({
    id: 'stage-timeline',
    _container: timelineElement as HTMLDivElement,
    timeRange: [0, context.cycleSeconds],
    // The stage's clock plays the film. With no step, the widget's own timer never moves it.
    step: 0,
    time: host.getTime(),
    playing: host.isPlaying(),
    formatLabel: seconds => formatCycleLabel(seconds),
    playTooltip: 'Play (Space)',
    pauseTooltip: 'Pause (Space)',
    onTimeChange: seconds => setTimelineTime(seconds),
    onPlayingChange: playing => host.setPlaying(playing)
  });

  const toolbar = new ToolbarWidget({
    id: 'stage-toolbar',
    _container: toolbarElement,
    style: {position: 'relative', zIndex: '1'},
    items: []
  });

  const frameStats = luma.stats.get('Thirty Years stage');
  // Ended and started again at each frame of playback, so its window is the rate and the time.
  const frameTimer = frameStats.get('Frame time').setSampleSize(FRAME_STAT_SAMPLES);
  const stats = new StageStatsWidget(
    {
      id: 'stage-stats',
      placement: 'top-right',
      type: 'custom',
      stats: frameStats,
      title: 'Stage',
      framesPerUpdate: 10,
      formatters: {
        'Frame time': stat => {
          const rate = stat.getSampleHz();
          if (rate <= 0) return `Frame rate: ${host.isPlaying() ? '…' : 'paused'}\nFrame time: —`;
          const time = stat.getSampleAverageTime();
          return `Frame rate: ${rate.toFixed(0)} fps\nFrame time: ${time.toFixed(1)} ms`;
        },
        Layers: stat => `Layers: ${stat.count}`,
        Trees: stat => `Trees growing: ${stat.count}`
      }
    },
    () => frameTimer.getSampleHz()
  );
  for (const name of ['Layers', 'Trees']) frameStats.get(name);
  for (const name of GPU_MEMORY_STATS) frameStats.get(name, 'memory');

  const cameraPanel = new MetricsPanel({id: 'stage-camera-metrics', title: 'Camera', metrics: {}});
  const cameraReadout = new BoxPanelWidget({
    id: 'stage-camera',
    placement: 'top-right',
    title: 'Camera',
    widthPx: 320,
    panel: cameraPanel
  });

  const shortcuts = getStageShortcuts(host);
  const help = new ModalPanelWidget({
    id: 'stage-help',
    placement: 'top-left',
    title: 'Stage keys and URL',
    triggerLabel: 'Keys and URL parameters',
    triggerIcon: '?',
    panel: new TabbedPanel({
      id: 'stage-help-tabs',
      panels: [
        new KeyboardShortcutsPanel({id: 'stage-keys', title: 'Keys', keyboardShortcuts: shortcuts}),
        new URLParametersPanel({
          id: 'stage-url',
          title: 'URL',
          urlParameters: getStageUrlParameters(context)
        })
      ]
    })
  });

  const toasts = new ToastWidget({id: 'stage-toasts', placement: 'bottom-right'});

  let isSettingsOpen = false;
  const getSettingsWidgetProps = (): StudioSettingsWidgetProps => ({
    id: 'stage-settings',
    placement: 'top-left',
    title: 'Stage settings',
    triggerLabel: 'Stage settings',
    schema,
    settings,
    onSettingsChange: (_next, changes) => {
      for (const change of changes ?? []) manager.setSettingValue(change.name, change.nextValue);
    },
    onOpenChange: open => {
      isSettingsOpen = open;
      if (open) syncShownSettings();
    }
  });
  const settingsWidget = createStudioSettingsWidget(getSettingsWidgetProps());

  function setWidgets(): void {
    deck.setProps({
      widgets: [
        settingsWidget,
        help,
        stats,
        ...(values.readout ? [cameraReadout] : []),
        toasts,
        timeline,
        toolbar
      ]
    });
  }

  // The keys, before a focused widget, as the timeline, takes the same key for itself. A focused
  // control of the panels keeps its own: `isOnControl`.

  window.addEventListener(
    'keydown',
    event => {
      const shortcut = findShortcutMatchingKeyEvent(event, shortcuts);
      if (!shortcut?.onKeyPress || (shortcut.shouldHandle && !shortcut.shouldHandle(event))) {
        return;
      }
      if (shortcut.preventDefault) event.preventDefault();
      event.stopPropagation();
      shortcut.onKeyPress();
    },
    {capture: true}
  );

  // A click on a button of the toolbar does not focus it, so the keys stay the film's: a step, then
  // Space, plays. Reached by Tab, a button is a control as any other.
  toolbarElement.addEventListener(
    'mousedown',
    event => {
      if (event.target instanceof Element && event.target.closest('button')) {
        event.preventDefault();
      }
    },
    {capture: true}
  );

  // The timeline. Only a drag of its thumb scrubs: frames without their rates while it moves, then
  // one with them when the pointer comes up. A click on the track, or a key on the focused
  // timeline, is a seek. The pointer is followed in the capture phase, before the toolbar or a
  // widget stops it on its way.

  let isPointerDown = false;
  let scrubSeconds: number | null = null;

  function setTimelineTime(seconds: number): void {
    if (isPointerDown) {
      scrubSeconds = seconds;
      host.scrubTo(seconds, false);
    } else {
      host.seekTo(seconds);
    }
  }

  function endScrub(): void {
    isPointerDown = false;
    if (scrubSeconds !== null) {
      host.scrubTo(scrubSeconds, true);
      scrubSeconds = null;
    }
  }

  timelineElement.addEventListener(
    'pointerdown',
    () => {
      isPointerDown = true;
    },
    {capture: true}
  );
  window.addEventListener('pointerup', endScrub, {capture: true});
  window.addEventListener('pointercancel', endScrub, {capture: true});

  // A wheel over the timeline scrubs too, by a second a notch, rather than deck's RangeInput adding
  // its pixels as seconds.
  let wheelSeconds = Number.NaN;
  let wheelTimer = 0;
  timelineElement.addEventListener(
    'wheel',
    event => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY || event.deltaX;
      const pixels =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? delta * WHEEL_LINE_PIXELS
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? delta * WHEEL_PAGE_PIXELS
            : delta;
      if (!pixels) return;
      const from = Number.isNaN(wheelSeconds) ? host.getTime() : wheelSeconds;
      // Round the cycle, past its end into its start, as the film loops.
      wheelSeconds = getCycleSeconds(from + pixels * WHEEL_SECONDS_PER_PIXEL);
      host.scrubTo(wheelSeconds, false);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        host.scrubTo(wheelSeconds, true);
        wheelSeconds = Number.NaN;
      }, WHEEL_END_MS);
    },
    {capture: true, passive: false}
  );

  // Laid over the widget's own track: the beats under it, the swap at both its ends with the rind
  // either side, the file's first frame, and the A-B range, in two pieces through the swap.

  const {cycleSeconds} = context;
  const toPercent = (seconds: number) => `${(100 * seconds) / cycleSeconds}%`;
  const marks = document.createElement('div');
  marks.className = 'stage-marks';
  const bands = [document.createElement('b'), document.createElement('b')];
  const createMark = (className: string, seconds: number, title: string): HTMLElement => {
    const mark = document.createElement('i');
    mark.className = className;
    mark.style.left = toPercent(seconds);
    mark.title = title;
    return mark;
  };
  const createSpan = (className: string, from: number, to: number): HTMLElement => {
    const span = document.createElement('s');
    span.className = className;
    span.style.left = toPercent(from);
    span.style.width = toPercent(to - from);
    return span;
  };
  marks.append(
    // The rind's cover, either side of the swap.
    createSpan('stage-cover', cycleSeconds + LOOP.cover[0], cycleSeconds),
    createSpan('stage-cover', 0, LOOP.cover[1]),
    ...bands,
    ...context.beats.map(beat => createMark('', beat.start, beat.id)),
    createMark('stage-seam', 0, 'The swap: seam 0'),
    createMark('stage-seam', cycleSeconds, 'The swap: seam 0'),
    createMark('stage-file', context.fileStart, `The file's first frame, ${context.fileStart} s`)
  );
  timelineElement.append(marks);

  function layOutMarks(): void {
    const track = timelineElement.querySelector('.deck-widget-range__decorations');
    if (!track) return;
    const box = track.getBoundingClientRect();
    const parent = timelineElement.getBoundingClientRect();
    Object.assign(marks.style, {
      left: `${box.left - parent.left}px`,
      top: `${box.top - parent.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`
    });
    const pieces = values.range
      ? getPlaybackPieces(getDebugPlayback(values, context), cycleSeconds)
      : [];
    for (const [index, band] of bands.entries()) {
      const piece = pieces[index];
      band.hidden = !piece;
      if (piece) {
        band.style.left = toPercent(piece[0]);
        band.style.width = toPercent(piece[1] - piece[0]);
      }
    }
  }

  // The safe area of a portrait frame, over the picture and never in a capture.

  const guides = document.createElement('div');
  guides.className = 'stage-guides';
  host.frame.append(guides);

  function layOutGuides(): void {
    const insets = values.guides
      ? getSafeAreaInsets(host.frame.clientWidth, host.frame.clientHeight)
      : null;
    guides.hidden = !insets;
    if (insets) {
      Object.assign(guides.style, {
        top: `${insets.top}px`,
        right: `${insets.right}px`,
        bottom: `${insets.bottom}px`,
        left: `${insets.left}px`
      });
    }
  }

  // The seam strip, `?seam=1`: the seconds either side of the swap side by side, each from its own
  // side and with no grain, how much each step to the next changes the frame, and how alike the two
  // worlds are at the seconds the seam check compares them. Drawn as the stage is set, overlay and
  // all, and drawn again when that changes.

  const seamStrip = document.createElement('div');
  seamStrip.className = 'stage-seam';
  seamStrip.hidden = true;
  host.frame.append(seamStrip);
  let seamRun = 0;
  let isSeamShown = false;

  function createCanvasOf(image: ImageData): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(image, 0, 0);
    return canvas;
  }

  function getDifference(a: ImageData, b: ImageData): FrameDifference {
    return getFrameDifference(a.data, b.data, a.width, a.height);
  }

  async function showSeamStrip(): Promise<void> {
    const run = ++seamRun;
    const back = host.getTime();
    const grade = {grain: 0};
    seamStrip.hidden = false;
    seamStrip.textContent = 'Rendering the seam…';
    try {
      const shots: {seam: number; world: StoryWorld; image: ImageData}[] = [];
      for (const {seam, world} of SEAM_VIEW) {
        await host.renderAt(seam, {world, grade});
        shots.push({seam, world, image: host.captureFrame()});
      }
      const checks: string[] = [];
      for (const seam of SEAM_CHECK.seams) {
        const own = shots.find(shot => shot.seam === seam);
        if (!own) continue;
        const other: StoryWorld = own.world === 'end' ? 'start' : 'end';
        await host.renderAt(seam, {world: other, grade});
        const difference = getDifference(own.image, host.captureFrame());
        const verdict = difference.psnr >= SEAM_CHECK.leastPsnr ? 'pass' : 'FAIL';
        checks.push(
          `${own.world} and ${other} at ${formatSigned(seam, 3)} s: ${formatDifference(difference)}, ` +
            `${verdict} at ${SEAM_CHECK.leastPsnr} dB`
        );
      }
      if (run !== seamRun) return;
      const row = document.createElement('div');
      row.className = 'stage-seam-row';
      row.append(
        ...shots.map(({seam, world, image}) => {
          const cell = document.createElement('figure');
          const caption = document.createElement('figcaption');
          caption.textContent = `${formatSigned(seam, 3)} s, ${world}`;
          cell.append(createCanvasOf(image), caption);
          return cell;
        })
      );
      const steps = shots.slice(1).map((shot, index) => {
        const before = shots[index];
        return (
          `${formatSigned(before.seam, 3)} to ${formatSigned(shot.seam, 3)} s: ` +
          formatDifference(getDifference(before.image, shot.image))
        );
      });
      const notes = document.createElement('p');
      notes.textContent = [...steps, ...checks, 'Grain off.'].join('\n');
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.addEventListener('click', () => setSetting('loop.seam', false));
      seamStrip.replaceChildren(row, notes, close);
    } catch (error) {
      if (run === seamRun) seamStrip.textContent = `Seam strip: ${String(error)}`;
    } finally {
      // Back to the frame there was.
      if (run === seamRun) host.seekTo(back);
    }
  }

  function hideSeamStrip(): void {
    seamRun++;
    seamStrip.hidden = true;
    seamStrip.replaceChildren();
  }

  // The gust plot, `?gust=1`: `wind.gust` at the storm's view point, and the wind's strength, through
  // the storm, with the peaks its fronts are locked to and the playhead.

  const gustPlot = document.createElement('canvas');
  gustPlot.className = 'stage-gust';
  gustPlot.hidden = true;
  host.frame.append(gustPlot);
  let gustSamples: {gust: Float32Array; strength: Float32Array} | null = null;

  function getGustSamples(): {gust: Float32Array; strength: Float32Array} {
    if (gustSamples) return gustSamples;
    const count = Math.round((GUST_PLOT.to - GUST_PLOT.from) / GUST_PLOT.step) + 1;
    const gust = new Float32Array(count);
    const strength = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      const wind = getWind(GUST_PLOT.from + index * GUST_PLOT.step);
      gust[index] = wind.gust;
      strength[index] = wind.strength;
    }
    gustSamples = {gust, strength};
    return gustSamples;
  }

  function drawGustPlot(): void {
    gustPlot.hidden = !values.gust;
    const pen = gustPlot.getContext('2d');
    if (!values.gust || !pen) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(host.frame.clientWidth * ratio));
    const height = Math.round(GUST_PLOT_HEIGHT * ratio);
    if (gustPlot.width !== width || gustPlot.height !== height) {
      gustPlot.width = width;
      gustPlot.height = height;
    }
    const {gust, strength} = getGustSamples();
    const [left, right, top, bottom] = [30, 8, 18, 16].map(pixels => pixels * ratio);
    const getX = (seconds: number) =>
      left +
      ((seconds - GUST_PLOT.from) / (GUST_PLOT.to - GUST_PLOT.from)) * (width - left - right);
    const getY = (value: number) => top + (1 - value) * (height - top - bottom);
    pen.clearRect(0, 0, width, height);
    pen.fillStyle = 'rgb(8 10 8 / 72%)';
    pen.fillRect(0, 0, width, height);
    pen.font = `${10 * ratio}px ui-monospace, Menlo, monospace`;
    pen.textBaseline = 'alphabetic';
    // The eye, and the peaks the fronts are locked to.
    pen.fillStyle = 'rgb(120 170 220 / 14%)';
    pen.fillRect(
      getX(HURRICANE.eyeOpen),
      top,
      getX(HURRICANE.eyeClose) - getX(HURRICANE.eyeOpen),
      height - top - bottom
    );
    pen.strokeStyle = 'rgb(224 160 64 / 85%)';
    pen.fillStyle = 'rgb(224 160 64 / 95%)';
    pen.setLineDash([3 * ratio, 3 * ratio]);
    pen.lineWidth = ratio;
    for (const peak of HURRICANE.gustPeaks) {
      pen.beginPath();
      pen.moveTo(getX(peak), top);
      pen.lineTo(getX(peak), height - bottom);
      pen.stroke();
      pen.fillText(String(peak), getX(peak) + 2 * ratio, height - 4 * ratio);
    }
    pen.setLineDash([]);
    const drawCurve = (values: Float32Array, color: string) => {
      pen.strokeStyle = color;
      pen.lineWidth = 1.5 * ratio;
      pen.beginPath();
      for (let index = 0; index < values.length; index++) {
        const x = getX(GUST_PLOT.from + index * GUST_PLOT.step);
        const y = getY(values[index]);
        if (index === 0) pen.moveTo(x, y);
        else pen.lineTo(x, y);
      }
      pen.stroke();
    };
    drawCurve(strength, 'rgb(150 160 170 / 80%)');
    drawCurve(gust, 'rgb(150 225 255)');
    pen.fillStyle = 'rgb(212 216 208)';
    pen.fillText('1', 8 * ratio, getY(1) + 4 * ratio);
    pen.fillText('0', 8 * ratio, getY(0));
    const state = host.getState();
    const seconds = host.getTime();
    if (seconds >= GUST_PLOT.from && seconds <= GUST_PLOT.to) {
      pen.strokeStyle = 'rgb(255 255 255 / 90%)';
      pen.beginPath();
      pen.moveTo(getX(seconds), top);
      pen.lineTo(getX(seconds), height - bottom);
      pen.stroke();
    }
    if (state) {
      pen.fillText(
        `wind.gust ${state.wind.gust.toFixed(2)}, strength ${state.wind.strength.toFixed(2)} at ` +
          `${seconds.toFixed(2)} s`,
        left,
        top - 5 * ratio
      );
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    layOutMarks();
    layOutGuides();
    drawGustPlot();
  });
  resizeObserver.observe(timelineElement);
  resizeObserver.observe(host.frame);

  // Applying settings.

  function writeUrl(): void {
    const next = writeDebugQuery(settings, host.query, context);
    for (const key of [...host.query.keys()]) host.query.delete(key);
    for (const [key, value] of next) host.query.append(key, value);
    host.saveToUrl();
  }

  /** What of the settings changes the picture, to compare. A preference, as the speed, does not. */
  let pictureKey = '';
  function getPictureKey(): string {
    const {layers, overlay, finish, overrides, lodBias, devicePixels, aspect, camera, world} =
      values;
    return JSON.stringify([
      layers,
      overlay,
      finish,
      overrides,
      lodBias,
      devicePixels,
      aspect,
      camera,
      world
    ]);
  }

  /** Whether playback has been started as the file, so it starts once each time it is turned on. */
  let isFileStarted = false;

  function applySettings(): void {
    values = readDebugValues(settings, context);
    options.layers = new Set(values.layers);
    options.overlay = values.overlay;
    options.finish = values.finish;
    options.lodBias = values.lodBias;
    options.world = values.world;
    options.playback = getDebugPlayback(values, context);
    if (values.devicePixels !== options.devicePixels) {
      options.devicePixels = values.devicePixels;
      deck.setProps({useDevicePixels: values.devicePixels});
    }
    host.setAspect(values.aspect || null);
    setCameraMode(values.camera);
    overrides = values.overrides;
    options.transformState =
      overrides.length > 0 || values.camera === 'orbit' ? transformState : null;
    setWidgets();
    layOutMarks();
    layOutGuides();
    updateToolbar();
    updateCameraReadout();
    drawGustPlot();
    writeUrl();
    const key = getPictureKey();
    const isNewPicture = key !== pictureKey;
    if (isNewPicture) {
      pictureKey = key;
      // Made anew, so a change undone gives back the frame there was.
      host.requestDraw();
    }
    const isSeamWanted = values.seam && (!isSeamShown || isNewPicture);
    isSeamShown = values.seam;
    if (!values.seam) hideSeamStrip();
    const isFileWanted = values.file && !isFileStarted;
    isFileStarted = values.file;
    if (isSeamWanted || isFileWanted) {
      void (async () => {
        if (isSeamWanted) await showSeamStrip();
        // As a feed plays the file: from its first frame, round the cycle.
        if (isFileWanted) {
          host.seekTo(context.fileStart);
          host.setPlaying(true);
        }
      })();
    }
  }

  function setSetting(name: string, value: SettingValue): void {
    manager.setSettingValue(name, value);
  }

  manager.setOnSettingsChange((next, changes = []) => {
    settings = next;
    for (const change of changes as SettingsChangeDescriptor[]) {
      const override = getOverrideOfSetting(change.name);
      const pin = override && getOverrideName('on', override.field.path);
      // Moving a slider pins it.
      if (override?.part === 'value' && pin && !getValueAtPath(settings, pin)) {
        manager.setSettingValue(pin, true);
      }
      if (change.name === 'time.beat' && change.nextValue) {
        const beat = context.beats.find(candidate => candidate.id === change.nextValue);
        if (beat) host.seekTo(beat.start);
        // An action rather than a setting: back to its prompt, so any beat can be chosen again.
        manager.setSettingValue('time.beat', '');
      }
      if (change.name === 'render.msaa') {
        // A canvas keeps the antialiasing it was made with.
        writeUrl();
        host.query.set('t', formatStageSeconds(host.getTime()));
        window.location.search = host.query.toString();
        return;
      }
    }
    // A select may now hold a value its options did not have.
    schema = createDebugSchema(context, settings);
    updateStudioSettingsWidget(settingsWidget, getSettingsWidgetProps());
    applySettings();
  });

  /** Sliders that follow the film while the dialog is open: those not pinned. */
  function syncShownSettings(): void {
    const state = host.getState();
    if (!state) return;
    let next = settings;
    for (const field of OVERRIDE_FIELDS) {
      // What is not pinned is the story's own number, in the frame as shown.
      const value = getValueAtPath(state, field.path);
      if (!getValueAtPath(next, getOverrideName('on', field.path)) && typeof value === 'number') {
        next = setValueAtPath(next, getOverrideName('value', field.path), value);
      }
    }
    settings = next;
    manager.setCurrentSettings(settings);
    updateStudioSettingsWidget(settingsWidget, getSettingsWidgetProps());
  }

  // Actions.

  let isRendering = false;

  async function renderStill(): Promise<void> {
    if (isRendering) return;
    isRendering = true;
    updateToolbar();
    const began = performance.now();
    try {
      // As an export renders a frame, with more samples for a wide lens.
      const frame = await host.renderAt(host.getTime(), {samples: values.samples, adaptive: true});
      const seconds = ((performance.now() - began) / 1000).toFixed(1);
      toastManager.toast({
        type: frame.errors.length > 0 ? 'warning' : 'info',
        key: 'still',
        title: `Still at ${frame.t.toFixed(2)} s`,
        message: `${frame.samples} samples, ${frame.width}×${frame.height}, in ${seconds} s. It stays until the next frame is drawn.`
      });
    } catch (error) {
      toastManager.toast({type: 'error', key: 'still', title: 'Still', message: String(error)});
    } finally {
      isRendering = false;
      updateToolbar();
    }
  }

  async function measureFrames(): Promise<void> {
    if (isRendering) return;
    host.setPlaying(false);
    isRendering = true;
    updateToolbar();
    const from = host.getTime();
    toastManager.toast({
      type: 'info',
      key: 'measure',
      title: `Measuring ${MEASURE_FRAMES} frames from ${from.toFixed(2)} s`,
      message: 'The page waits for each frame, and does nothing else until the last.'
    });
    try {
      await waitForPaint();
      const result = await host.measureStage(MEASURE_FRAMES);
      toastManager.toast({
        type: 'info',
        key: 'measure',
        title: `${result.frames} frames from ${from.toFixed(2)} s`,
        message:
          `Mean ${result.mean.toFixed(1)} ms, median ${result.median.toFixed(1)}, worst ` +
          `${result.worst.toFixed(1)}. Script ${result.scriptMean.toFixed(1)} ms of each.`
      });
    } catch (error) {
      toastManager.toast({type: 'error', key: 'measure', title: 'Measure', message: String(error)});
    } finally {
      isRendering = false;
      // Back to where it started, which the URL still says.
      host.seekTo(from);
      updateToolbar();
    }
  }

  /** A or B at the playhead, to the frame. B before A is a range through the swap. */
  function setRangeEnd(end: 'a' | 'b'): void {
    setSetting('time.range', true);
    setSetting(`time.${end}`, Number(formatStageSeconds(host.getTime())));
  }

  /** The seam badge: seconds from the swap, and the time rate while it is slowed. */
  function getSeamLabel(state: StoryState): string {
    const {seam, rate} = state.cycle;
    const label = `seam ${formatSigned(seam)} s`;
    return rate < 0.995 ? `${label} ×${rate.toFixed(2)}` : label;
  }

  function updateToolbar(): void {
    const state = host.getState();
    const items: ToolbarComponentItem[] = [
      {
        kind: 'action',
        id: 'beat-back',
        label: '⏮',
        title: 'Previous beat (↑)',
        onClick: () => host.stepBeat(-1)
      },
      {
        kind: 'action',
        id: 'second-back',
        label: '−1 s',
        title: 'Back a second (Shift ←)',
        onClick: () => host.stepTime(-1, true)
      },
      {
        kind: 'action',
        id: 'frame-back',
        label: '−1 f',
        title: 'Back a frame (←)',
        onClick: () => host.stepTime(-1, false)
      },
      {
        kind: 'action',
        id: 'frame-forward',
        label: '+1 f',
        title: 'Forward a frame (→)',
        onClick: () => host.stepTime(1, false)
      },
      {
        kind: 'action',
        id: 'second-forward',
        label: '+1 s',
        title: 'Forward a second (Shift →)',
        onClick: () => host.stepTime(1, true)
      },
      {
        kind: 'action',
        id: 'beat-forward',
        label: '⏭',
        title: 'Next beat (↓)',
        onClick: () => host.stepBeat(1)
      },
      {
        kind: 'toggle-group',
        id: 'speed',
        label: 'Speed',
        selectedId: String(values.speed),
        options: PLAYBACK_SPEEDS.map(({label, value}) => ({id: String(value), label})),
        onSelect: speed => setSetting('time.speed', Number(speed))
      },
      {
        kind: 'action',
        id: 'loop',
        label: 'Loop',
        title: 'Round the cycle without end, or from B back to A',
        active: values.loop,
        onClick: () => setSetting('time.loop', !values.loop)
      },
      {
        kind: 'action',
        id: 'set-a',
        label: 'A',
        title: `Set A here (A is ${values.a.toFixed(2)} s)`,
        onClick: () => setRangeEnd('a')
      },
      {
        kind: 'action',
        id: 'set-b',
        label: 'B',
        title: `Set B here (B is ${values.b.toFixed(2)} s)`,
        onClick: () => setRangeEnd('b')
      },
      {
        kind: 'action',
        id: 'range',
        label: 'A-B',
        title: 'Play only from A to B',
        active: Boolean(values.range),
        onClick: () => setSetting('time.range', !values.range)
      },
      {
        kind: 'action',
        id: 'still',
        label: `Still ×${values.samples}`,
        title: 'Render this second as an export does, with the samples set in Render',
        disabled: isRendering,
        onClick: () => void renderStill()
      },
      {
        kind: 'action',
        id: 'measure',
        label: 'Measure',
        title: `Real frame time over ${MEASURE_FRAMES} frames from here`,
        disabled: isRendering,
        onClick: () => void measureFrames()
      },
      // Each badge keeps its title, which `stage.html` gives a fixed width, so none moves.
      ...(state
        ? ([
            {kind: 'badge', id: 'beat', label: state.beat, title: 'Beat'},
            {kind: 'badge', id: 'seconds', label: `${state.t.toFixed(2)} s`, title: 'Cycle second'},
            {kind: 'badge', id: 'seam', label: getSeamLabel(state), title: 'Seam second'},
            {kind: 'badge', id: 'year', label: `year ${state.year.toFixed(2)}`, title: 'Year'}
          ] as const)
        : []),
      ...(values.world
        ? [
            {
              kind: 'badge',
              id: 'world',
              label: `${values.world} world`,
              title: 'Inside the rind, frames are composed from this side of the swap'
            } as const
          ]
        : []),
      ...(overrides.length > 0
        ? [
            {
              kind: 'badge',
              id: 'pinned',
              label: `${overrides.length} pinned`,
              title: overrides.map(([path, value]) => `${path} ${value}`).join(', ')
            } as const
          ]
        : []),
      ...(cameraMode === 'orbit'
        ? [{kind: 'badge', id: 'free', label: 'free camera', title: 'Camera: free orbit'} as const]
        : [])
    ];
    toolbar.setProps({items});
  }

  // Each frame shown.

  let lastReadoutAt = 0;
  let lastSyncAt = 0;
  const gpuStats = luma.stats.get('GPU Time and Memory');

  function updateStats(): void {
    frameStats
      .get('Layers')
      .reset()
      .addCount((deck.props.layers as Layer[]).length);
    const state = host.getState();
    const growing = state ? state.trees.filter(tree => (tree.growth ?? 1) > 0).length : 0;
    frameStats.get('Trees').reset().addCount(growing);
    for (const name of GPU_MEMORY_STATS) {
      frameStats.get(name).reset().addCount(gpuStats.get(name).count);
    }
  }

  /** The camera readout, from the frame on screen. It is filled at once when turned on. */
  function updateCameraReadout(): void {
    if (!values.readout || !storyCamera) return;
    cameraPanel.setProps({
      metrics: {
        ...(cameraMode === 'orbit' && freeCamera ? getCameraRows('free ', freeCamera) : {}),
        ...getCameraRows(cameraMode === 'orbit' ? 'story ' : '', storyCamera),
        [cameraMode === 'orbit' ? 'story shake' : 'shake']: storyShake
          .map(value => `${value.toFixed(2)}°`)
          .join(', ')
      }
    });
  }

  options.onFrame = state => {
    const now = performance.now();
    if (!options.transformState) {
      storyCamera = state.camera;
      storyShake = state.shake;
    }
    if (host.isPlaying()) {
      frameTimer.timeEnd();
      frameTimer.timeStart();
    } else {
      // A pause is not a frame's time.
      frameTimer.reset();
    }
    if (cameraMode === 'orbit' && freeCamera) {
      // A still leaves deck with its last sub-frame's view, focused and jittered, which a drag
      // would start from.
      deck.setProps({viewState: getOrbitViewProps(freeCamera, deck.height).viewState});
    }
    timeline.setProps({time: state.t, playing: host.isPlaying()});
    if (now - lastReadoutAt >= READOUT_MS || !host.isPlaying()) {
      lastReadoutAt = now;
      updateStats();
      updateToolbar();
      updateCameraReadout();
      drawGustPlot();
    }
    if (isSettingsOpen && (now - lastSyncAt >= SETTINGS_SYNC_MS || !host.isPlaying())) {
      lastSyncAt = now;
      syncShownSettings();
    }
  };

  applySettings();
  updateStats();

  Object.assign(window, {
    /** For an agent at the page: `stageDebug.setSetting('override.value.weather.rain', 1)`. */
    stageDebug: {
      getSettings: () => settings,
      getValues: () => values,
      setSetting,
      schema: () => schema,
      /** Renders the seam strip again, and resolves when it is up. */
      showSeamStrip
    }
  });
}
