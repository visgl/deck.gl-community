// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
// The shader extensions of this module inject code into deck.gl layer shaders at hook functions,
// at statements of deck.gl's shader source, and next to deck.gl's variables. luma.gl skips an
// injection whose target is missing without an error, so a deck.gl release that rewords a shader
// would silently turn an effect off. These tests assemble the shaders of the deck.gl layers that
// the extensions are added to, as installed, and check every target and every name the injected
// code relies on. The pixel regressions in the browser tests check what the effects draw.
import {VERSION} from '@deck.gl/core';
import type {LayerExtension} from '@deck.gl/core';
import {
  CollisionFilterExtension,
  FillStyleExtension,
  PathStyleExtension
} from '@deck.gl/extensions';
import {
  BitmapLayer,
  IconLayer,
  PathLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
  _MultiIconLayer as MultiIconLayer,
  _TextBackgroundLayer as TextBackgroundLayer
} from '@deck.gl/layers';
import {testLayer} from '@deck.gl/test-utils/vitest';
import {describe, expect, test} from 'vitest';
import {CircleBlurExtension} from '../src/circle-layer';
import {FillPatternExtension, FillTranslateExtension} from '../src/fill-style-extensions';
import {GlobeHorizonExtension} from '../src/globe-horizon-extension';
import {LineBlurExtension} from '../src/line-blur-extension';
import {RasterColorExtension} from '../src/raster-color-extension';
import {TextHaloBlurExtension} from '../src/text-halo-blur-extension';

type Stage = 'vs' | 'fs';
type StageSources = Record<Stage, string>;
type Injection = {key: string; code: string};

const POINT = {
  position: [0, 0],
  path: [
    [0, 0],
    [1, 1]
  ],
  polygon: [
    [0, 0],
    [1, 0],
    [1, 1]
  ]
};
const STAGE_NAMES: Record<Stage, string> = {vs: 'vertex', fs: 'fragment'};

/**
 * Initializes a layer on the test device and returns the assembled shaders of its models, and
 * the code that an extension added to it injects.
 */
function getModelShaders(
  Layer: any,
  props: Record<string, unknown>,
  extension?: LayerExtension
): StageSources[] & {injections: Injection[]} {
  let shaders: StageSources[] = [];
  let injections: Injection[] = [];
  testLayer({
    Layer,
    onError: error => {
      throw error;
    },
    testCases: [
      {
        title: 'assembles the shaders',
        props: {id: 'injection-target-test', data: [POINT], ...props},
        onAfterUpdate: ({layer}: any) => {
          shaders = layer.getModels().map((model: any) => ({vs: model.vs, fs: model.fs}));
          injections = extension ? getInjections(extension, layer) : [];
        }
      }
    ]
  });
  expect(shaders.length, `${Layer.layerName} has no models`).toBeGreaterThan(0);
  return Object.assign(shaders, {injections});
}

/** The code an extension injects into the layer it is added to, keyed by target. */
function getInjections(extension: LayerExtension, layer: unknown): Injection[] {
  const shaders: any = extension.getShaders.call(layer as any, extension) || {};
  const injects = [
    shaders.inject || {},
    ...(shaders.modules || []).map((module: any) => module.inject || {})
  ];
  return injects.flatMap(inject =>
    Object.entries(inject).map(([key, value]: [string, any]) => ({
      key,
      code: typeof value === 'string' ? value : value.injection
    }))
  );
}

/** The first line of injected code, which marks where it landed in the assembled source. */
function getMarker(code: string): string {
  return code
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('//') && !line.startsWith('#')) as string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether the source calls a hook function, other than in the function's own definition. */
function callsHook(source: string, hook: string): boolean {
  return new RegExp(`(?<!void\\s+)\\b${escapeRegExp(hook)}\\s*\\(`).test(source);
}

/** Whether a name, such as `vPathPosition` or `sdf.outlineBuffer`, is in the source. */
function hasName(source: string, name: string): boolean {
  return new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?!\\w)`).test(source);
}

/** The body of a hook function in assembled source. */
function getHookBody(source: string, hook: string): string {
  const start = source.search(new RegExp(`void\\s+${escapeRegExp(hook)}\\s*\\(`));
  return start < 0 ? '' : source.slice(start, source.indexOf('\n}\n', start));
}

function describeTarget(extensionName: string, layerName: string): string {
  return (
    `${extensionName} relies on the shaders of deck.gl ${VERSION}'s ${layerName}; ` +
    `update the extension to this deck.gl version`
  );
}

