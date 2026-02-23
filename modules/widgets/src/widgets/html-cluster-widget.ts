// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {point} from '@turf/helpers';
import Supercluster from 'supercluster';
import type {VNode} from 'preact';

import type {WidgetProps, Viewport} from '@deck.gl/core';
import {HtmlOverlayWidget, type HtmlOverlayWidgetProps} from './html-overlay-widget';

/** Projected cluster data — framework-agnostic, no VNodes. */
export type ProjectedCluster<T> = {
  key: string | number;
  x: number;
  y: number;
  coordinates: [number, number];
} & (
  | {type: 'cluster'; clusterId: number; count: number}
  | {type: 'point'; object: T}
);

export type HtmlClusterWidgetProps<T = unknown> = HtmlOverlayWidgetProps &
  WidgetProps & {
    /** Data objects to cluster. Alternative to overriding getAllObjects(). */
    objects?: T[];
    /** Extract [lng, lat] from each object. Alternative to overriding getObjectCoordinates(). */
    getCoordinates?: (obj: T) => [number, number];
    /** Stable key for each object. Defaults to index. */
    getKey?: (obj: T, index: number) => string | number;
    /** Supercluster pixel radius. Default 60. */
    clusterRadius?: number;
    /** Max zoom level for clustering. Default 20. */
    maxClusterZoom?: number;
  };

export class HtmlClusterWidget<ObjType = unknown> extends HtmlOverlayWidget<
  HtmlClusterWidgetProps<ObjType>
> {
  static override defaultProps = {
    ...HtmlOverlayWidget.defaultProps,
    id: 'html-cluster-overlay'
  } satisfies Required<WidgetProps> & HtmlClusterWidgetProps;

  protected superCluster: Supercluster | null = null;
  protected lastObjects: ObjType[] | null = null;

  /** Rebuild supercluster index if input objects have changed. */
  protected rebuildIndex(): void {
    const newObjects = this.getAllObjects();
    if (newObjects !== this.lastObjects) {
      this.superCluster = new Supercluster(this.getClusterOptions());
      this.superCluster.load(
        newObjects.map((object) => point(this.getObjectCoordinates(object), {object}))
      );
      this.lastObjects = newObjects;
    }
  }

  /**
   * Get projected + culled cluster data for external rendering.
   * Returns typed data with screen-space coordinates — no VNodes.
   */
  getProjectedClusters(): ProjectedCluster<ObjType>[] {
    const viewport = this.getViewport();
    if (!viewport) return [];

    this.rebuildIndex();

    const clusters =
      this.superCluster?.getClusters([-180, -90, 180, 90], Math.round(this.getZoom())) ?? [];

    const getKey = this.props.getKey;
    const result: ProjectedCluster<ObjType>[] = [];

    for (const feature of clusters) {
      const coords = feature.geometry.coordinates as [number, number];
      const [x, y] = this.getCoords(viewport, coords);

      if (!this.inView(viewport, [x, y])) continue;

      const {cluster, point_count: pointCount, cluster_id: clusterId, object} = feature.properties;

      if (cluster) {
        result.push({
          key: `cluster-${clusterId}`,
          x,
          y,
          coordinates: coords,
          type: 'cluster',
          clusterId,
          count: pointCount
        });
      } else {
        const idx = result.length;
        result.push({
          key: getKey ? getKey(object as ObjType, idx) : idx,
          x,
          y,
          coordinates: coords,
          type: 'point',
          object: object as ObjType
        });
      }
    }

    return result;
  }

  protected override getOverlayItems(viewport: Viewport): VNode[] {
    this.rebuildIndex();

    const clusters =
      this.superCluster?.getClusters([-180, -90, 180, 90], Math.round(this.getZoom())) ?? [];

    const overlayItems = clusters.map(
      ({
        geometry: {coordinates},
        properties: {cluster, point_count: pointCount, cluster_id: clusterId, object}
      }) =>
        cluster
          ? this.renderCluster(coordinates, clusterId, pointCount)
          : this.renderObject(coordinates, object)
    );

    return overlayItems.filter(Boolean) as VNode[];
  }

  /** Get all objects in a cluster by its ID. */
  getClusterObjects(clusterId: number): ObjType[] {
    return (
      this.superCluster
        ?.getLeaves(clusterId, Infinity)
        .map((leaf) => leaf.properties.object as ObjType) ?? []
    );
  }

  /** Get the zoom level at which a cluster expands. */
  getClusterExpansionZoom(clusterId: number): number {
    return this.superCluster?.getClusterExpansionZoom(clusterId) ?? 0;
  }

  /**
   * Provide items that need clustering.
   * If the items have not changed, return the same array reference to avoid
   * regeneration of the cluster which causes performance issues.
   * Override this OR pass `objects` prop.
   */
  getAllObjects(): ObjType[] {
    return (this.props.objects as ObjType[]) ?? [];
  }

  /**
   * Provide coordinates for each object of getAllObjects().
   * Override this OR pass `getCoordinates` prop.
   */
  getObjectCoordinates(obj: ObjType): [number, number] {
    return this.props.getCoordinates?.(obj) ?? [0, 0];
  }

  /** Get options object used when instantiating supercluster. */
  getClusterOptions(): Record<string, any> {
    return {
      radius: this.props.clusterRadius ?? 60,
      maxZoom: this.props.maxClusterZoom ?? 20
    };
  }

  /**
   * Return a VNode for a single (unclustered) object.
   * Override for Preact/callback rendering. Default returns null
   * (use getProjectedClusters() for external rendering instead).
   */
  renderObject(
    coordinates: number[],
    obj: ObjType
  ): VNode<Record<string, any>> | null | undefined {
    return null;
  }

  /**
   * Return a VNode for a cluster.
   * Override for Preact/callback rendering. Default returns null
   * (use getProjectedClusters() for external rendering instead).
   */
  renderCluster(
    coordinates: number[],
    clusterId: number,
    pointCount: number
  ): VNode<Record<string, any>> | null | undefined {
    return null;
  }
}
