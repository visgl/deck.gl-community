import {View} from '@deck.gl/core';
import type {DeckProps, Layer, LayersList} from '@deck.gl/core';

import type {Instance, JsxDescriptors, ViewOrViews} from './types';

/**
 * Type guard to check if a node is a View instance.
 *
 * Used to distinguish View objects from Layer objects in the reconciler tree.
 * Enables TypeScript to narrow the type in conditional branches.
 *
 * @param instance - The Layer or View node to check
 * @returns True if the instance is a View, false if it's a Layer
 *
 * @example
 * ```typescript
 * const node = getInstance();
 * if (isView(node)) {
 *   // node is narrowed to View type
 *   console.log(node.controller);
 * } else {
 *   // node is narrowed to Layer type
 *   console.log(node.props);
 * }
 * ```
 */
export function isView(instance: Instance['node']): instance is View {
  return instance instanceof View;
}

/**
 * Flattens a tree of Instance nodes into a flat array.
 *
 * Performs depth-first traversal to extract all Layer/View nodes from the
 * reconciler tree structure. Optimized using accumulator pattern to avoid
 * O(N*D) allocations from recursive spreading.
 *
 * @param arr - Array of root Instance nodes to flatten
 * @returns Flat array of all Layer and View nodes in depth-first order
 *
 * @example
 * ```typescript
 * const instances = [
 *   {
 *     node: layer1,
 *     children: [
 *       { node: layer2, children: [] }
 *     ]
 *   }
 * ];
 * const nodes = flattenTree(instances);
 * // [layer1, layer2] - depth-first order
 * ```
 */
export function flattenTree(arr: Instance[]): Instance['node'][] {
  // PERF: avoid-allocations.md - accumulator pattern instead of recursive spread
  // Issue: Recursive spread creates O(N*D) allocations for N nodes at depth D
  // Gain: 5-20x speedup for trees with 100+ nodes
  const result: Instance['node'][] = [];

  function flatten(instances: Instance[]): void {
    for (const val of instances) {
      result.push(val.node);
      if (val.children.length > 0) {
        flatten(val.children);
      }
    }
  }

  flatten(arr);
  return result;
}

/**
 * Partitions a list of nodes into separate views and layers arrays.
 *
 * Uses the isView type guard to separate View objects from Layer objects,
 * organizing them into the structure expected by deck.gl's setProps method.
 *
 * @param list - Array of Layer and View nodes to partition
 * @returns Object with separate arrays for views and layers
 *
 * @example
 * ```typescript
 * const nodes = [view1, layer1, layer2, view2];
 * const { views, layers } = organizeList(nodes);
 * // views: [view1, view2]
 * // layers: [layer1, layer2]
 * ```
 */
export function organizeList(list: Instance['node'][]) {
  // oxlint-disable-next-line unicorn/no-array-reduce
  return list.reduce<{views: View[]; layers: Layer[]}>(
    (acc, curr) => {
      if (isView(curr)) {
        acc.views.push(curr);
      } else {
        acc.layers.push(curr);
      }
      return acc;
    },
    {layers: [], views: []}
  );
}

/** The root props that are combined with committed JSX descriptors. */
interface RootDescriptorProps {
  _passedLayers: LayersList;
  isExternalOverlay?: boolean;
}

/**
 * Combines a root's `layers` prop with the layers and views of its committed JSX tree.
 *
 * As in `@deck.gl/react`, JSX layers come first and `layers` prop layers follow them, so
 * prop layers draw above JSX layers. External overlays receive no views because their host
 * map owns them.
 *
 * @param props - The root's passed layers and whether it is an external overlay
 * @param jsx - Layers and views from the committed JSX tree
 * @returns The `layers` and, for a standalone root, `views` to send to deck.gl
 */
export function combineRootDescriptors(
  props: RootDescriptorProps,
  jsx: JsxDescriptors
): Pick<DeckProps<ViewOrViews>, 'layers' | 'views'> {
  const descriptors: Pick<DeckProps<ViewOrViews>, 'layers' | 'views'> = {
    layers: [...jsx.layers, ...props._passedLayers]
  };

  // Standalone Deck must receive an explicit empty list when the last JSX view is
  // removed so that ViewManager restores its default view.
  if (!props.isExternalOverlay) {
    descriptors.views = jsx.views;
  }

  return descriptors;
}
