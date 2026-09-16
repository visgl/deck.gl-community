import type {Layer, LayersList, View} from '@deck.gl/core';
import {vi} from 'vitest';

import {createRoot} from '../renderer';
import type {RootElement} from '../types';

/**
 * Test renderer that mocks the Deck.gl methods used by the reconciler
 *
 * **Methods implemented (matching Deck API):**
 * - `setProps(props)` - Called by reconciler in replaceContainerChildren
 * - `finalize()` - Called by reconciler in unmountAtNode
 *
 * @see {@link https://deck.gl/docs/api-reference/core/deck Deck API Reference}
 */
export class TestDeckRenderer {
  public layers: Layer[] = [];
  public views: View[] = [];

  /**
   * Updates deck.gl properties
   * Matches: `Deck.prototype.setProps(props: Partial<DeckProps>): void`
   */
  setProps = vi.fn((props: {layers?: LayersList; views?: View[] | null}): void => {
    if (props.layers !== undefined) {
      this.layers = props.layers.filter(Boolean) as Layer[];
    }
    if (props.views !== undefined) {
      this.views = props.views ? [...props.views] : [];
    }
  });

  /**
   * Frees all resources
   * Matches: `Deck.prototype.finalize(): void`
   */
  finalize = vi.fn<() => void>();

  // Test helpers
  findLayerById(id: string): Layer | undefined {
    return this.layers.find(l => l.id === id);
  }

  getLayerIds(): string[] {
    return this.layers.map(l => l.id);
  }

  expectLayer(id: string): Layer {
    const layer = this.findLayerById(id);
    if (!layer) {
      throw new Error(
        `Expected layer "${id}" but got: ${this.getLayerIds().join(', ') || '(none)'}`
      );
    }
    return layer;
  }

  expectLayerCount(count: number): void {
    if (this.layers.length !== count) {
      throw new Error(`Expected ${count} layers but got ${this.layers.length}`);
    }
  }
}

/**
 * Creates a test root with TestDeckRenderer
 */
export function createTestRoot() {
  const rootElement = document.createElement('div') as RootElement;
  const root = createRoot(rootElement);
  const deck = new TestDeckRenderer();

  root.configure({canvas: rootElement as unknown as HTMLCanvasElement});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.store.setState({deckgl: deck as any});

  return {
    deck,
    // eslint-disable-next-line @typescript-eslint/require-await
    async flush() {
      // eslint-disable-next-line @typescript-eslint/return-await
      return await Promise.resolve();
    },
    root
  };
}
