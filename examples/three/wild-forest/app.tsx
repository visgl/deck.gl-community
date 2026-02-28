// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useMemo, useState} from 'react';
import DeckGL from '@deck.gl/react';
import type {MapViewState, PickingInfo} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/three';
import type {TreeType, Season, CropConfig} from '@deck.gl-community/three';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

type TreeDatum = {
  position: [number, number];
  type: TreeType;
  height: number;
  trunkRadius: number;
  canopyRadius: number;
  trunkHeightFraction: number;
  season: Season;
  branchLevels: number;
  label: string;
  crop: CropConfig | null;
};

// ---------------------------------------------------------------------------
// Seeded pseudo-random (deterministic forest layout)
// ---------------------------------------------------------------------------

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Forest + orchard generation
// ---------------------------------------------------------------------------

function generateForest(): TreeDatum[] {
  const trees: TreeDatum[] = [];

  // ── Zone 1: Dense evergreen pine forest (north-west) ──────────────────────
  const pineRng = makeRng(1);
  for (let i = 0; i < 90; i++) {
    trees.push({
      position: [-0.055 + pineRng() * 0.04, 51.503 + pineRng() * 0.022],
      type: 'pine',
      height: 8 + pineRng() * 14,
      trunkRadius: 0.25 + pineRng() * 0.35,
      canopyRadius: 1.8 + pineRng() * 2.2,
      trunkHeightFraction: 0.38 + pineRng() * 0.12,
      season: 'summer',
      branchLevels: 2 + Math.round(pineRng() * 2),
      label: 'Pine',
      crop: null
    });
  }

  // ── Zone 2: Autumn oak grove (north-east) ─────────────────────────────────
  const oakRng = makeRng(2);
  for (let i = 0; i < 65; i++) {
    trees.push({
      position: [0.01 + oakRng() * 0.04, 51.503 + oakRng() * 0.022],
      type: 'oak',
      height: 10 + oakRng() * 9,
      trunkRadius: 0.45 + oakRng() * 0.45,
      canopyRadius: 3 + oakRng() * 3.5,
      trunkHeightFraction: 0.28 + oakRng() * 0.12,
      season: 'autumn',
      branchLevels: 0,
      label: 'Oak (Autumn)',
      crop: null
    });
  }

  // ── Zone 3: Cherry blossom orchard (centre, spring) ───────────────────────
  // Flowering stage: small white-pink blossom clusters in the outer canopy
  const cherryRng = makeRng(3);
  for (let i = 0; i < 55; i++) {
    const r = cherryRng;
    trees.push({
      position: [-0.025 + r() * 0.05, 51.495 + r() * 0.018],
      type: 'cherry',
      height: 5 + r() * 6,
      trunkRadius: 0.2 + r() * 0.25,
      canopyRadius: 2 + r() * 2.5,
      trunkHeightFraction: 0.32 + r() * 0.12,
      season: 'spring',
      branchLevels: 0,
      label: 'Cherry Blossom',
      crop: {
        color: [255, 230, 240, 210],
        count: Math.round(20 + r() * 18),
        droppedCount: Math.round(5 + r() * 10),
        radius: 0.07
      }
    });
  }

  // ── Zone 4: Tropical palm grove (south-east) ─────────────────────────────
  const palmRng = makeRng(4);
  for (let i = 0; i < 35; i++) {
    trees.push({
      position: [0.022 + palmRng() * 0.025, 51.489 + palmRng() * 0.02],
      type: 'palm',
      height: 9 + palmRng() * 10,
      trunkRadius: 0.18 + palmRng() * 0.18,
      canopyRadius: 2.5 + palmRng() * 2.5,
      trunkHeightFraction: 0.72 + palmRng() * 0.15,
      season: 'summer',
      branchLevels: 0,
      label: 'Palm',
      crop: null
    });
  }

  // ── Zone 5: Autumn birch glade (south-west) ───────────────────────────────
  const birchRng = makeRng(5);
  for (let i = 0; i < 60; i++) {
    trees.push({
      position: [-0.072 + birchRng() * 0.03, 51.489 + birchRng() * 0.02],
      type: 'birch',
      height: 7 + birchRng() * 7,
      trunkRadius: 0.12 + birchRng() * 0.13,
      canopyRadius: 1.8 + birchRng() * 1.8,
      trunkHeightFraction: 0.48 + birchRng() * 0.16,
      season: 'autumn',
      branchLevels: 0,
      label: 'Birch (Autumn)',
      crop: null
    });
  }

  // ── Zone 6: Winter oak silhouettes (far north) ───────────────────────────
  const winterRng = makeRng(6);
  for (let i = 0; i < 40; i++) {
    trees.push({
      position: [-0.02 + winterRng() * 0.04, 51.518 + winterRng() * 0.012],
      type: 'oak',
      height: 11 + winterRng() * 7,
      trunkRadius: 0.5 + winterRng() * 0.4,
      canopyRadius: 3.5 + winterRng() * 2,
      trunkHeightFraction: 0.3 + winterRng() * 0.1,
      season: 'winter',
      branchLevels: 0,
      label: 'Oak (Winter)',
      crop: null
    });
  }

  // ── Zone 7: Spring birch grove (west) ────────────────────────────────────
  const springBirchRng = makeRng(7);
  for (let i = 0; i < 45; i++) {
    trees.push({
      position: [-0.085 + springBirchRng() * 0.025, 51.499 + springBirchRng() * 0.018],
      type: 'birch',
      height: 9 + springBirchRng() * 6,
      trunkRadius: 0.14 + springBirchRng() * 0.12,
      canopyRadius: 2 + springBirchRng() * 2,
      trunkHeightFraction: 0.5 + springBirchRng() * 0.14,
      season: 'spring',
      branchLevels: 0,
      label: 'Birch (Spring)',
      crop: null
    });
  }

  // ── Zone 8: Citrus orchard (south-centre) — orange fruit + dropped ────────
  const citrusRng = makeRng(8);
  for (let i = 0; i < 50; i++) {
    const r = citrusRng;
    trees.push({
      position: [-0.01 + r() * 0.04, 51.481 + r() * 0.012],
      type: 'cherry', // round dense canopy suits citrus
      height: 4 + r() * 4,
      trunkRadius: 0.18 + r() * 0.18,
      canopyRadius: 2 + r() * 2,
      trunkHeightFraction: 0.3 + r() * 0.12,
      season: 'summer',
      branchLevels: 0,
      label: 'Citrus (Fruiting)',
      crop: {
        color: [255, 140, 0, 255],
        count: Math.round(22 + r() * 20),
        droppedCount: Math.round(6 + r() * 10),
        radius: 0.11
      }
    });
  }

  // ── Zone 9: Almond grove (south-west of citrus) — tan nuts + dropped ──────
  const almondRng = makeRng(9);
  for (let i = 0; i < 45; i++) {
    const r = almondRng;
    trees.push({
      position: [-0.065 + r() * 0.03, 51.481 + r() * 0.012],
      type: 'oak', // wide spreading canopy typical of almond
      height: 5 + r() * 5,
      trunkRadius: 0.22 + r() * 0.2,
      canopyRadius: 2.5 + r() * 2,
      trunkHeightFraction: 0.32 + r() * 0.12,
      season: 'summer',
      branchLevels: 0,
      label: 'Almond (Harvest)',
      crop: {
        color: [195, 155, 90, 255],
        count: Math.round(28 + r() * 22),
        droppedCount: Math.round(10 + r() * 16),
        radius: 0.09
      }
    });
  }

  return trees;
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -0.022,
  latitude: 51.503,
  zoom: 13,
  pitch: 62,
  bearing: 20
};

