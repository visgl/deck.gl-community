export type HierarchicalTrackDescriptor<TObject = unknown> = {
  readonly id: string;
  readonly kind: 'leaf' | 'group';
  readonly type: string;
  readonly parentId?: string;
  readonly object?: TObject;
};

export type HierarchicalTrackSize = {
  readonly height: number;
  readonly width: number;
};

export type HierarchicalTrackLayoutEntry<TObject = unknown> = {
  readonly id: string;
  readonly kind: 'leaf' | 'group';
  readonly type: string;
  readonly parentId?: string;
  readonly object?: TObject;
  readonly depth: number;
  readonly childIds: readonly string[];
  readonly visibleChildIds: readonly string[];
  readonly isLeaf: boolean;
  readonly isCollapsed: boolean;
  readonly isVisible: boolean;
  readonly ownHeight: number;
  readonly ownWidth: number;
  readonly currentSubtreeHeight: number;
  readonly expandedSubtreeHeight: number;
  readonly currentSubtreeWidth: number;
  readonly expandedSubtreeWidth: number;
  readonly currentYOffset: number | null;
  readonly expandedYOffset: number;
};

export type HierarchicalTrackLayoutResult<TObject = unknown> = {
  readonly trackLayoutsById: Readonly<Record<string, HierarchicalTrackLayoutEntry<TObject>>>;
  readonly orderedTrackIds: readonly string[];
  readonly rootTrackIds: readonly string[];
  readonly totalCurrentHeight: number;
  readonly totalExpandedHeight: number;
  readonly totalCurrentWidth: number;
  readonly totalExpandedWidth: number;
};

export type BuildHierarchicalTrackLayoutParams<
  TObject = unknown,
  TDescriptor extends HierarchicalTrackDescriptor<TObject> = HierarchicalTrackDescriptor<TObject>
> = {
  readonly descriptors: readonly TDescriptor[];
  readonly rootTrackIds: readonly string[];
  readonly collapsedTrackIds?: ReadonlySet<string>;
  readonly measureTrack: (descriptor: TDescriptor) => HierarchicalTrackSize;
  readonly getChildrenOffset?: (descriptor: TDescriptor) => number;
  readonly getSiblingGap?: (
    parentDescriptor: TDescriptor,
    previousChildDescriptor: TDescriptor,
    nextChildDescriptor: TDescriptor
  ) => number;
};

type MutableHierarchicalTrackLayoutEntry<TObject = unknown> = {
  id: string;
  kind: 'leaf' | 'group';
  type: string;
  parentId?: string;
  object?: TObject;
  depth: number;
  childIds: string[];
  visibleChildIds: string[];
  isLeaf: boolean;
  isCollapsed: boolean;
  isVisible: boolean;
  ownHeight: number;
  ownWidth: number;
  currentSubtreeHeight: number;
  expandedSubtreeHeight: number;
  currentSubtreeWidth: number;
  expandedSubtreeWidth: number;
  currentYOffset: number | null;
  expandedYOffset: number;
};

type TrackNode<TObject, TDescriptor extends HierarchicalTrackDescriptor<TObject>> = {
  descriptor: TDescriptor;
  children: Array<TrackNode<TObject, TDescriptor>>;
  layout: MutableHierarchicalTrackLayoutEntry<TObject>;
  childrenOffset: number;
};

const EMPTY_COLLAPSED_TRACK_IDS = new Set<string>();

/**
 * Generic hierarchical track packing helper.
 *
 * This utility is intended to replace the manual vertical and collapse bookkeeping that is
 * currently concentrated in `applyTraceLayoutCollapseState(...)` inside `trace-geometry-layout.ts`.
 */
export function buildHierarchicalTrackLayout<
  TObject = unknown,
  TDescriptor extends HierarchicalTrackDescriptor<TObject> = HierarchicalTrackDescriptor<TObject>
