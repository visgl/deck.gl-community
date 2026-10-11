import {describe, expect, test} from 'vitest';
import {getSpriteIconMapping} from '../src/sprite';
import {MVTLabelLayer} from '../src/mvt-label-layer';

/** A label layer with one row, ready to render its sublayers outside a deck. */
function createLabelLayer(layout: Record<string, unknown>): MVTLabelLayer {
  const layer = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    mode: 'globe',
    zoom: 1,
    styleLayer: {layout, paint: {}},
    spriteAtlases: [
      {
        id: 'default',
        image: 'https://example.com/sprite.png',
        mapping: getSpriteIconMapping({square: {x: 0, y: 0, width: 16, height: 16}})
      }
    ]
  });
  layer.state = {labelData: [{position: [0, 0]}]};
  layer.context = {} as any;
  layer.internalState = {subLayers: []} as any;
  return layer;
}

describe('label draw parameters', () => {
  // The quads of deck.gl's text and icon layers wind clockwise on screen, and `GlobeView` culls
  // back faces by default: without `cullMode: 'none'` no label or icon draws on a globe.
  test('text and icon sublayers draw without face culling or a depth test', () => {
    const layer = createLabelLayer({'text-field': 'A', 'icon-image': 'square'});
    const sublayers = layer.renderLayers();
    expect(sublayers.map((sublayer: any) => sublayer.id)).toEqual([
      'labels-icons-default',
      'labels-text'
    ]);
    for (const sublayer of sublayers) {
      expect(sublayer.props.parameters).toMatchObject({cullMode: 'none', depthTest: false});
    }
  });
});