// ---------------------------------------------------------------------------
// Zone legend config
// ---------------------------------------------------------------------------

type ZoneInfo = {
  label: string;
  color: string;
};

const ZONES: ZoneInfo[] = [
  {label: 'Pine Forest (Summer)', color: '#006400'},
  {label: 'Oak Grove (Autumn)', color: '#b45314'},
  {label: 'Cherry Blossom (Spring ✿)', color: '#ffb4c8'},
  {label: 'Palm Grove (Summer)', color: '#14911e'},
  {label: 'Birch Glade (Autumn)', color: '#e6b928'},
  {label: 'Oak Silhouettes (Winter)', color: 'rgba(100,80,80,0.4)'},
  {label: 'Birch Grove (Spring)', color: '#96d26e'},
  {label: 'Citrus Orchard (Fruiting)', color: '#ff8c00'},
  {label: 'Almond Grove (Harvest)', color: '#c39b5a'}
];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const FOREST_DATA = generateForest();

export default function App(): React.ReactElement {
  const [sizeScale, setSizeScale] = useState(30);
  const [showCrops, setShowCrops] = useState(true);

  const treeLayer = useMemo(
    () =>
      new TreeLayer<TreeDatum>({
        id: 'wild-forest',
        data: FOREST_DATA,
        getPosition: (d) => d.position,
        getTreeType: (d) => d.type,
        getHeight: (d) => d.height,
        getTrunkRadius: (d) => d.trunkRadius,
        getCanopyRadius: (d) => d.canopyRadius,
        getTrunkHeightFraction: (d) => d.trunkHeightFraction,
        getSeason: (d) => d.season,
        getBranchLevels: (d) => d.branchLevels || 3,
        getCrop: showCrops ? (d) => d.crop : () => null,
        sizeScale,
        pickable: true,
        updateTriggers: {getCrop: showCrops}
      }),
    [sizeScale, showCrops]
  );

  const onHover = useCallback((info: PickingInfo) => {
    void info;
  }, []);

  return (
    <div style={{position: 'relative', width: '100%', height: '100%'}}>
      <DeckGL
        layers={[treeLayer]}
        initialViewState={INITIAL_VIEW_STATE}
        controller={{
          maxPitch: 80
        }}
        onHover={onHover}
        parameters={{clearColor: [0.06, 0.1, 0.06, 1]}}
        style={{position: 'absolute', width: '100%', height: '100%'}}
        getTooltip={({object}: PickingInfo) => {
          const d = object as TreeDatum | null;
          return d
            ? {
                text: `${d.label}\nHeight: ${d.height.toFixed(1)} m\nCanopy ⌀: ${(d.canopyRadius * 2).toFixed(1)} m`,
                style: {
                  background: 'rgba(0,0,0,0.75)',
                  color: '#fff',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontSize: '12px'
                }
              }
            : null;
        }}
      />

      {/* ── Controls panel ── */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(10,20,10,0.82)',
          color: '#e8f5e8',
          borderRadius: 10,
          padding: '14px 18px',
          minWidth: 230,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{fontWeight: 700, fontSize: 15, marginBottom: 12, letterSpacing: 0.5}}>
          🌲 Wild Forest + Orchards
        </div>

        <label style={{display: 'block', marginBottom: 4}}>
          Size scale: <strong>{sizeScale.toFixed(1)}×</strong>
        </label>
        <input
          type="range"
          min={5}
          max={80}
          step={1}
          value={sizeScale}
          onChange={(e) => setSizeScale(Number(e.target.value))}
          style={{width: '100%', marginBottom: 12}}
        />

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <input
            type="checkbox"
            checked={showCrops}
            onChange={(e) => setShowCrops(e.target.checked)}
            style={{width: 14, height: 14, cursor: 'pointer'}}
          />
          <span>
            Show crops{' '}
            <span style={{opacity: 0.6, fontSize: 11}}>(blossoms · oranges · almonds)</span>
          </span>
        </label>

        <div style={{fontWeight: 600, marginBottom: 8, color: '#adf0ad'}}>Forest zones</div>
        {ZONES.map((z) => (
          <div key={z.label} style={{display: 'flex', alignItems: 'center', marginBottom: 5}}>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 3,
                background: z.color,
                marginRight: 8,
                border: '1px solid rgba(255,255,255,0.3)',
                flexShrink: 0
              }}
            />
            <span style={{opacity: 0.9}}>{z.label}</span>
          </div>
        ))}

        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: '1px solid rgba(255,255,255,0.15)',
            fontSize: 11,
            opacity: 0.65
          }}
        >
          {FOREST_DATA.length} trees · drag to orbit
        </div>
      </div>
    </div>
  );
}
