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
import {FillExtrusionLightingExtension} from '../src/fill-extrusion-lighting-extension';
import {FillPatternExtension, FillTranslateExtension} from '../src/fill-style-extensions';
import {GlobeHorizonExtension} from '../src/globe-horizon-extension';
import {LabelCharactersLayer} from '../src/label-text-layer';
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
          shaders = layer.getModels().map((model: any) => ({
            vs: stripComments(model.vs),
            fs: stripComments(model.fs)
          }));
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

/**
 * Removes GLSL comments, keeping line breaks, so that a call, statement or name that a deck.gl
 * release comments out does not count as present.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ''))
    .replace(/\/\/.*$/gm, '');
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

/**
 * Blanks the `#else` and `#elif` branches of preprocessor conditionals, keeping every offset, so
 * that braces can be matched: the branches of a conditional may each open a block that one
 * closing brace after `#endif` ends.
 */
function getFirstBranches(source: string): string {
  // For each open conditional, whether its current branch is a later one.
  const skipping: boolean[] = [];
  return source
    .split('\n')
    .map(line => {
      const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/.exec(line)?.[1];
      if (directive?.startsWith('if')) {
        skipping.push(false);
      } else if (directive === 'elif' || directive === 'else') {
        skipping[skipping.length - 1] = true;
      } else if (directive === 'endif') {
        skipping.pop();
      }
      return directive || skipping.includes(true) ? ' '.repeat(line.length) : line;
    })
    .join('\n');
}

/**
 * The body of the function whose definition matches `signature`, between its braces, found by
 * matching braces in the first branch of each preprocessor conditional. Comments must be
 * stripped first.
 */
function getFunctionBody(source: string, signature: RegExp): {start: number; end: number} | null {
  const match = signature.exec(source);
  if (!match) {
    return null;
  }
  const branches = getFirstBranches(source);
  const open = source.indexOf('{', match.index + match[0].length - 1);
  let depth = 0;
  for (let index = open; index < branches.length; index++) {
    if (branches[index] === '{') {
      depth++;
    } else if (branches[index] === '}' && --depth === 0) {
      return {start: open + 1, end: index};
    }
  }
  return null;
}

function getMainBody(source: string) {
  return getFunctionBody(source, /void\s+main\s*\([^)]*\)\s*\{/);
}

/** The body of a hook function in assembled source. */
function getHookBody(source: string, hook: string): string {
  const body = getFunctionBody(
    source,
    new RegExp(`void\\s+${escapeRegExp(hook)}\\s*\\([^)]*\\)\\s*\\{`)
  );
  return body ? source.slice(body.start, body.end) : '';
}

/**
 * Where an injection should have landed in the assembled shaders, and why it did not, or null
 * when it did:
 * - a statement of the layer's source (luma.gl injects after its first match): the statement
 *   appears once, and the injected code follows it directly;
 * - `#main-start` / `#main-end`: the injected code is inside `main`, before its closing brace;
 * - a hook: the layer calls the hook, and the injected code is in the hook function's body.
 */
