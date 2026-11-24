// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {CompositeLayer, Layer, PickingInfo} from '@deck.gl/core';

type SourceRow = {__source?: {parent?: {id: string} | null; object?: unknown; index: number}};

const SOURCE_ROWS = new WeakMap<object, Map<string, Map<number, number>>>();

/** First row of `data` whose sub-layer source chain reaches `rootId` at `sourceIndex`, or -1. */
export function getSplatSourceRow(data: unknown, rootId: string, sourceIndex: number): number {
  if (!Array.isArray(data)) return -1;
  let roots = SOURCE_ROWS.get(data);
  if (!roots) {
    roots = new Map();
    SOURCE_ROWS.set(data, roots);
  }
  let rows = roots.get(rootId);
  if (!rows) {
    rows = new Map();
    for (let row = 0; row < data.length; row++) {
      let source = (data[row] as SourceRow | null)?.__source;
      while (source && source.parent?.id !== rootId)
        source = (source.object as SourceRow | null)?.__source;
      if (source && !rows.has(source.index)) rows.set(source.index, row);
    }
    roots.set(rootId, rows);
  }
  return rows.get(sourceIndex) ?? -1;
}

/**
 * A controlled `highlightedObjectIndex` names a row of `layer`'s own data, but deck.gl forwards it
 * unchanged to children whose rows are subsets in another order. Return the first child row that
 * is that data row, or that wraps it as a sub-layer row, or -1. Uncontrolled values pass through.
 */
export function getSplatHighlightRow(
  layer: Layer,
  data: readonly unknown[]
): number | null | undefined {
  const index = layer.props.highlightedObjectIndex;
  if (!Number.isInteger(index) || index! < 0) return index;
  const own = layer.props.data as unknown;
  const object = Array.isArray(own) ? own[index!] : undefined;
  for (let row = 0; row < data.length; row++) {
    const item = data[row] as SourceRow | null;
    if (object !== undefined && item === object) return row;
    const source = item?.__source;
    if (source?.index === index && source.parent?.id === layer.id) return row;
  }
  return -1;
}

/**
 * Highlight one source object in every primitive descendant. deck.gl forwards the picked
 * sub-layer's color to all sub-layers, which selects unrelated owners when levels or wood
 * partitions hold different subsets in different orders.
 */
export function updateSplatSourceHighlight(root: CompositeLayer, info: PickingInfo): void {
  const sourceIndex = info.picked ? info.index : -1;
  const visit = (layer: Layer) => {
    for (const sublayer of (layer as CompositeLayer).getSubLayers()) {
      if (sublayer.isComposite) {
        visit(sublayer);
        continue;
      }
      const row =
        sourceIndex >= 0 ? getSplatSourceRow(sublayer.props.data, root.id, sourceIndex) : -1;
      sublayer.updateAutoHighlight({
        ...info,
        picked: row >= 0,
        index: row,
        color: row >= 0 ? new Uint8Array(sublayer.encodePickingColor(row)) : null
      } as PickingInfo);
    }
  };
  visit(root);
}
