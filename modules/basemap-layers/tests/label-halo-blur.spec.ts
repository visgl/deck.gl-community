/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {MAX_HALO_SUBLAYERS, MVTLabelLayer} from '../src/mvt-label-layer.ts';
import {GlobeHorizonExtension} from '../src/globe-horizon-extension.ts';
import {getHaloBlurGamma, TextHaloBlurExtension} from '../src/text-halo-blur-extension.ts';

const ATLAS = {fontSize: 64, radius: 24};

const feature = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0, 0]},
  properties: {layerName: 'place', rank: 2}
};

const WHITE_HALO = {'text-halo-color': '#ffffff', 'text-halo-width': 1};

function haloLayer(paint: Record<string, unknown>, zoom = 7.6, data: unknown[] = []): any {
  return new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout: {'text-field': 'Label'}, paint},
    zoom,
    data
  } as any);
}

/** Runs `updateState` outside deck.gl and returns the layer's text sublayers. */
function renderTextLayers(layer: any, dataChanged = true, context: any = {}): any[] {
  layer.context = context;
  layer.internalState = {subLayers: []} as any;
  layer.state = layer.state || {};
  layer.setState = (partial: Record<string, unknown>) => Object.assign(layer.state, partial);
  layer.updateState({changeFlags: {dataChanged}} as any);
  return layer.renderLayers().filter((sublayer: any) => /-text(-\d+)?$/.test(sublayer.id));
}

/**
 * The text sublayers that draw halos: with several halos, every one but the invisible `text`
 * sublayer, which only places the labels.
 */
function haloTextLayers(texts: any[]): any[] {
  return texts.length > 1 ? texts.filter(text => text.id !== 'labels-text') : texts;
}

/** The label a text sublayer draws for each of `rows`, read at the row's index in its data. */
function drawnText(text: any, rows: unknown[]): unknown[] {
  const data: unknown[] = text.props.data;
  return rows.map(row => {
    const index = data.indexOf(row);
    return text.props.getText(row, {index, data, target: []});
  });
}

describe('text-halo-blur distance', () => {
  test('converts blur pixels to signed distance as MapLibre widens the halo edge', () => {
    // MapLibre fades the halo over 1.19 px per px of blur on each side of its edge. On 16 px text
    // from a 64 px atlas, that is 4.76 atlas pixels, and the distance field spans 24 atlas pixels.
    expect(getHaloBlurGamma(1, 16, ATLAS)).toBeCloseTo((1.19 * 4) / 24, 3);
    expect(getHaloBlurGamma(2, 16, ATLAS)).toBeCloseTo((2 * 1.19 * 4) / 24, 3);
  });

  test('the same blur is a smaller distance on larger text', () => {
    expect(getHaloBlurGamma(1, 32, ATLAS)).toBeCloseTo(getHaloBlurGamma(1, 16, ATLAS) / 2, 3);
  });

  test('no blur adds no distance', () => {
    expect(getHaloBlurGamma(0, 16, ATLAS)).toBe(0);
    expect(getHaloBlurGamma(-1, 16, ATLAS)).toBe(0);
    expect(getHaloBlurGamma(1, 0, ATLAS)).toBe(0);
  });
});

