import type {Instance} from './types';

/**
 * Registry mapping element type names to Deck.gl layer/view constructors.
 *
 * Populated by {@link extend} or automatically via side-effects import.
 * Used internally by the reconciler to instantiate legacy typed elements.
 *
 * @deprecated The catalogue pattern is deprecated. Use the new <layer> element instead.
 */
export type Catalogue = Record<
  string,
  {
    new (...args: unknown[]): Instance['node'];
  }
>;

/**
 * Global registry of Deck.gl layer and view constructors.
 *
 * Populated via {@link extend} or side-effects import. Do not mutate directly.
 *
 * @deprecated Use the new <layer> element instead of the catalogue pattern.
 */
export const catalogue: Catalogue = {};

/**
 * @deprecated This function is deprecated and will be removed in v3.
 *
 * Manual layer registration is no longer needed with the new <layer> element.
 * Instead of using extend(), directly import and instantiate layers:
 *
 * ```tsx
 * import { ScatterplotLayer } from '@deck.gl/layers';
 * import { MyCustomLayer } from './my-custom-layer';
 *
 * <layer layer={new ScatterplotLayer({ id: 'points', data })} />
 * <layer layer={new MyCustomLayer({ id: 'custom' })} />
 * ```
 *
 * This provides better type safety, enables code-splitting, and works with
 * both built-in and custom layers without registration.
 *
 * @param objects - Layer/view constructors to register in the catalogue
 */
export function extend(objects: Partial<Catalogue>) {
  Object.assign(catalogue, objects);
}