>(
  params: BuildHierarchicalTrackLayoutParams<TObject, TDescriptor>
): HierarchicalTrackLayoutResult<TObject> {
  const collapsedTrackIds = params.collapsedTrackIds ?? EMPTY_COLLAPSED_TRACK_IDS;
  const getChildrenOffset = params.getChildrenOffset ?? (() => 0);
  const getSiblingGap = params.getSiblingGap ?? (() => 0);

  const nodesById = new Map<string, TrackNode<TObject, TDescriptor>>();
  for (const descriptor of params.descriptors) {
    if (nodesById.has(descriptor.id)) {
      throw new Error(`Duplicate track descriptor id "${descriptor.id}".`);
    }
    nodesById.set(descriptor.id, {
      descriptor,
      children: [],
      childrenOffset: 0,
      layout: {
        id: descriptor.id,
        kind: descriptor.kind,
        type: descriptor.type,
        parentId: descriptor.parentId,
        object: descriptor.object,
        depth: -1,
        childIds: [],
        visibleChildIds: [],
        isLeaf: true,
        isCollapsed: false,
        isVisible: false,
        ownHeight: 0,
        ownWidth: 0,
        currentSubtreeHeight: 0,
        expandedSubtreeHeight: 0,
        currentSubtreeWidth: 0,
        expandedSubtreeWidth: 0,
        currentYOffset: null,
        expandedYOffset: 0
      }
    });
  }

  const rootIdSet = new Set<string>();
  for (const rootTrackId of params.rootTrackIds) {
    if (rootIdSet.has(rootTrackId)) {
      throw new Error(`Duplicate root track id "${rootTrackId}".`);
    }
    rootIdSet.add(rootTrackId);
    if (!nodesById.has(rootTrackId)) {
      throw new Error(`Unknown root track id "${rootTrackId}".`);
    }
  }

  for (const descriptor of params.descriptors) {
    const currentNode = nodesById.get(descriptor.id);
    if (!currentNode) {
      continue;
    }

    if (descriptor.parentId == null) {
      if (!rootIdSet.has(descriptor.id)) {
        throw new Error(
          `Top-level track "${descriptor.id}" must be listed in rootTrackIds to define layout order.`
        );
      }
      continue;
    }

    const parentNode = nodesById.get(descriptor.parentId);
    if (!parentNode) {
      throw new Error(
        `Track "${descriptor.id}" references missing parent "${descriptor.parentId}".`
      );
    }
    parentNode.children.push(currentNode);
    parentNode.layout.childIds.push(descriptor.id);
  }

  for (const node of nodesById.values()) {
    if (node.descriptor.kind === 'leaf' && node.children.length > 0) {
      throw new Error(`Leaf track "${node.descriptor.id}" cannot have child tracks.`);
    }
  }

  const rootNodes = params.rootTrackIds.map(rootTrackId => {
    const node = nodesById.get(rootTrackId);
    if (!node) {
      throw new Error(`Unknown root track id "${rootTrackId}".`);
    }
    if (node.descriptor.parentId != null) {
      throw new Error(
        `Root track "${rootTrackId}" must not declare parentId "${node.descriptor.parentId}".`
      );
    }
    return node;
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const orderedNodes: Array<TrackNode<TObject, TDescriptor>> = [];

  const visitNode = (node: TrackNode<TObject, TDescriptor>, depth: number): void => {
    if (visiting.has(node.descriptor.id)) {
      throw new Error(`Cycle detected while laying out track "${node.descriptor.id}".`);
    }
    if (visited.has(node.descriptor.id)) {
      return;
    }

    visiting.add(node.descriptor.id);
    node.layout.depth = depth;
    orderedNodes.push(node);
    for (const childNode of node.children) {
      visitNode(childNode, depth + 1);
    }
    visiting.delete(node.descriptor.id);
    visited.add(node.descriptor.id);
  };

  for (const rootNode of rootNodes) {
    visitNode(rootNode, 0);
  }

  if (visited.size !== params.descriptors.length) {
    const unvisitedDescriptor = params.descriptors.find(descriptor => !visited.has(descriptor.id));
    if (unvisitedDescriptor) {
      throw new Error(
        `Track "${unvisitedDescriptor.id}" is not reachable from rootTrackIds or participates in a cycle.`
      );
    }
  }

  for (let index = orderedNodes.length - 1; index >= 0; index -= 1) {
    const node = orderedNodes[index]!;
    const {descriptor, children, layout} = node;
    const ownSize = params.measureTrack(descriptor);
    layout.ownHeight = readFiniteNonNegativeNumber(ownSize.height, `height for "${descriptor.id}"`);
    layout.ownWidth = readFiniteNonNegativeNumber(ownSize.width, `width for "${descriptor.id}"`);
    layout.isLeaf = descriptor.kind === 'leaf';
    layout.isCollapsed = descriptor.kind === 'group' && collapsedTrackIds.has(descriptor.id);

    const childrenOffset =
      children.length > 0
        ? readFiniteNonNegativeNumber(
            getChildrenOffset(descriptor),
            `children offset for "${descriptor.id}"`
          )
        : 0;
    node.childrenOffset = childrenOffset;

    let expandedChildrenHeight = 0;
    let currentChildrenHeight = 0;
    let expandedSubtreeWidth = layout.ownWidth;
    let currentSubtreeWidth = layout.ownWidth;

    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const childNode = children[childIndex]!;
      expandedChildrenHeight += childNode.layout.expandedSubtreeHeight;
      currentChildrenHeight += childNode.layout.currentSubtreeHeight;
      expandedSubtreeWidth = Math.max(expandedSubtreeWidth, childNode.layout.expandedSubtreeWidth);
      currentSubtreeWidth = Math.max(currentSubtreeWidth, childNode.layout.currentSubtreeWidth);

      if (childIndex === 0) {
        continue;
      }

      const previousChildNode = children[childIndex - 1]!;
      const siblingGap = readFiniteNonNegativeNumber(
        getSiblingGap(descriptor, previousChildNode.descriptor, childNode.descriptor),
        `sibling gap between "${previousChildNode.descriptor.id}" and "${childNode.descriptor.id}"`
      );
      expandedChildrenHeight += siblingGap;
      currentChildrenHeight += siblingGap;
    }

    layout.expandedSubtreeHeight =
      layout.ownHeight + (children.length > 0 ? childrenOffset + expandedChildrenHeight : 0);
    layout.currentSubtreeHeight = layout.isCollapsed
      ? layout.ownHeight
      : layout.ownHeight + (children.length > 0 ? childrenOffset + currentChildrenHeight : 0);
    layout.expandedSubtreeWidth = expandedSubtreeWidth;
    layout.currentSubtreeWidth = layout.isCollapsed ? layout.ownWidth : currentSubtreeWidth;
  }

  let totalCurrentHeight = 0;
  let totalExpandedHeight = 0;
  let totalCurrentWidth = 0;
  let totalExpandedWidth = 0;

  const assignOffsets = (
    node: TrackNode<TObject, TDescriptor>,
    currentYOffset: number,
    expandedYOffset: number,
    isVisible: boolean
  ): void => {
    node.layout.isVisible = isVisible;
    node.layout.currentYOffset = isVisible ? currentYOffset : null;
    node.layout.expandedYOffset = expandedYOffset;
    node.layout.visibleChildIds =
      isVisible && !node.layout.isCollapsed ? [...node.layout.childIds] : [];

    const nextExpandedChildYOffset =
      expandedYOffset +
      node.layout.ownHeight +
      (node.children.length > 0 ? node.childrenOffset : 0);
    const nextCurrentChildYOffset =
      currentYOffset + node.layout.ownHeight + (node.children.length > 0 ? node.childrenOffset : 0);

    let runningExpandedChildYOffset = nextExpandedChildYOffset;
    let runningCurrentChildYOffset = nextCurrentChildYOffset;

    for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
      const childNode = node.children[childIndex]!;
      assignOffsets(
        childNode,
        runningCurrentChildYOffset,
        runningExpandedChildYOffset,
        isVisible && !node.layout.isCollapsed
      );

      runningExpandedChildYOffset += childNode.layout.expandedSubtreeHeight;
      runningCurrentChildYOffset += childNode.layout.currentSubtreeHeight;

      if (childIndex === node.children.length - 1) {
        continue;
      }

      const nextChildNode = node.children[childIndex + 1]!;
      const siblingGap = readFiniteNonNegativeNumber(
        getSiblingGap(node.descriptor, childNode.descriptor, nextChildNode.descriptor),
        `sibling gap between "${childNode.descriptor.id}" and "${nextChildNode.descriptor.id}"`
      );
      runningExpandedChildYOffset += siblingGap;
      runningCurrentChildYOffset += siblingGap;
    }
  };

  let nextCurrentRootYOffset = 0;
  let nextExpandedRootYOffset = 0;
  for (const rootNode of rootNodes) {
    assignOffsets(rootNode, nextCurrentRootYOffset, nextExpandedRootYOffset, true);
    nextCurrentRootYOffset += rootNode.layout.currentSubtreeHeight;
    nextExpandedRootYOffset += rootNode.layout.expandedSubtreeHeight;
    totalCurrentWidth = Math.max(totalCurrentWidth, rootNode.layout.currentSubtreeWidth);
    totalExpandedWidth = Math.max(totalExpandedWidth, rootNode.layout.expandedSubtreeWidth);
  }
  totalCurrentHeight = nextCurrentRootYOffset;
  totalExpandedHeight = nextExpandedRootYOffset;

  const trackLayoutsById = Object.fromEntries(
    orderedNodes.map(node => [
      node.descriptor.id,
      {
        ...node.layout,
        childIds: [...node.layout.childIds],
        visibleChildIds: [...node.layout.visibleChildIds]
      } satisfies HierarchicalTrackLayoutEntry
    ])
  );

  return {
    trackLayoutsById,
    orderedTrackIds: orderedNodes.map(node => node.descriptor.id),
    rootTrackIds: [...params.rootTrackIds],
    totalCurrentHeight,
    totalExpandedHeight,
    totalCurrentWidth,
    totalExpandedWidth
  };
}

function readFiniteNonNegativeNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected ${label} to be a finite non-negative number, received ${value}.`);
  }
  return value;
}
