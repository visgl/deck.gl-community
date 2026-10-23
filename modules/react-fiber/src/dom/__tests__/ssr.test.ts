// Invariant: DeckGL roots never touch `document` or `window` during render. All DOM
// resolution happens in effects, so every root entry point must server-render in plain Node.
import {createElement} from 'react';
import type {ComponentType} from 'react';
import {renderToString} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {createDeckGL, DeckGL} from '../index';
import {DeckGL as MapboxDeckGL} from '../mapbox';
import {DeckGL as MapLibreDeckGL} from '../maplibre';
import {DeckGL as CompatMapboxDeckGL} from '../../compat/mapbox';
import {DeckGL as CompatMapLibreDeckGL} from '../../compat/maplibre';

function renderOnServer(Component: ComponentType<any>, props: object = {}): string {
  return renderToString(createElement(Component, props, null));
}

describe('server rendering without a DOM', () => {
  it('runs without document or window', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('renders the standalone root markup', () => {
    expect(renderOnServer(DeckGL)).toBe(
      '<div id="deckgl-fiber-wrapper"><canvas id="deckgl-fiber-canvas"></canvas></div>'
    );
  });

  it.each([
    ['/mapbox', MapboxDeckGL],
    ['/maplibre', MapLibreDeckGL],
    ['/compat/mapbox', CompatMapboxDeckGL],
    ['/compat/maplibre', CompatMapLibreDeckGL]
  ])('renders the %s provider root as empty markup', (_name, Component) => {
    expect(renderOnServer(Component, {interleaved: true})).toBe('');
    expect(renderOnServer(Component)).toBe('');
  });

  it('does not create an external overlay during server rendering', () => {
    const createExternalOverlay = vi.fn(() => ({finalize: vi.fn(), setProps: vi.fn()}));
    const CustomDeckGL = createDeckGL({createExternalOverlay});
    expect(renderOnServer(CustomDeckGL, {interleaved: true})).toBe('');
    expect(createExternalOverlay).not.toHaveBeenCalled();
  });
});
