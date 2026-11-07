import {View, Widget} from '@deck.gl/core';
import type {DeckProps, Layer} from '@deck.gl/core';

import type {Instance} from './types';

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

/** Type guard to check if a node is a Widget instance. */
export function isWidget(instance: Instance['node']): instance is Widget {
  return instance instanceof Widget;
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
 * Partitions a list of nodes into separate views, layers and widgets arrays.
 *
 * Uses the isView and isWidget type guards to separate View and Widget objects from Layer objects,
 * organizing them into the structure expected by deck.gl's setProps method.
 *
 * @param list - Array of Layer, View and Widget nodes to partition
 * @returns Object with separate arrays for views, layers and widgets
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
  return list.reduce<{views: View[]; layers: Layer[]; widgets: Widget[]}>(
    (acc, curr) => {
      if (isView(curr)) {
        acc.views.push(curr);
      } else if (isWidget(curr)) {
        acc.widgets.push(curr);
      } else {
        acc.layers.push(curr);
      }
      return acc;
    },
    {layers: [], views: [], widgets: []}
  );
}

/** The `widgets` prop of a root. */
export type RootWidgets = DeckProps<View | View[] | null>['widgets'];

/**
 * Merges JSX widgets with the `widgets` prop by id.
 *
 * deck.gl's WidgetManager matches widgets by id, so two widgets with one id would be added
 * twice. A prop widget replaces the JSX widget with the same id, and other prop widgets
 * follow the JSX widgets. The result is never `undefined`, so removing the last JSX widget
 * removes it from deck.gl.
 */
export function mergeWidgets(
  jsxWidgets: Widget[],
  passedWidgets: RootWidgets | undefined
): NonNullable<RootWidgets> {
  if (jsxWidgets.length === 0) {
    return passedWidgets ?? [];
  }
  if (!passedWidgets) {
    return jsxWidgets;
  }

  const widgetsById = new Map<string, NonNullable<RootWidgets>[number]>();
  for (const widget of [...jsxWidgets, ...passedWidgets]) {
    if (widget) {
      widgetsById.set(widget.id, widget);
    }
  }
  return [...widgetsById.values()];
}
