import {
  type Effect,
  type Layer,
  LightingEffect,
  log,
  MapView,
  PostProcessEffect,
  type View,
  type Widget
} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import * as fc from 'fast-check';
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {formatElementId, formatPathSegment} from '../element-ids';
import {createTestRoot} from './test-renderer';
import {TestWidget} from './test-widget';

/** Keys that look like the format's own syntax, or like another key once escaped. */
const AWKWARD_KEYS = [
  '',
  '/',
  '#',
  ':',
  '%',
  '-',
  '0',
  '1',
  '#0',
  '#1',
  'a/b',
  'a-b',
  '%2F',
  '%2D',
  '%23',
  '#1/x',
  'ScatterplotLayer',
  'a b',
  'é'
];

const keyArbitrary = fc.oneof(fc.constantFrom(...AWKWARD_KEYS), fc.string({unit: 'grapheme'}));

type Segment = {key: string} | {index: number};

const segmentArbitrary: fc.Arbitrary<Segment> = fc.oneof(
  keyArbitrary.map(key => ({key})),
  fc.nat({max: 20}).map(index => ({index}))
);

function formatId(base: string, segments: Segment[]): string {
  return formatElementId(
    base,
    segments.map(segment =>
      'key' in segment ? formatPathSegment(segment.key, 0) : formatPathSegment(null, segment.index)
    )
  );
}

/** Reads an id back into its base and segments, or returns `null` for any other string. */
function parseId(id: string): {base: string; segments: Segment[]} | null {
  const [encodedBase, ...rest] = id.split('/');
  try {
    const base = decodeURIComponent(encodedBase);
    if (encodeURIComponent(base) !== encodedBase) {
      return null;
    }
    const segments: Segment[] = [];
    for (const segment of rest) {
      if (segment.startsWith('#')) {
        if (!/^#\d+$/.test(segment)) {
          return null;
        }
        segments.push({index: Number(segment.slice(1))});
      } else {
        const key = decodeURIComponent(segment);
        // Only the escaped form of a key is a segment, so `-` and other escapable text is not.
        if (formatPathSegment(key, 0) !== segment) {
          return null;
        }
        segments.push({key});
      }
    }
    return {base, segments};
  } catch {
    return null;
  }
}

describe('element id format', () => {
  it('reads back every id it writes, so no two inputs share an id', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom('ScatterplotLayer', 'lighting-effect', 'a/b', '#', '%'),
          fc.string()
        ),
        fc.array(segmentArbitrary, {maxLength: 6}),
        (base, segments) => {
          expect(parseId(formatId(base, segments))).toEqual({base, segments});
        }
      ),
      {numRuns: 2000}
    );
  });

  it('never writes a key segment that reads as an index, a separator or a sublayer suffix', () => {
    fc.assert(
      fc.property(keyArbitrary, key => {
        const segment = formatPathSegment(key, 0);
        expect(segment.startsWith('#')).toBe(false);
        expect(segment).not.toMatch(/[/-]/);
      })
    );
  });

  it('keeps sublayer ids, built as `${id}-${suffix}`, outside the format', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArbitrary, {maxLength: 4, minLength: 1}),
        fc.string().filter(suffix => !suffix.includes('/')),
        (segments, suffix) => {
          expect(parseId(`${formatId('GeoJsonLayer', segments)}-${suffix}`)).toBeNull();
        }
      ),
      {numRuns: 1000}
    );
  });

  it('keeps built-in class names and effect ids unchanged as the base', () => {
    expect(formatElementId('ScatterplotLayer', [])).toBe('ScatterplotLayer');
    expect(formatElementId('lighting-effect', [])).toBe('lighting-effect');
    expect(formatElementId('MapView', ['roads'])).toBe('MapView/roads');
  });
});

/** A random tree of components, fragments, views and layers, none of them with an id. */
type TreeNode = {
  kind: 'component' | 'fragment' | 'layer' | 'view';
  key: string | null;
  children: TreeNode[];
};

const {children: forestArbitrary} = fc.letrec<{tree: TreeNode; children: TreeNode[]}>(tie => ({
  children: fc.array(tie('tree'), {maxLength: 3}).map(children => {
    // React keys must be unique among siblings, so a repeated key is dropped.
    const seen = new Set<string>();
    return children.map(child => {
      if (child.key !== null && seen.has(child.key)) {
        return {...child, key: null};
      }
      if (child.key !== null) {
        seen.add(child.key);
      }
      return child;
    });
  }),
  tree: fc.record({
    children: fc.oneof(
      {depthSize: 'small', withCrossShrink: true},
      fc.constant([]),
      tie('children')
    ),
    key: fc.option(keyArbitrary, {freq: 2, nil: null}),
    kind: fc.constantFrom<TreeNode['kind']>('component', 'fragment', 'layer', 'view')
  }) as fc.Arbitrary<TreeNode>
}));

