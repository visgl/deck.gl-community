import {renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useDeckgl} from '../hooks';

// Mock the shared module
vi.mock(import('../../shared'), () => {
  // oxlint-disable-next-line vitest/require-mock-type-parameters
  const mockUseStore = vi.fn();
  const mockSelectors = {
    deckgl: vi.fn<(state: unknown) => unknown>(state => state.deckgl),
    setDeckgl: vi.fn<(state: unknown) => unknown>(state => state.setDeckgl)
  };

  return {
    isBrowserEnvironment: false,
    mockSelectors,
    mockUseStore,
    selectors: mockSelectors,
    useStore: mockUseStore
  };
});

// Get the mocks after they've been set up
const {mockUseStore, mockSelectors} = (await import('../../shared')) as unknown as {
  mockUseStore: ReturnType<typeof vi.fn>;
  mockSelectors: {
    deckgl: ReturnType<typeof vi.fn>;
    setDeckgl: ReturnType<typeof vi.fn>;
  };
};

describe('Dom Hooks Tests', () => {
  describe('useDeckgl()', () => {
    it('should return deckgl instance from store', () => {
      // Arrange
      const mockDeckgl = {
        finalize: vi.fn<() => void>(),
        setProps: vi.fn<() => void>()
      };
      mockUseStore.mockReturnValue(mockDeckgl);

      // Act
      const {result} = renderHook(() => useDeckgl());

      // Assert
      expect(result.current).toBe(mockDeckgl);
      expect(mockUseStore).toHaveBeenCalledWith(mockSelectors.deckgl);
    });

    it('should update when store changes', () => {
      // Arrange
      const mockDeckgl1 = {
        finalize: vi.fn<() => void>(),
        id: 'deck1',
        setProps: vi.fn<() => void>()
      };
      const mockDeckgl2 = {
        finalize: vi.fn<() => void>(),
        id: 'deck2',
        setProps: vi.fn<() => void>()
      };

      mockUseStore.mockReturnValue(mockDeckgl1);
      const {result, rerender} = renderHook(() => useDeckgl());

      // Act - simulate store change
      mockUseStore.mockReturnValue(mockDeckgl2);
      rerender();

      // Assert
      expect(result.current).toBe(mockDeckgl2);
    });
  });
});
