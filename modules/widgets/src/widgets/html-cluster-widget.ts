// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {point} from '@turf/helpers';
import Supercluster from 'supercluster';
import type {VNode} from 'preact';

import type {WidgetProps, Viewport} from '@deck.gl/core';
import {HtmlOverlayWidget, type HtmlOverlayWidgetProps} from './html-overlay-widget';

export type HtmlClusterWidgetProps = HtmlOverlayWidgetProps & WidgetProps;

export abstract class HtmlClusterWidget<ObjType> extends HtmlOverlayWidget<HtmlClusterWidgetProps> {
  static override defaultProps = {
    ...HtmlOverlayWidget.defaultProps,
    id: 'html-cluster-overlay'
  } satisfies Required<WidgetProps> & HtmlClusterWidgetProps;

  protected superCluster: Supercluster | null = null;
  protected lastObjects: ObjType[] | null = null;

  protected override getOverlayItems(viewport: Viewport): VNode[] {
    const newObjects = this.getAllObjects();
    if (newObjects !== this.lastObjects) {
      this.superCluster = new Supercluster(this.getClusterOptions());
      this.superCluster.load(
        newObjects.map((object) => point(this.getObjectCoordinates(object), {object}))
      );
      this.lastObjects = newObjects;
    }

    const clusters = this.superCluster?.getClusters([-180, -90, 180, 90], Math.round(this.getZoom())) ?? [];

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

  getClusterObjects(clusterId: number): ObjType[] {
    return (
      this.superCluster
        ?.getLeaves(clusterId, Infinity)
        .map((leaf) => leaf.properties.object as ObjType) ?? []
    );
  }

  // Override to provide items that need clustering.
  // If the items have not changed please provide the same array to avoid
  // regeneration of the cluster which causes performance issues.
  abstract getAllObjects(): ObjType[];

  // Override to provide coordinates for each object of getAllObjects()
  abstract getObjectCoordinates(obj: ObjType): [number, number];

  // Get options object used when instantiating supercluster
  getClusterOptions(): Record<string, any> {
    return {
      maxZoom: 20
    };
  }

  // Override to return an HtmlOverlayItem
  abstract renderObject(
    coordinates: number[],
    obj: ObjType
  ): VNode<Record<string, any>> | null | undefined;

  // Override to return an HtmlOverlayItem
  // use getClusterObjects() to get cluster contents
  abstract renderCluster(
    coordinates: number[],
    clusterId: number,
    pointCount: number
  ): VNode<Record<string, any>> | null | undefined;
}