/**
 * Checks that each of an extension's injections lands in the assembled shaders: a hook that the
 * layer calls, the start or end of `main`, or a statement of the layer's source.
 */
function expectInjectionsApplied({
  extensionName,
  layerName,
  injections,
  shaders
}: {
  extensionName: string;
  layerName: string;
  injections: Injection[];
  shaders: StageSources;
}) {
  const context = describeTarget(extensionName, layerName);
  expect(injections.length, `${context}: the extension injects nothing`).toBeGreaterThan(0);
  for (const {key, code} of injections) {
    const marker = getMarker(code);
    const match = /^(vs|fs):(#)?([\w-]+)$/.exec(key);
    if (!match) {
      // A statement of the layer's source, found by string match.
      const stage = (['vs', 'fs'] as Stage[]).find(name => shaders[name].includes(key));
      expect(stage, `${context}: no shader contains the statement '${key}'`).toBeDefined();
      const source = shaders[stage!];
      const at = source.indexOf(key);
      expect(
        source.indexOf(marker, at),
        `${context}: the code injected at '${key}' is missing`
      ).toBeGreaterThan(at);
      continue;
    }
    const [, stage, hash, name] = match as unknown as [string, Stage, string, string];
    const source = shaders[stage];
    const where = `${STAGE_NAMES[stage]} shader`;
    if (hash) {
      const mainAt = source.search(/void\s+main\s*\(/);
      expect(mainAt, `${context}: the ${where} has no main function`).toBeGreaterThanOrEqual(0);
      const at = source.indexOf(marker);
      expect(at, `${context}: the code injected at '${key}' is missing`).toBeGreaterThanOrEqual(0);
      if (name !== 'decl') {
        expect(at, `${context}: the code injected at '${key}' is outside main`).toBeGreaterThan(
          mainAt
        );
      }
    } else {
      expect(
        callsHook(source, name),
        `${context}: the ${where} no longer calls the hook ${name}`
      ).toBe(true);
      expect(
        getHookBody(source, name).includes(marker),
        `${context}: the code injected into ${name} is missing`
      ).toBe(true);
    }
  }
}

/**
 * Checks that names the injected code reads or writes are in the layer's own shaders. A field of
 * `geometry` must be in the layer's own source, which follows deck.gl's shader modules and sets
 * the fields that the layer passes to its hooks: the modules mention them too.
 */
function expectNames(
  extensionName: string,
  layerName: string,
  shaders: StageSources,
  names: Partial<Record<Stage, string[]>>
) {
  const context = describeTarget(extensionName, layerName);
  for (const stage of Object.keys(names) as Stage[]) {
    const source = shaders[stage];
    const layerSource = source.slice(Math.max(0, source.indexOf('#define SHADER_NAME')));
    for (const name of names[stage]!) {
      expect(
        hasName(name.startsWith('geometry.') ? layerSource : source, name),
        `${context}: '${name}' is no longer in the ${STAGE_NAMES[stage]} shader`
      ).toBe(true);
    }
  }
}

describe('shader injection targets in the installed deck.gl', () => {
  test('TextHaloBlurExtension: the outline alpha statement of MultiIconLayer', () => {
    const extension = new TextHaloBlurExtension();
    const props = {sdf: true, outlineWidth: 2};
    const shaders = getModelShaders(MultiIconLayer, {...props, extensions: [extension]}, extension);
    expectInjectionsApplied({
      extensionName: 'TextHaloBlurExtension',
      layerName: 'MultiIconLayer',
      injections: shaders.injections,
      shaders: shaders[0]
    });
    const [base] = getModelShaders(MultiIconLayer, props);
    expectNames('TextHaloBlurExtension', 'MultiIconLayer', base, {
      fs: ['sdf.buffer', 'sdf.outlineBuffer', 'sdf.gamma', 'distance', 'alpha']
    });
  });

  for (const Layer of [MultiIconLayer, TextBackgroundLayer, IconLayer] as any[]) {
    test(`GlobeHorizonExtension: DECKGL_FILTER_GL_POSITION of ${Layer.layerName}`, () => {
      const extension = new GlobeHorizonExtension();
      const collision = new CollisionFilterExtension();
      const shaderSets = getModelShaders(Layer, {extensions: [collision, extension]}, extension);
      const baseSets = getModelShaders(Layer, {});
      shaderSets.forEach((shaders, index) => {
        expectInjectionsApplied({
          extensionName: 'GlobeHorizonExtension',
          layerName: Layer.layerName,
          injections: shaderSets.injections,
          shaders
        });
        expectNames('GlobeHorizonExtension', Layer.layerName, baseSets[index], {
          // The last two are fields of the project module's uniform block.
          vs: ['geometry.worldPosition', 'cameraPosition', 'viewProjectionMatrix']
        });
        // Runs after the collision filter, whose sort depth would move a hidden quad back.
        const body = getHookBody(shaders.vs, 'DECKGL_FILTER_GL_POSITION');
        // deck.gl's own variable: the extension's comments also mention the collision filter.
        const collisionAt = body.indexOf('collision_common_position');
        expect(
          collisionAt,
          `${describeTarget('GlobeHorizonExtension', Layer.layerName)}: ` +
            'CollisionFilterExtension no longer sets the position in DECKGL_FILTER_GL_POSITION'
        ).toBeGreaterThanOrEqual(0);
        expect(
          collisionAt,
          'GlobeHorizonExtension must run after CollisionFilterExtension'
        ).toBeLessThan(body.indexOf('globeHorizon_'));
      });
    });
  }

  for (const perFeature of [false, true]) {
    test(`LineBlurExtension (perFeature: ${perFeature}): PathLayer with antialiasing`, () => {
      const extension = new LineBlurExtension({perFeature});
      const offset = new PathStyleExtension({offset: true});
      const props = {antialiasing: true, getPath: (d: any) => d.path};
      // The extension tells path layers apart by PathLayer's state; on any other layer it
      // injects nothing, which fails here.
      const shaders = getModelShaders(
        PathLayer,
        {...props, extensions: [offset, extension]},
        extension
      );
      expectInjectionsApplied({
        extensionName: 'LineBlurExtension',
        layerName: 'PathLayer',
        injections: shaders.injections,
        shaders: shaders[0]
      });
      // The faded edge is drawn only under these defines, set by PathLayer's `antialiasing` and
      // PathStyleExtension's offsets.
      for (const define of ['ANTIALIASING', 'PATH_STYLE_OFFSET']) {
        expect(
          new RegExp(`#define\\s+${define}\\b`).test(shaders[0].fs),
          `${describeTarget('LineBlurExtension', 'PathLayer')}: ${define} is no longer defined`
        ).toBe(true);
      }
      const [base] = getModelShaders(PathLayer, {
        ...props,
        extensions: [offset]
      });
      expectNames('LineBlurExtension', 'PathLayer', base, {
        vs: ['widthPixels', 'instanceOffsets', 'project.devicePixelRatio'],
        fs: [
          'vPathPosition',
          'vCornerOffset',
          'edgePixels',
          'isRound',
          'isCorner',
          'smoothedge',
          'picking.isActive',
          'fragColor'
        ]
      });
    });
  }

  test('FillPatternExtension: DECKGL_FILTER_GL_POSITION of SolidPolygonLayer', () => {
    const extension = new FillPatternExtension();
    const props = {getPolygon: (d: any) => d.polygon};
    const shaderSets = getModelShaders(
      SolidPolygonLayer,
      {...props, extensions: [extension]},
      extension
    );
    const baseSets = getModelShaders(SolidPolygonLayer, {
      ...props,
      extensions: [new FillStyleExtension({pattern: true})]
    });
    // Only the module added to FillStyleExtension's; deck.gl tests its own.
    const injections = shaderSets.injections.filter(({code}) => code.includes('globePattern_'));
    shaderSets.forEach((shaders, index) => {
      expectInjectionsApplied({
        extensionName: 'FillPatternExtension',
        layerName: 'SolidPolygonLayer',
        injections,
        shaders
      });
      expectNames('FillPatternExtension', 'SolidPolygonLayer', baseSets[index], {
        vs: [
          'fill_uv',
          'fillPatternScales',
          'fillPatternFrames',
          'fillPatternOffsets',
          'fill.patternUnitScale',
          'fill.patternEnabled',
          'fill.procedural',
          'geometry.worldPosition'
        ]
      });
      // Replaces the pattern coordinates that FillStyleExtension sets in the same hook.
      const body = getHookBody(shaders.vs, 'DECKGL_FILTER_GL_POSITION');
      const fillAt = body.indexOf('fill_uv =');
      expect(
        fillAt,
        `${describeTarget('FillPatternExtension', 'SolidPolygonLayer')}: ` +
          'FillStyleExtension no longer sets fill_uv in DECKGL_FILTER_GL_POSITION'
      ).toBeGreaterThanOrEqual(0);
      expect(
        fillAt,
        "FillPatternExtension's globe pattern must run after FillStyleExtension"
      ).toBeLessThan(body.indexOf('globePattern_'));
    });
  });

  for (const Layer of [SolidPolygonLayer, PathLayer] as any[]) {
    test(`FillTranslateExtension: DECKGL_FILTER_GL_POSITION of ${Layer.layerName}`, () => {
      const extension = new FillTranslateExtension();
      const props = {
        getPolygon: (d: any) => d.polygon,
        getPath: (d: any) => d.path
      };
      const shaderSets = getModelShaders(Layer, {...props, extensions: [extension]}, extension);
      const baseSets = getModelShaders(Layer, props);
      shaderSets.forEach((shaders, index) => {
        expectInjectionsApplied({
          extensionName: 'FillTranslateExtension',
          layerName: Layer.layerName,
          injections: shaderSets.injections,
          shaders
        });
        expectNames('FillTranslateExtension', Layer.layerName, baseSets[index], {
          vs: ['geometry.position', 'project_common_position_to_clipspace']
        });
      });
    });
  }

  test('FillTranslateExtension: moves the vertex before the fill pattern reads it', () => {
    const shaderSets = getModelShaders(SolidPolygonLayer, {
      getPolygon: (d: any) => d.polygon,
      extensions: [new FillPatternExtension(), new FillTranslateExtension()]
    });
    for (const shaders of shaderSets) {
      const body = getHookBody(shaders.vs, 'DECKGL_FILTER_GL_POSITION');
      const translateAt = body.indexOf('fillTranslate_');
      const fillAt = body.indexOf('fill_uv =');
      expect(translateAt, 'FillTranslateExtension injects nothing').toBeGreaterThanOrEqual(0);
      expect(
        fillAt,
        `${describeTarget('FillTranslateExtension', 'SolidPolygonLayer')}: ` +
          'FillStyleExtension no longer sets fill_uv in DECKGL_FILTER_GL_POSITION'
      ).toBeGreaterThanOrEqual(0);
      expect(
        translateAt,
        'FillTranslateExtension must move the vertex before FillStyleExtension reads it'
      ).toBeLessThan(fillAt);
    }
  });

  test('CircleBlurExtension: ScatterplotLayer', () => {
    const extension = new CircleBlurExtension();
    const shaders = getModelShaders(ScatterplotLayer, {extensions: [extension]}, extension);
    expectInjectionsApplied({
      extensionName: 'CircleBlurExtension',
      layerName: 'ScatterplotLayer',
      injections: shaders.injections,
      shaders: shaders[0]
    });
    // The blur fades by the fragment's distance from the circle's center.
    const [base] = getModelShaders(ScatterplotLayer, {});
    expectNames('CircleBlurExtension', 'ScatterplotLayer', base, {fs: ['geometry.uv']});
  });

  test('RasterColorExtension: DECKGL_FILTER_COLOR of BitmapLayer', () => {
    const extension = new RasterColorExtension();
    const shaders = getModelShaders(
      BitmapLayer,
      {bounds: [0, 0, 1, 1], extensions: [extension]},
      extension
    );
    expectInjectionsApplied({
      extensionName: 'RasterColorExtension',
      layerName: 'BitmapLayer',
      injections: shaders.injections,
      shaders: shaders[0]
    });
  });
});