describe('label halo blur', () => {
  test('the default text-halo-blur of 0 keeps the halo sharp', () => {
    expect(haloLayer(WHITE_HALO).getLabelHalo(feature).outlineBlur).toBe(0);
  });

  test('text-halo-blur is evaluated per feature and converted for the text size', () => {
    const layer = haloLayer({...WHITE_HALO, 'text-halo-blur': ['/', ['get', 'rank'], 2]});
    expect(layer.getLabelHalo(feature).outlineBlur).toEqual(getHaloBlurGamma(1, 16, ATLAS));
  });

  test('a blur without a halo draws nothing', () => {
    const layer = haloLayer({'text-halo-color': '#ffffff', 'text-halo-blur': 2});
    expect(layer.getLabelHalo(feature)).toBeNull();
  });

  test('the text sublayer gets the blur and the blur extension', () => {
    const [text] = renderTextLayers(
      haloLayer({...WHITE_HALO, 'text-halo-blur': 1}, 7.6, [feature])
    );
    expect(text.props.textHaloBlurGamma).toEqual(getHaloBlurGamma(1, 16, ATLAS));
    expect(text.props.extensions.some((e: unknown) => e instanceof TextHaloBlurExtension)).toBe(
      true
    );
    // Beside the globe horizon extension, which every label sublayer has.
    expect(text.props.extensions.some((e: unknown) => e instanceof GlobeHorizonExtension)).toBe(
      true
    );
  });

  test('every text sublayer has the same extensions, and only the halo sublayers blur', () => {
    const features = [0, 1, 2].map(blur => ({
      ...feature,
      properties: {...feature.properties, blur}
    }));
    const layer = haloLayer({...WHITE_HALO, 'text-halo-blur': ['get', 'blur']}, 7.6, features);
    const texts = renderTextLayers(layer);
    const [placement] = texts;
    expect(placement.id).toBe('labels-text');
    expect(placement.props.textHaloBlurGamma ?? 0).toBe(0);
    for (const text of texts) {
      expect(text.props.extensions).toEqual(placement.props.extensions);
    }
  });

  test('halos that differ only in blur draw separate sublayers', () => {
    const features = [0, 1, 0, 1.05, 2].map(blur => ({
      ...feature,
      properties: {...feature.properties, blur}
    }));
    const layer = haloLayer({...WHITE_HALO, 'text-halo-blur': ['get', 'blur']}, 7.6, features);
    const texts = haloTextLayers(renderTextLayers(layer));
    const rows = layer.state.labelData;
    // Blurs are rounded to quarter pixels, so 1 and 1.05 share a sublayer.
    expect(texts.map(text => text.props.textHaloBlurGamma)).toEqual([
      0,
      getHaloBlurGamma(1, 16, ATLAS),
      getHaloBlurGamma(2, 16, ATLAS)
    ]);
    expect(texts.map(text => drawnText(text, rows))).toEqual([
      ['Label', undefined, 'Label', undefined, undefined],
      [undefined, 'Label', undefined, 'Label', undefined],
      [undefined, undefined, undefined, undefined, 'Label']
    ]);
  });

  test('on WebGPU, which draws no blur, halos that differ only in blur share one sublayer', () => {
    const features = [0, 1, 2].map(blur => ({
      ...feature,
      properties: {...feature.properties, blur}
    }));
    const layer = haloLayer({...WHITE_HALO, 'text-halo-blur': ['get', 'blur']}, 7.6, features);
    const texts = renderTextLayers(layer, true, {device: {type: 'webgpu'}});
    expect(texts).toHaveLength(1);
    expect(texts[0].props.textHaloBlurGamma).toBe(0);
    expect(drawnText(texts[0], layer.state.labelData)).toEqual(['Label', 'Label', 'Label']);
  });

  test('distinct blurs are capped like other halos', () => {
    const features = Array.from({length: 40}, (_, blur) => ({
      ...feature,
      properties: {...feature.properties, blur}
    }));
    const layer = haloLayer({...WHITE_HALO, 'text-halo-blur': ['get', 'blur']}, 7.6, features);
    const texts = haloTextLayers(renderTextLayers(layer));
    expect(texts).toHaveLength(MAX_HALO_SUBLAYERS);
    const rows = layer.state.labelData;
    const drawn = texts.map(text => drawnText(text, rows));
    for (let index = 0; index < rows.length; index++) {
      expect(drawn.filter(labels => labels[index] === 'Label')).toHaveLength(1);
    }
  });

  test('a zoom-dependent blur is re-evaluated at a new zoom step', () => {
    const paint = {...WHITE_HALO, 'text-halo-blur': ['step', ['zoom'], 0, 10, 2]};
    const layer = haloLayer(paint, 8, [feature]);
    expect(renderTextLayers(layer)[0].props.textHaloBlurGamma).toBe(0);
    const zoomed = haloLayer(paint, 11, [feature]);
    zoomed.state = layer.state;
    expect(renderTextLayers(zoomed, false)[0].props.textHaloBlurGamma).toEqual(
      getHaloBlurGamma(2, 16, ATLAS)
    );
  });
});

describe('TextHaloBlurExtension', () => {
  const extension = new TextHaloBlurExtension();

  test('injects the blur into the outline alpha on WebGL', () => {
    const shaders: any = extension.getShaders.call(
      {context: {device: {type: 'webgl'}}} as any,
      extension
    );
    expect(shaders.modules.map((module: any) => module.name)).toEqual(['textHaloBlur']);
    expect(Object.keys(shaders.inject)).toEqual(['alpha = inBorder;']);
  });

  test('leaves the shaders unchanged on WebGPU', () => {
    expect(
      extension.getShaders.call({context: {device: {type: 'webgpu'}}} as any, extension)
    ).toEqual({});
  });

  test('sets the blur uniforms when drawing: capped unless the layer draws style glyphs', () => {
    const set: unknown[] = [];
    for (const props of [
      {textHaloBlurGamma: 0.2},
      {textHaloBlurGamma: 0.2, textHaloBlurCapped: false}
    ]) {
      extension.draw.call(
        {
          context: {device: {type: 'webgl'}},
          props,
          setShaderModuleProps: (moduleProps: unknown) => set.push(moduleProps)
        } as any,
        {} as any,
        extension
      );
    }
    expect(set).toEqual([
      {textHaloBlur: {gamma: 0.2, capped: 1}},
      {textHaloBlur: {gamma: 0.2, capped: 0}}
    ]);
  });
});
