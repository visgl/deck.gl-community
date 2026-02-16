// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Ported from https://github.com/ubilabs/outlined-path-layer example

import React, {useMemo, useState} from 'react';
import DeckGL from '@deck.gl/react';
import type {Color, MapViewState, Unit} from '@deck.gl/core';
import {OutlinedPathLayer} from '@deck.gl-community/layers';

// --- Data types ---

type Route = {
  name: string;
  path: [number, number][];
  color: Color;
};

// --- Helper: generate a sinusoidal path that weaves across the view ---

const CENTER_LNG = -122.42;
const CENTER_LAT = 37.785;
const STEPS = 40;

function sinePath(
  amplitude: number,
  frequency: number,
  phase: number,
  angle: number
): [number, number][] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS - 0.5) * 2;
    const along = t * 0.015;
    const across = Math.sin(t * Math.PI * frequency + phase) * amplitude * 0.005;
    const dx = along * cos - across * sin;
    const dy = along * sin + across * cos;
    points.push([CENTER_LNG + dx, CENTER_LAT + dy]);
  }
  return points;
}

// --- Sample data: weaving routes that cross each other ---

const ROUTES: Route[] = [
  {name: 'Blue Weave', path: sinePath(1.2, 3, 0, 0), color: [65, 140, 255]},
  {name: 'Red Weave', path: sinePath(1.2, 3, Math.PI, 0), color: [240, 80, 80]},
  {name: 'Green Diagonal', path: sinePath(1.0, 2.5, 0, Math.PI / 4), color: [2, 200, 120]},
  {name: 'Orange Diagonal', path: sinePath(1.0, 2.5, Math.PI, -Math.PI / 4), color: [255, 160, 40]},
  {name: 'Purple Cross', path: sinePath(1.4, 4, Math.PI / 2, Math.PI / 2), color: [180, 100, 255]}
];

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: CENTER_LNG,
  latitude: CENTER_LAT,
  zoom: 14,
  pitch: 0,
  bearing: 0
};

// --- UI helpers ---

function hexToRgb(hex: string): Color {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0];
}

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 24
};
const labelStyle: React.CSSProperties = {flex: '0 0 140px', textAlign: 'right'};
const valueStyle: React.CSSProperties = {flex: '0 0 28px', textAlign: 'right', fontVariantNumeric: 'tabular-nums'};

function Slider({
  label, value, min, max, step, onChange
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={row}>
      <span style={labelStyle}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{flex: 1}} onChange={(e) => onChange(Number(e.target.value))} />
      <span style={valueStyle}>{value}</span>
    </div>
  );
}

function Dropdown({
  label, value, options, onChange
}: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={row}>
      <span style={labelStyle}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{flex: 1}}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Checkbox({
  label, value, onChange
}: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={row}>
      <span style={labelStyle}>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

function ColorPicker({
  label, value, onChange
}: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={row}>
      <span style={labelStyle}>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// --- App ---

export default function App(): React.ReactElement {
  const [width, setWidth] = useState(6);
  const [widthUnits, setWidthUnits] = useState<Unit>('pixels');
  const [outlineWidth, setOutlineWidth] = useState(2);
  const [outlineWidthUnits, setOutlineWidthUnits] = useState<Unit>('pixels');
  const [outlineColor, setOutlineColor] = useState('#1e1e1e');
  const [widthMinPixels, setWidthMinPixels] = useState(4);
  const [widthMaxPixels, setWidthMaxPixels] = useState(20);
  const [outlineMinPixels, setOutlineMinPixels] = useState(1);
  const [outlineMaxPixels, setOutlineMaxPixels] = useState(10);
  const [capRounded, setCapRounded] = useState(true);
  const [jointRounded, setJointRounded] = useState(true);
  const [miterLimit, setMiterLimit] = useState(4);

  const layers = useMemo(
    () => [
      new OutlinedPathLayer<Route>({
        id: 'outlined-paths',
        data: ROUTES,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 0, 128],
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: width,
        widthUnits,
        widthMinPixels,
        widthMaxPixels,
        capRounded,
        jointRounded,
        miterLimit,
        getOutlineColor: hexToRgb(outlineColor),
        getOutlineWidth: outlineWidth,
        outlineWidthUnits,
        outlineMinPixels,
        outlineMaxPixels,
        parameters: {depthCompare: 'always'}
      })
    ],
    [
      width, widthUnits, outlineWidth, outlineWidthUnits, outlineColor,
      widthMinPixels, widthMaxPixels, outlineMinPixels, outlineMaxPixels,
      capRounded, jointRounded, miterLimit
    ]
  );

  return (
    <>
      <DeckGL
        layers={layers}
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        parameters={{clearColor: [0.12, 0.12, 0.14, 1] as any}}
        style={{position: 'absolute', width: '100%', height: '100%'}}
      />
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'white',
          padding: 10,
          borderRadius: 5,
          fontFamily: 'monospace',
          fontSize: 13,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minWidth: 360,
          zIndex: 1
        }}
      >
        <Slider label="Width" value={width} min={0} max={20} step={1} onChange={setWidth} />
        <Dropdown label="Width Units" value={widthUnits}
          options={['pixels', 'meters']} onChange={(v) => setWidthUnits(v as Unit)} />
        <Slider label="Outline Width" value={outlineWidth} min={0} max={10} step={1}
          onChange={setOutlineWidth} />
        <Dropdown label="Outline Width Units" value={outlineWidthUnits}
          options={['pixels', 'meters']} onChange={(v) => setOutlineWidthUnits(v as Unit)} />
        <ColorPicker label="Outline Color" value={outlineColor} onChange={setOutlineColor} />
        <Slider label="Width Min Pixels" value={widthMinPixels} min={0} max={20} step={1}
          onChange={setWidthMinPixels} />
        <Slider label="Width Max Pixels" value={widthMaxPixels} min={0} max={50} step={1}
          onChange={setWidthMaxPixels} />
        <Slider label="Outline Min Pixels" value={outlineMinPixels} min={0} max={10} step={1}
          onChange={setOutlineMinPixels} />
        <Slider label="Outline Max Pixels" value={outlineMaxPixels} min={0} max={20} step={1}
          onChange={setOutlineMaxPixels} />
        <Checkbox label="Cap Rounded" value={capRounded} onChange={setCapRounded} />
        <Checkbox label="Joint Rounded" value={jointRounded} onChange={setJointRounded} />
        <Slider label="Miter Limit" value={miterLimit} min={1} max={10} step={1}
          onChange={setMiterLimit} />
      </div>
    </>
  );
}