function getInjectionProblem(shaders: StageSources, {key, code}: Injection): string | null {
  const marker = getMarker(code);
  const match = /^(vs|fs):(#)?([\w-]+)$/.exec(key);
  if (!match) {
    const stage = (['vs', 'fs'] as Stage[]).find(name => shaders[name].includes(key));
    if (!stage) {
      return `no shader contains the statement '${key}'`;
    }
    const source = shaders[stage];
    const at = source.indexOf(key);
    if (source.indexOf(key, at + 1) >= 0) {
      return `the statement '${key}' appears more than once, and luma.gl injects at the first`;
    }
    if (
      !source
        .slice(at + key.length)
        .trimStart()
        .startsWith(marker)
    ) {
      return `the code injected at '${key}' does not follow it`;
    }
    return null;
  }
  const [, stage, hash, name] = match as unknown as [string, Stage, string, string];
  const source = shaders[stage];
  const where = `${STAGE_NAMES[stage]} shader`;
  if (hash) {
    const at = source.indexOf(marker);
    if (at < 0) {
      return `the code injected at '${key}' is missing`;
    }
    if (name === 'decl') {
      return null;
    }
    const main = getMainBody(source);
    if (!main) {
      return `the ${where} has no main function`;
    }
    return at >= main.start && at < main.end
      ? null
      : `the code injected at '${key}' is outside main`;
  }
  if (!callsHook(source, name)) {
    return `the ${where} no longer calls the hook ${name}`;
  }
  return getHookBody(source, name).includes(marker)
    ? null
    : `the code injected into ${name} is missing`;
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
  for (const injection of injections) {
    const problem = getInjectionProblem(shaders, injection);
    expect(problem, `${context}: ${problem}`).toBeNull();
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

describe('shader source helpers', () => {
  test('ignore commented-out calls, statements and names', () => {
    const source = stripComments(`
void DECKGL_FILTER_COLOR(inout vec4 color, FragmentGeometry geometry) {
}
void main(void) {
  // DECKGL_FILTER_COLOR(fragColor, geometry);
  /* alpha = inBorder;
     edgePixels */
  fragColor = vec4(1.0);
}
`);
    expect(callsHook(source, 'DECKGL_FILTER_COLOR')).toBe(false);
    expect(
      callsHook(`${source}\nDECKGL_FILTER_COLOR(fragColor, geometry);`, 'DECKGL_FILTER_COLOR')
    ).toBe(true);
    expect(source.includes('alpha = inBorder;')).toBe(false);
    expect(hasName(source, 'edgePixels')).toBe(false);
    expect(hasName(source, 'fragColor')).toBe(true);
  });

  const MAIN_END = {key: 'fs:#main-end', code: '\n  fragColor.a *= 0.5;\n'};
  const STATEMENT = {key: 'alpha = inBorder;', code: '\n  alpha *= 0.5;\n'};
  const shaders = (fs: string) => ({vs: '', fs: stripComments(fs)});

  test('place main injections before main closing brace', () => {
    const inMain =
      'void main(void) {\n#ifdef A\n  if (a) {\n#else\n  if (b) {\n#endif\n    c();\n  }\n  fragColor.a *= 0.5;\n}\n';
    expect(getInjectionProblem(shaders(inMain), MAIN_END)).toBeNull();
    // luma.gl injects before the last closing brace, which a function after main would own.
    const afterMain = 'void main(void) {\n  b();\n}\nvoid later() {\n  fragColor.a *= 0.5;\n}\n';
    expect(getInjectionProblem(shaders(afterMain), MAIN_END)).toMatch(/outside main/);
    expect(getInjectionProblem(shaders('void later() {}\n'), MAIN_END)).toMatch(/missing/);
  });

  test('place statement injections directly after the only match', () => {
    const direct = 'void main(void) {\n  alpha = inBorder;\n  alpha *= 0.5;\n  c();\n}\n';
    expect(getInjectionProblem(shaders(direct), STATEMENT)).toBeNull();
    const later = 'void main(void) {\n  alpha = inBorder;\n  c();\n  alpha *= 0.5;\n}\n';
    expect(getInjectionProblem(shaders(later), STATEMENT)).toMatch(/does not follow/);
    // A copy of the statement in a later function, with the code injected there.
    const repeated =
      'void main(void) {\n  alpha = inBorder;\n}\nvoid later() {\n  alpha = inBorder;\n  alpha *= 0.5;\n}\n';
    expect(getInjectionProblem(shaders(repeated), STATEMENT)).toMatch(/more than once/);
  });
});

describe('shader injection targets in the installed deck.gl', () => {
  test('TextHaloBlurExtension: the outline alpha statement of LabelCharactersLayer', () => {
    const extension = new TextHaloBlurExtension();
    const props = {sdf: true, outlineWidth: 2};
    const shaders = getModelShaders(
      LabelCharactersLayer,
      {...props, extensions: [extension]},
      extension
    );
    expectInjectionsApplied({
      extensionName: 'TextHaloBlurExtension',
      layerName: 'LabelCharactersLayer',
      injections: shaders.injections,
      shaders: shaders[0]
    });
    const [base] = getModelShaders(LabelCharactersLayer, props);
    expectNames('TextHaloBlurExtension', 'LabelCharactersLayer', base, {
      fs: ['sdf.outlineBuffer', 'labelHaloGamma', 'labelEdge.foreshortening', 'distance', 'alpha']
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

  test('FillExtrusionLightingExtension: main and DECKGL_FILTER_COLOR of extruded SolidPolygonLayer', () => {
    const extension = new FillExtrusionLightingExtension();
    const props = {getPolygon: (d: any) => d.polygon, extruded: true, getElevation: 10};
    const shaderSets = getModelShaders(
      SolidPolygonLayer,
      {...props, extensions: [extension]},
      extension
    );
    const baseSets = getModelShaders(SolidPolygonLayer, props);
    // The roofs, and the walls (filled and wireframe).
    const wallShaders = shaderSets.filter(shaders => shaders.vs.includes('#define IS_SIDE_VERTEX'));
    expect(wallShaders.length).toBeGreaterThan(0);
    expect(wallShaders.length).toBeLessThan(shaderSets.length);
    shaderSets.forEach((shaders, index) => {
      expectInjectionsApplied({
        extensionName: 'FillExtrusionLightingExtension',
        layerName: 'SolidPolygonLayer',
        injections: shaderSets.injections,
        shaders
      });
      const walls = shaders.vs.includes('#define IS_SIDE_VERTEX');
      expectNames('FillExtrusionLightingExtension', 'SolidPolygonLayer', baseSets[index], {
        vs: [
          'vertexPositions',
          'elevations',
          ...(walls ? ['positions'] : []),
          'project.projectionMode',
          'PROJECTION_MODE_GLOBE',
          'geometry.normal'
        ]
      });
      // The hook must shade the color that deck.gl's lighting left, after the normal is set.
      const main = shaders.vs.slice(shaders.vs.indexOf('void calculatePosition'));
      const normalAt = main.indexOf('geometry.normal = normal');
      const lightAt = main.indexOf('lighting_getLightColor');
      const hookAt = main.search(/\bDECKGL_FILTER_COLOR\s*\(/);
      expect(normalAt, 'geometry.normal is set before DECKGL_FILTER_COLOR').toBeGreaterThan(0);
      expect(lightAt, "deck.gl's lighting runs before DECKGL_FILTER_COLOR").toBeGreaterThan(0);
      expect(hookAt).toBeGreaterThan(Math.max(normalAt, lightAt));
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
