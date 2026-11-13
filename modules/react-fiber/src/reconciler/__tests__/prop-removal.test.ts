import {Deck} from '@deck.gl/core';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {createRoot, unmountAtNode} from '../renderer';
import type {DeckGLConfiguration} from '../types';
import {createTestRoot} from './test-renderer';

/**
 * In React, removing a prop is a change: the component renders without it. deck.gl's
 * `setProps` merges into the props it already has, so a prop that is simply left out keeps its
 * old value. The root must send each removed prop back to its deck.gl default.
 */
describe('removing a prop', () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  function setup(initial: DeckGLConfiguration) {
    const test = createTestRoot();
    unmount = test.unmount;
    // `createTestRoot` configures once; the second configure applies `initial` with setProps.
    test.root.configure(initial);
    test.deck.setProps.mockClear();
    return test;
  }

  function lastSetProps(deck: {setProps: ReturnType<typeof vi.fn>}): Record<string, unknown> {
    const {calls} = deck.setProps.mock;
    return calls[calls.length - 1]![0] as Record<string, unknown>;
  }

  it('sends deck.gl default onError when onError is removed', () => {
    const onError = vi.fn();
    const {deck, root} = setup({onError});

    root.configure({});

    const props = lastSetProps(deck);
    expect(Object.hasOwn(props, 'onError')).toBe(true);
    expect(props.onError).toBe(Deck.defaultProps.onError);
  });

  it('sends deck.gl default parameters when parameters are removed', () => {
    const {deck, root} = setup({parameters: {blend: true, blendColorSrcFactor: 'src-alpha'}});

    root.configure({});

    expect(lastSetProps(deck).parameters).toStrictEqual(Deck.defaultProps.parameters);
  });

  it('sends a null viewState when a controlled viewState is removed', () => {
    const {deck, root} = setup({viewState: {latitude: 1, longitude: 2, zoom: 3}});

    root.configure({});

    const props = lastSetProps(deck);
    expect(Object.hasOwn(props, 'viewState')).toBe(true);
    expect(props.viewState).toBeNull();
  });

  it('sends the default for any removed Deck prop, such as an event callback', () => {
    const {deck, root} = setup({onClick: vi.fn()});

    root.configure({});

    const props = lastSetProps(deck);
    expect(Object.hasOwn(props, 'onClick')).toBe(true);
    expect(props.onClick).toBe(Deck.defaultProps.onClick);
  });

  it('sends undefined for a removed prop that deck.gl has no default for', () => {
    const {deck, root} = setup({customOverlayOption: 1} as DeckGLConfiguration);

    root.configure({});

    const props = lastSetProps(deck);
    expect(Object.hasOwn(props, 'customOverlayOption')).toBe(true);
    expect(props.customOverlayOption).toBeUndefined();
  });

  it('leaves props that are still passed alone', () => {
    const onError = vi.fn();
    const {deck, root} = setup({onError, pickingRadius: 5});

    root.configure({onError});

    const props = lastSetProps(deck);
    expect(props.onError).toBe(onError);
    expect(props.pickingRadius).toBe(Deck.defaultProps.pickingRadius);
  });

  it('resets a removed prop once, not on every later configure', () => {
    const {deck, root} = setup({pickingRadius: 5});

    root.configure({});
    root.configure({});

    expect(Object.hasOwn(lastSetProps(deck), 'pickingRadius')).toBe(false);
  });

  it('treats a prop set to undefined as removed, as React does', () => {
    const onLoad = vi.fn();
    const {deck, root} = setup({onLoad});

    root.configure({onLoad: undefined});

    expect(lastSetProps(deck).onLoad).toBe(Deck.defaultProps.onLoad);
  });

  it('leaves an undefined prop out of the props that create the instance', () => {
    const createExternalOverlay = vi.fn(() => ({finalize: vi.fn(), setProps: vi.fn()}));
    const node = document.createElement('div');
    const root = createRoot(node, {createExternalOverlay: createExternalOverlay as never});
    unmount = () => unmountAtNode(node);

    root.configure({onLoad: undefined, pickingRadius: 2});

    const created = createExternalOverlay.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.hasOwn(created, 'onLoad')).toBe(false);
    expect(created.pickingRadius).toBe(2);
  });

  it('does not reset props that only take effect when deck.gl is created', () => {
    const {deck, root} = setup({
      deviceProps: {type: 'webgl'},
      eventRecognizerOptions: {},
      touchAction: 'pan-y'
    });

    root.configure({});

    const props = lastSetProps(deck);
    for (const key of ['canvas', 'deviceProps', 'eventRecognizerOptions', 'touchAction']) {
      expect(Object.hasOwn(props, key)).toBe(false);
    }
  });

  it('does not reset the layers, views, widgets or effects props, which the root merges with JSX', () => {
    const {deck, root} = setup({effects: [], layers: [], widgets: []});

    root.configure({});

    const props = lastSetProps(deck);
    expect(props.layers).toStrictEqual([]);
    expect(props.widgets).toStrictEqual([]);
    expect(props.effects).toStrictEqual([]);
  });
});
