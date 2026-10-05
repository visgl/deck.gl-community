// deck.gl-community
// SPDX-License-Identifier: MIT
import {readFileSync, readdirSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {CommunityVisualLayerSchemas} from '../src/schemas/community-visual-layers';

type LayerName = keyof typeof CommunityVisualLayerSchemas;
const parseLayer = (name: LayerName, props: Record<string, unknown>) =>
  CommunityVisualLayerSchemas[name].safeParse({'@@type': name, id: 'example', ...props});

const REQUIRED_PROPS: Partial<Record<LayerName, Record<string, unknown>>> = {
  AnimationLayer: {layer: '@@#animatedLayer', frames: {type: 'sequence', frames: []}},
  VerticalGridLayer: {xMin: 0, xMax: 100},
  TimelineLayer: {data: [], timelineStart: 0, timelineEnd: 100},
  EdgeLayer: {stylesheet: '@@#edgeStyles'}
};

describe('community visual layer schemas', () => {
  it('accepts unchanged TripsLayer props for FlameTrailLayer', () => {
    expect(
      parseLayer('FlameTrailLayer', {
        getTimestamps: '@@=timestamps',
        currentTime: 180,
        fadeTrail: false
      }).success
    ).toBe(true);
  });

  it.each(
    Object.keys(CommunityVisualLayerSchemas) as LayerName[]
  )('validates %s configuration and rejects unknown props', name => {
    expect(parseLayer(name, REQUIRED_PROPS[name] ?? {}).success).toBe(true);
    expect(parseLayer(name, {...REQUIRED_PROPS[name], unexpectedProp: true}).success).toBe(false);
    expect(parseLayer(name, {...REQUIRED_PROPS[name], opacity: 2}).success).toBe(false);
    expect(parseLayer(name, {...REQUIRED_PROPS[name], onClick: () => {}}).success).toBe(false);
  });

  it('validates the existing public playground examples', () => {
    const directory = new URL('../../../examples/playground/examples/', import.meta.url);
    let count = 0;
    for (const file of readdirSync(directory)) {
      if (!file.endsWith('.json')) continue;
      const {layers = []} = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
      for (const layer of layers) {
        const name = layer['@@type'] as LayerName;
        const schema = CommunityVisualLayerSchemas[name];
        if (!schema) continue;
        expect(schema.safeParse(layer).success, `${file}: ${name}`).toBe(true);
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(8);
  });

  it('retains inherited path props and validates direction and marker geometry', () => {
    expect(
      parseLayer('PathOutlineLayer', {
        getPath: '@@=path',
        getWidth: 3,
        widthUnits: 'pixels',
        getDashArray: [3, 1],
        _subLayerProps: {outline: {visible: false}}
      }).success
    ).toBe(true);
    expect(
      parseLayer('DependencyArrowLayer', {
        mode: 'arc',
        arcNumSegments: 30,
        getDirection: 3,
        getMarkerPlacements: [0, 0.5, 1]
      }).success
    ).toBe(true);
    expect(parseLayer('DependencyArrowLayer', {getDirection: 4}).success).toBe(false);
    expect(parseLayer('DependencyArrowLayer', {getMarkerPlacements: [2]}).success).toBe(false);
    expect(parseLayer('PathOutlineLayer', {outlineWidthScale: 0.5}).success).toBe(false);
    expect(parseLayer('PathMarkerLayer', {MarkerLayer: {'@@type': 'IconLayer'}}).success).toBe(
      false
    );
  });

  it('validates cubemap manifest faces and mipmap descriptors', () => {
    expect(
      parseLayer('SkyboxLayer', {
        cubemap: {
          shape: 'image-texture-cube',
          faces: {
            '+X': 'right.png',
            left: ['left-0.png', 'left-1.png'],
            top: {mipLevels: 'auto', template: 'top-{lod}.png'}
          }
        }
      }).success
    ).toBe(true);
    expect(
      parseLayer('SkyboxLayer', {
        cubemap: {shape: 'image-texture-cube', faces: {upside: 'up.png'}}
      }).success
    ).toBe(false);
  });

  it('validates animation schedules while keeping live child layers host-owned', () => {
    const props = {
      layer: '@@#animatedLayer',
      frames: {
        type: 'sequence',
        frames: [
          {props: {opacity: 0.5}, duration: 200, easing: '@@#ease'},
          {type: 'stagger', delay: 30, frames: [{props: {opacity: 1}, duration: 100}]}
        ]
      },
      repeat: 2,
      repeatType: 'reverse'
    };
    expect(parseLayer('AnimationLayer', props).success).toBe(true);
    expect(
      parseLayer('AnimationLayer', {...props, layer: {'@@type': 'ScatterplotLayer'}}).success
    ).toBe(false);
    expect(
      parseLayer('AnimationLayer', {
        ...props,
        frames: {
          type: 'sequence',
          frames: [{props: {}, duration: -1}]
        }
      }).success
    ).toBe(false);
  });

  it('validates text metrics and requires references for canvas and UTF-8 resources', () => {
    expect(
      parseLayer('FastTextLayer', {
        fontAtlas: '@@#fontAtlas',
        textUtf8Column: '@@#labels',
        getTextUtf8Row: '@@=index',
        getTextUtf8: '@@#readText',
        getClipRect: [0, 0, 100, 20],
        getPixelOffset: [1, 2]
      }).success
    ).toBe(true);
    expect(parseLayer('FastTextLayer', {fontAtlas: {width: 256}}).success).toBe(false);
    expect(parseLayer('FastTextLayer', {getPixelOffset: [1, 2, 3]}).success).toBe(false);
    expect(parseLayer('FastTextLayer', {textAnchor: 'left'}).success).toBe(false);
    expect(parseLayer('BlockLayer', {strokeOffset: 1.1}).success).toBe(false);
    expect(parseLayer('BlockLayer', {getSize: [10, 20, 30]}).success).toBe(false);
  });

  it('validates timeline tracks, sub-layer props and registered callbacks', () => {
    const props = {
      timelineStart: 0,
      timelineEnd: 100,
      data: [
        {id: 'track', name: 'Track', clips: [{id: 'clip', startMs: 5, endMs: 10, label: 'Clip'}]}
      ],
      clipProps: {getFillColor: [30, 80, 120], extruded: false},
      axisLabelProps: {getSize: 12},
      onScrubberDrag: '@@#updateTime'
    };
    expect(parseLayer('TimelineLayer', props).success).toBe(true);
    expect(parseLayer('TimelineLayer', {...props, clipProps: {extruded: 'yes'}}).success).toBe(
      false
    );
    expect(
      parseLayer('TimelineLayer', {...props, data: [{id: 'track', clips: [{id: 'missing-times'}]}]})
        .success
    ).toBe(false);
    expect(parseLayer('HorizonGraphLayer', {data: [1, 'two']}).success).toBe(false);
  });

  it('validates graph style rules, state overrides and layout references', () => {
    const props = {
      layout: '@@#SimpleLayout',
      stylesheet: {
        nodes: [
          {
            type: 'circle',
            fill: {attribute: 'weight', scale: {type: 'linear', range: [0, 255]}},
            ':hover': {radius: 20}
          }
        ],
        edges: [
          {
            type: 'edge',
            strokeWidth: {default: 1, selected: 3},
            decorators: [{type: 'arrow', size: 4}]
          }
        ]
      },
      rankGrid: {enabled: true, rankAccessor: '@@=rank', gridProps: {color: [20, 20, 20, 255]}}
    };
    expect(parseLayer('GraphLayer', props).success).toBe(true);
    expect(parseLayer('GraphLayer', {...props, layout: {type: 'simple'}}).success).toBe(false);
    expect(
      parseLayer('GraphLayer', {
        ...props,
        stylesheet: {
          nodes: [{type: 'circle', raduis: 10}]
        }
      }).success
    ).toBe(false);
    expect(
      parseLayer('GraphLayer', {
        ...props,
        stylesheet: {
          nodes: [{type: 'circle', ':hover': {unknown: 10}}]
        }
      }).success
    ).toBe(false);
    expect(parseLayer('EdgeLayer', {stylesheet: {stroke: 'black'}}).success).toBe(false);
    expect(
      parseLayer('GraphGridLayer', {direction: 'horizontal', getLabel: '@@=label'}).success
    ).toBe(true);
  });

  it('emits JSON Schema for every layer, including recursive schedules and graph styles', () => {
    for (const schema of Object.values(CommunityVisualLayerSchemas)) {
      expect(() => z.toJSONSchema(schema)).not.toThrow();
    }
  });
});
