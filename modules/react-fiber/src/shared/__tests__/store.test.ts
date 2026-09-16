import type {Deck} from '@deck.gl/core';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {selectors, useStore} from '../store';

/**
 * Creates a properly typed mock Deck.gl instance
 */
function createMockDeckgl(
  overrides?: Partial<Pick<Deck, 'finalize' | 'setProps'>>
): Pick<Deck, 'finalize' | 'setProps'> {
  return {
    // oxlint-disable-next-line vitest/require-mock-type-parameters
    finalize: vi.fn(),
    // oxlint-disable-next-line vitest/require-mock-type-parameters
    setProps: vi.fn(),
    ...overrides
  };
}

describe('Store Tests', () => {
  // Reset store state after each test to prevent test pollution
  afterEach(() => {
    useStore.setState({_passedLayers: [], deckgl: null});
  });

  it('should have correct initial state (deckgl null, _passedLayers empty)', () => {
    const state = useStore.getState();

    expect(state.deckgl).toBeNull();
    expect(state._passedLayers).toStrictEqual([]);
  });

  it('should update state when setDeckgl is called', () => {
    const mockDeckgl = createMockDeckgl();

    useStore.getState().setDeckgl(mockDeckgl as unknown as Deck);

    expect(useStore.getState().deckgl).toBe(mockDeckgl);
  });

  it('should maintain _passedLayers as empty array by default', () => {
    const state = useStore.getState();

    expect(state._passedLayers).toStrictEqual([]);
  });
});

describe('selectors()', () => {
  afterEach(() => {
    useStore.setState({_passedLayers: [], deckgl: null});
  });

  it('should select deckgl from state', () => {
    const mockDeckgl = createMockDeckgl();
    useStore.setState({deckgl: mockDeckgl as unknown as Deck});

    const selected = selectors.deckgl(useStore.getState());

    expect(selected).toBe(mockDeckgl);
  });

  it('should select null deckgl when not set', () => {
    const selected = selectors.deckgl(useStore.getState());

    expect(selected).toBeNull();
  });

  it('should select setDeckgl function from state', () => {
    const selected = selectors.setDeckgl(useStore.getState());

    expect(selected).toBeTypeOf('function');
    expect(selected).toBe(useStore.getState().setDeckgl);
  });
});
