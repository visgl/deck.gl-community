// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * AI Tools Compliance Test Suite
 *
 * Asserts that direct-geometry execution via createEditTools produces the same
 * FeatureCollection as mode-replay (driving the corresponding GeoJsonEditMode
 * through synthesized events). This prevents AI tool execute() implementations
 * from silently diverging from the layer's interactive behaviour.
 *
 * Pattern:
 *   1. Start with an identical baseline FeatureCollection in both paths.
 *   2. Direct path: call tools.X.execute(args) — captures resulting FC.
 *   3. Mode-replay path: synthesize events, call mode.handleXxx(), capture
 *      the FC produced by onEdit().
 *   4. Assert deep equality of both FCs (geometry only — properties may differ).
 */

import {describe, it, expect, vi} from 'vitest';
import type {FeatureCollection, Feature, Point} from 'geojson';
import {createEditTools} from '../../src/ai-tools/create-edit-tools';
import {DrawPointMode} from '../../src/edit-modes/draw-point-mode';
import {createClickEvent, createPointerMoveEvent} from '../edit-modes/test-utils';

// ── Baseline FeatureCollection ───────────────────────────────────────────────

const BASELINE_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {name: 'existing'},
      geometry: {type: 'Point', coordinates: [-73.985, 40.748]}
    }
  ]
};

function cloneFC(fc: FeatureCollection): FeatureCollection {
  return JSON.parse(JSON.stringify(fc));
}

// ── draw_point — WORKED ───────────────────────────────────────────────────────

describe('compliance: draw_point', () => {
  const POSITION: [number, number] = [-122.4194, 37.7749]; // San Francisco

  it('direct-geom result matches mode-replay result', async () => {
    // ── Direct path ──────────────────────────────────────────────────────────
    let directFc = cloneFC(BASELINE_FC);
    const tools = createEditTools({
      getFeatureCollection: () => directFc,
      onFeatureCollectionChange: (fc) => {
        directFc = fc;
      }
    });

    const directResult = await tools.draw_point.execute({position: POSITION});
    expect(directResult.ok).toBe(true);
    if (!directResult.ok) throw new Error('unreachable');
    const directNewFeature = directResult.featureCollection.features[
      directResult.featureIndex
    ] as Feature<Point>;

    // ── Mode-replay path ──────────────────────────────────────────────────────
    const replayFc = cloneFC(BASELINE_FC);
    const mode = new DrawPointMode();

    const onEdit = vi.fn();
    const props = {
      data: replayFc,
      selectedIndexes: [],
      lastPointerMoveEvent: createPointerMoveEvent(POSITION),
      modeConfig: null,
      onEdit,
      onUpdateCursor: vi.fn()
    };

    mode.handleClick(createClickEvent(POSITION), props as any);

    expect(onEdit).toHaveBeenCalledOnce();
    const editAction = onEdit.mock.calls[0][0];
    const replayFcResult: FeatureCollection = editAction.updatedData;
    const replayNewFeature = replayFcResult.features[
      replayFcResult.features.length - 1
    ] as Feature<Point>;

    // ── Assert equivalence ────────────────────────────────────────────────────
    // Feature count must match
    expect(directResult.featureCollection.features.length).toBe(replayFcResult.features.length);

    // New point geometry must be identical
    expect(directNewFeature.geometry.type).toBe('Point');
    expect(replayNewFeature.geometry.type).toBe('Point');
    expect(directNewFeature.geometry.coordinates).toEqual(replayNewFeature.geometry.coordinates);

    // Existing features must be unchanged
    const existingDirect = directResult.featureCollection.features[0];
    const existingReplay = replayFcResult.features[0];
    expect(existingDirect.geometry).toEqual(existingReplay.geometry);
  });

  it('returns ok:true with correct featureIndex', async () => {
    let fc = cloneFC(BASELINE_FC);
    const tools = createEditTools({
      getFeatureCollection: () => fc,
      onFeatureCollectionChange: (newFc) => {
        fc = newFc;
      }
    });

    const result = await tools.draw_point.execute({position: [-0.127, 51.507]});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureIndex).toBe(1); // appended after the 1 existing feature
    expect(result.featureCollection.features[1].geometry.type).toBe('Point');
  });

  it('calls onFeatureCollectionChange with the new FC', async () => {
    const fc = cloneFC(BASELINE_FC);
    const onChange = vi.fn();
    const tools = createEditTools({
      getFeatureCollection: () => fc,
      onFeatureCollectionChange: onChange
    });

    await tools.draw_point.execute({position: [0, 0]});
    expect(onChange).toHaveBeenCalledOnce();
    const updatedFc: FeatureCollection = onChange.mock.calls[0][0];
    expect(updatedFc.features).toHaveLength(2);
  });

  it('passes through properties to the new feature', async () => {
    const fc = cloneFC(BASELINE_FC);
    const tools = createEditTools({
      getFeatureCollection: () => fc,
      onFeatureCollectionChange: () => {}
    });

    const result = await tools.draw_point.execute({
      position: [10, 20],
      properties: {label: 'HQ', priority: 1}
    });
    if (!result.ok) throw new Error('expected ok');
    const newFeature = result.featureCollection.features[result.featureIndex];
    expect(newFeature.properties).toMatchObject({label: 'HQ', priority: 1});
  });

  it('does not mutate the input FeatureCollection', async () => {
    const fc = cloneFC(BASELINE_FC);
    const frozen = JSON.stringify(fc);
    const tools = createEditTools({
      getFeatureCollection: () => fc,
      onFeatureCollectionChange: () => {}
    });

    await tools.draw_point.execute({position: [5, 5]});
    expect(JSON.stringify(fc)).toBe(frozen); // input unchanged
  });
});

// ── draw_polygon — stub (pattern is obvious) ─────────────────────────────────

describe.skip('compliance: draw_polygon', () => {
  // TODO: synthesize clicks into DrawPolygonMode (double-click to close),
  // compare resulting Polygon geometry to tools.draw_polygon.execute() output.
  // Self-intersection test: provide a figure-8 polygon, expect ok:false / self_intersecting.
  it.skip('direct-geom result matches mode-replay result', () => {});
  it.skip('rejects self-intersecting polygons', () => {});
});

// ── delete_feature — stub ────────────────────────────────────────────────────

describe.skip('compliance: delete_feature', () => {
  // TODO: simulate a pick event on featureIndex 0 in DeleteMode,
  // compare resulting FC to tools.delete_feature.execute({ featureIndex: 0 }).
  it.skip('direct-geom result matches mode-replay result', () => {});
  it.skip('returns feature_not_found for out-of-range index', () => {});
});

// ── translate_feature — stub ─────────────────────────────────────────────────

describe.skip('compliance: translate_feature', () => {
  // TODO: synthesize a drag event in TranslateMode with a known dx/dy pixel offset,
  // compute the expected map coord delta, then compare to
  // tools.translate_feature.execute({ featureIndex, dx, dy }) output.
  // Note: TranslateMode uses WebMercatorViewport math; the compliance test must
  // supply a viewport to make the comparison meaningful.
  it.skip('direct-geom result matches mode-replay result', () => {});
  it.skip('returns feature_not_found for out-of-range index', () => {});
});