function Group({children}: {children?: React.ReactNode}) {
  return React.createElement(React.Fragment, null, children);
}

function renderTree(node: TreeNode, insideView: boolean): React.ReactElement {
  const children = node.children.map(child =>
    renderTree(child, insideView || node.kind === 'view')
  );
  const key = node.key ?? undefined;
  switch (node.kind) {
    case 'component':
      return React.createElement(Group, {key}, ...children);
    case 'fragment':
      return React.createElement(React.Fragment, {key}, ...children);
    case 'layer':
      return React.createElement(
        'deckLayer',
        {key, layer: new ScatterplotLayer({data: []})},
        ...children
      );
    case 'view':
      // deck.gl does not nest views, so a view inside a view becomes a component.
      return insideView
        ? React.createElement(Group, {key}, ...children)
        : React.createElement('deckView', {key, view: new MapView()}, ...children);
  }
}

describe('element ids in a rendered tree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives every layer and view a distinct id that stays the same between renders', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockReturnValue(() => {});
    const errorSpy = vi.spyOn(console, 'error');

    await fc.assert(
      fc.asyncProperty(forestArbitrary, async trees => {
        const {root, deck, unmount} = createTestRoot();
        const render = () =>
          React.act(async () => {
            root.render(
              React.createElement(React.Fragment, null, ...trees.map(t => renderTree(t, false)))
            );
          });
        const getIds = (descriptors: (Layer | View)[]) => descriptors.map(({id}) => id);

        try {
          await render();
          const layerIds = getIds(deck.layers);
          const viewIds = getIds(deck.views);
          expect(new Set(layerIds).size).toBe(layerIds.length);
          expect(new Set(viewIds).size).toBe(viewIds.length);
          for (const id of [...layerIds, ...viewIds]) {
            expect(parseId(id)).not.toBeNull();
          }

          // New instances at the same positions get the same ids, so deck.gl matches them.
          await render();
          expect(getIds(deck.layers)).toEqual(layerIds);
          expect(getIds(deck.views)).toEqual(viewIds);
        } finally {
          React.act(() => unmount());
        }
      }),
      {numRuns: 150}
    );

    expect(
      warnSpy.mock.calls.filter(([message]) => String(message).includes('share the id'))
    ).toEqual([]);
    // React reports duplicate keys with console.error; the generator never makes them.
    expect(errorSpy.mock.calls.filter(([message]) => String(message).includes('key'))).toEqual([]);
  });
});

describe('duplicate id warnings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderAndCollectWarnings(
    element: React.ReactElement,
    configure: Parameters<ReturnType<typeof createTestRoot>['root']['configure']>[0] = {}
  ): Promise<string[]> {
    const warnSpy = vi.spyOn(log, 'warn').mockReturnValue(() => {});
    const {root, unmount} = createTestRoot();
    try {
      root.configure(configure);
      await React.act(async () => {
        root.render(element);
      });
      return warnSpy.mock.calls.map(([message]) => String(message));
    } finally {
      React.act(() => unmount());
    }
  }

  it('names an explicit id that equals a generated one', async () => {
    const warnings = await renderAndCollectWarnings(
      React.createElement(
        React.Fragment,
        null,
        React.createElement('deckLayer', {key: 'a', layer: new ScatterplotLayer({data: []})}),
        React.createElement('deckLayer', {
          layer: new ScatterplotLayer({data: [], id: 'ScatterplotLayer/a'})
        })
      )
    );

    expect(warnings).toContain(
      'Two layers share the id "ScatterplotLayer/a": ScatterplotLayer from <deckLayer> and ' +
        'ScatterplotLayer from <deckLayer>'
    );
  });

  it('names a layers prop entry that shares an id with a JSX layer', async () => {
    const warnings = await renderAndCollectWarnings(
      React.createElement(
        React.Fragment,
        null,
        React.createElement('deckLayer', {layer: new ScatterplotLayer({data: [], id: 'points'})}),
        React.createElement('deckLayer', {layer: new ScatterplotLayer({data: []})})
      ),
      {layers: [[new ScatterplotLayer({data: [], id: 'points'})], null]}
    );

    expect(warnings).toEqual([
      'Two layers share the id "points": ScatterplotLayer from <deckLayer> and ScatterplotLayer ' +
        'from the layers prop'
    ]);
  });

  it('names JSX views with one id, but not a prop view that replaces a JSX view', async () => {
    const warnings = await renderAndCollectWarnings(
      React.createElement(
        React.Fragment,
        null,
        React.createElement('deckView', {view: new MapView({id: 'main'})}),
        React.createElement('deckView', {view: new MapView({id: 'main'})}),
        React.createElement('deckView', {view: new MapView({id: 'minimap'})})
      ),
      {views: [new MapView({id: 'minimap'})]}
    );

    expect(warnings).toEqual([
      'Two views share the id "main": MapView from <deckView> and MapView from <deckView>'
    ]);
  });

  it('stays quiet in production builds', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const warnings = await renderAndCollectWarnings(
        React.createElement(
          React.Fragment,
          null,
          React.createElement('deckLayer', {layer: new ScatterplotLayer({data: [], id: 'x'})}),
          React.createElement('deckLayer', {layer: new ScatterplotLayer({data: [], id: 'x'})})
        )
      );
      expect(warnings).toEqual([]);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});

