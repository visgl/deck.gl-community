// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** A camera on a style. Every renderer draws it at `VIEWPORT` size and device pixel ratio 1. */
export type ConformanceScene = {
  id: string;
  /** A key of `STYLES`. */
  style: string;
  /** `[longitude, latitude]`. */
  center: [number, number];
  /** MapLibre / deck.gl `MapView` zoom (512-pixel world). */
  zoom: number;
  pitch?: number;
  bearing?: number;
  /** What the scene exercises. */
  note?: string;
};

/** One render of a scene by one renderer. */
export type ConformanceRender = {
  /** RGBA, `width` x `height`, composited on white. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /**
   * The text of every label the renderer drew after collision, in logical order. `null` when the
   * renderer cannot report them: label metrics are then n/a, not zero.
   */
  labels: string[] | null;
  /** Why `labels` is null, or what limits it. */
  labelNote?: string;
  /** Anything that makes the render invalid as a measurement: errors, off-origin requests. */
  problems: string[];
  /** Free-form facts for the report (durations, versions, backend). */
  meta?: Record<string, unknown>;
};

/**
 * The renderer-neutral interface. A runner in any repository implements it for its renderer, and
 * `runConformanceScene` saves its output for the scorer.
 *
 * `style` is the scene's MapLibre style JSON, already pointing at the fixture server (TileJSON
 * inlined, tile, glyph and sprite URLs rewritten). A renderer that does not read MapLibre styles
 * maps it to its own input (as Tangram maps the Streets comparison style to its Streets scene) and
 * says which styles it can map with `supports`.
 */
export type ConformanceRenderer = {
  /** Directory name of its renders, and its column in the report. */
  id: string;
  /** Human-readable name and version for the report. */
  name: string;
  supports(scene: ConformanceScene): boolean;
  render(scene: ConformanceScene, style: any): Promise<ConformanceRender>;
};

/**
 * The input digests of a render (see `provenance.ts`): lowercase hex SHA-256 digests of the scene's
 * camera and style JSON (`scene`), and of every fixture the render requested (`fixtures`).
 */
export type RenderInputs = {
  algorithm: 'sha256';
  scene: string;
  fixtures: string;
};

/**
 * What a runner saves per scene next to `<renderer>/<scene>.png`, as `<renderer>/<scene>.json`.
 * The scorer reads only these files, so a runner in any repository can write them.
 */
export type SavedRender = {
  renderer: string;
  rendererName: string;
  scene: ConformanceScene;
  width: number;
  height: number;
  labels: string[] | null;
  labelNote?: string;
  problems: string[];
  /** Fixture requests the server saw during the render, and the ones it could not serve. */
  fixtureRequests: string[];
  fixtureMisses: string[];
  /** Fixtures recorded during the render (record mode only). */
  recorded: string[];
  durationMs: number;
  /** The input digests. The scorer computes them again and rejects the render when they differ. */
  inputs?: RenderInputs;
  meta?: Record<string, unknown>;
};

/**
 * What a runner saves as `<renderer>/renderer.json` before it renders: every scene of its run, and
 * whether the renderer renders it (`expected`) or declines it (`unsupported`). With it the scorer
 * tells a declined scene from a render that is missing because the run did not finish.
 */
export type RendererManifest = {
  renderer: string;
  rendererName: string;
  scenes: Record<string, 'expected' | 'unsupported'>;
};
