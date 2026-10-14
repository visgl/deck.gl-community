// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Stage, GeographicMark} from './interfaces';

/** Matching geometry replacements retain the existing interleaved paint order. */
export function replaceGeographicEntries(
  update: Partial<Stage>,
  previous: Stage
): GeographicMark[] | undefined {
  if (update.geographicData !== undefined) return update.geographicData;
  if (
    !previous.geographicData ||
    (update.polygonData === undefined && update.pathData === undefined)
  )
    return previous.geographicData;
  const oldPolygons = (previous.polygonData ?? []).filter(item => item.isGeographic);
  const oldPaths = (previous.pathData ?? []).filter(item => item.isGeographic);
  const polygons = (update.polygonData ?? previous.polygonData ?? []).filter(
    item => item.isGeographic
  );
  const paths = (update.pathData ?? previous.pathData ?? []).filter(item => item.isGeographic);
  if (polygons.length !== oldPolygons.length || paths.length !== oldPaths.length) {
    throw new Error(
      'Geographic additions or removals through rePresent require explicit geographicData paint order.'
    );
  }
  const polygonReplacements = new Map(oldPolygons.map((item, index) => [item, polygons[index]]));
  const pathReplacements = new Map(oldPaths.map((item, index) => [item, paths[index]]));
  return previous.geographicData.map(mark =>
    mark.type === 'polygon'
      ? {type: 'polygon', data: polygonReplacements.get(mark.data) ?? mark.data}
      : {type: 'path', data: pathReplacements.get(mark.data) ?? mark.data}
  );
}

/** Explicit ordered geometry is authoritative for the backing stage arrays as well. */
export function normalizeGeographicEntries(stage: Stage): void {
  if (stage.geographicData === undefined) return;
  const marks = stage.geographicData.map((mark): GeographicMark => {
    if (mark.data.isGeographic) return mark;
    return mark.type === 'polygon'
      ? {type: 'polygon', data: {...mark.data, isGeographic: true}}
      : {type: 'path', data: {...mark.data, isGeographic: true}};
  });
  stage.geographicData = marks;
  stage.polygonData = [
    ...(stage.polygonData ?? []).filter(item => !item.isGeographic),
    ...marks.flatMap(mark => (mark.type === 'polygon' ? [mark.data] : []))
  ];
  stage.pathData = [
    ...(stage.pathData ?? []).filter(item => !item.isGeographic),
    ...marks.flatMap(mark => (mark.type === 'path' ? [mark.data] : []))
  ];
}