describe('merging props with JSX elements that have generated ids', () => {
  function createInvert() {
    return new PostProcessEffect({fs: '', name: 'invert', passes: []} as never, {} as never);
  }

  /** Renders `jsx` with `effects` and `widgets` props in a new test root. */
  async function renderWithProps(
    jsx: React.ReactElement[],
    props: {effects?: Effect[]; widgets?: Widget[]}
  ) {
    const test = createTestRoot();
    test.root.configure(props);
    await React.act(async () => {
      test.root.render(React.createElement(React.Fragment, null, ...jsx));
    });
    return test;
  }

  it('keeps every effect from props, in either order, after one has left JSX', async () => {
    // An effect rendered in JSX gets its id in place, and keeps it after it leaves JSX.
    const reused = createInvert();
    const lighting = new LightingEffect();
    const first = await renderWithProps(
      [
        React.createElement('deckEffect', {effect: lighting}),
        React.createElement('deckEffect', {effect: reused})
      ],
      {}
    );
    expect(reused.id).toBe('invert-pass/#1');
    React.act(() => first.unmount());

    for (const order of ['reused first', 'new first']) {
      const fresh = createInvert();
      const effects = order === 'reused first' ? [reused, fresh] : [fresh, reused];
      const test = await renderWithProps([React.createElement('deckEffect', {effect: lighting})], {
        effects
      });
      try {
        expect(new Set(test.deck.effects)).toEqual(new Set([lighting, reused, fresh]));
      } finally {
        React.act(() => test.unmount());
      }
    }
  });

  it('keeps every widget from props, in either order, after one has left JSX', async () => {
    const reused = new TestWidget({});
    const first = await renderWithProps(
      [
        React.createElement('deckWidget', {widget: new TestWidget({id: 'legend'})}),
        React.createElement('deckWidget', {widget: reused})
      ],
      {}
    );
    expect(reused.id).toBe('test-widget/#1');
    React.act(() => first.unmount());

    for (const order of ['reused first', 'new first']) {
      const fresh = new TestWidget({});
      const widgets = order === 'reused first' ? [reused, fresh] : [fresh, reused];
      const legend = new TestWidget({id: 'legend'});
      const test = await renderWithProps([React.createElement('deckWidget', {widget: legend})], {
        widgets
      });
      try {
        expect(new Set(test.deck.widgets)).toEqual(new Set([legend, reused, fresh]));
      } finally {
        React.act(() => test.unmount());
      }
    }
  });

  it('still lets a props entry replace a JSX element by its own id', async () => {
    const jsxLighting = new LightingEffect();
    const propLighting = new LightingEffect();
    const test = await renderWithProps(
      [
        React.createElement('deckEffect', {effect: createInvert()}),
        React.createElement('deckEffect', {effect: jsxLighting})
      ],
      {effects: [propLighting]}
    );
    try {
      expect(jsxLighting.id).toBe('lighting-effect/#1');
      expect(test.deck.effects).toContain(propLighting);
      expect(test.deck.effects).not.toContain(jsxLighting);
    } finally {
      React.act(() => test.unmount());
    }
  });
});
