// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {OrthographicViewState} from '@deck.gl/core';

import React, {useState, useMemo, ReactElement} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {TextLayer, LineLayer} from '@deck.gl/layers';
import {MultiHorizonGraphLayer} from '@deck.gl-community/infovis-layers';

const INITIAL_VIEW_STATE: OrthographicViewState = {
  target: [400, 300, 0],
  zoom: 0
};

type ExampleDataType = 'sine' | 'sine+noise' | 'noise' | 'flat' | 'sawtooth' | 'square';

type ExampleData = {
  name: string;
  type: ExampleDataType;
  values: Float32Array;
  scale: number;
};

const POINTS_PER_SERIES = 10000;

const generateSeriesData = (
  type: ExampleDataType,
  count: number = POINTS_PER_SERIES
): Float32Array => {
  const seriesValues = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i * 0.0015;

    switch (type) {
      case 'sine':
        seriesValues[i] = Math.sin(t) * 100;
        break;
      case 'sine+noise':
        seriesValues[i] = Math.sin(t) * 100 + (Math.random() - 0.5) * 30;
        break;
      case 'noise':
        seriesValues[i] = (Math.random() - 0.5) * 100;
        break;
      case 'flat':
        seriesValues[i] = 42; // Answer to Everything
        break;
      case 'sawtooth': {
        const period = 2 * Math.PI;
        const phaseShifted = t % period;
        seriesValues[i] = (phaseShifted / Math.PI - 1) * 100;
        break;
      }
      case 'square':
        seriesValues[i] = Math.sin(t) > 0 ? 100 : -100;
        break;
      default:
        throw new Error('bad data type');
    }
  }

  return seriesValues;
};

// Helper functions to convert between RGB arrays and hex colors
const rgbToHex = (rgb: [number, number, number]) => {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0];
};

export default function App(): ReactElement {
  const [bands, setBands] = useState(2);
  const [seriesCount, setSeriesCount] = useState(5);
  const [seriesTypes, setSeriesTypes] = useState<ExampleDataType[]>([
    'sine',
    'sine+noise',
    'noise',
    'sawtooth',
    'square'
  ]);
  const [dividerWidth, setDividerWidth] = useState(0.75);

  // Color controls
  const [positiveColor, setPositiveColor] = useState<[number, number, number]>([0, 128, 0]);
  const [negativeColor, setNegativeColor] = useState<[number, number, number]>([0, 0, 255]);
  const [dividerColor, setDividerColor] = useState<[number, number, number]>([0, 0, 0]);

  // Position and size controls
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [width, setWidth] = useState(800);
  const [heightPerSeries, setHeightPerSeries] = useState(25);

  const height = heightPerSeries * seriesCount;

  // Mouse tracking for crosshair
  const [mousePosition, setMousePosition] = useState<[number, number] | null>(null);

  // Generate sample time-series data as series arrays

  const sampleData = useMemo(() => {
    const _sampleData: Float32Array[] = [];

    for (let series = 0; series < 5; series++) {
      _sampleData.push(generateSeriesData(seriesTypes[series]));
    }

    return _sampleData;
  }, [seriesTypes]);

  const data = useMemo(() => {
    const _data: ExampleData[] = [];

    for (let series = 0; series < seriesCount; series++) {
      _data.push({
        name: `Series ${series + 1}`,
        type: seriesTypes[series % 5],
        values: sampleData[series % 5],
        scale: 120
      });
    }

    return _data;
  }, [seriesCount, seriesTypes]);

  // Generate text labels for each series
  const textLabels = useMemo(() => {
    const totalDividerSpace = dividerWidth * (seriesCount + 1);
    const availableHeight = height - totalDividerSpace;
    const seriesHeight = availableHeight / seriesCount;

    return data.map((series, index) => ({
      text: `${series.name} (${series.type})`,
      position: [
        x - 10,
        y + dividerWidth + index * (seriesHeight + dividerWidth) + seriesHeight / 2,
        0
      ],
      size: 12,
      color: [80, 80, 80],
      angle: 0,
      textAnchor: 'end',
      alignmentBaseline: 'center'
    }));
  }, [data, seriesCount, dividerWidth, height, x, y]);

  // Calculate intersection values when mouse is over the chart
  const intersectionData = useMemo(() => {
    if (!mousePosition) return [];

    const [mouseX] = mousePosition;

    // Check if mouse is within chart X bounds
    if (mouseX < x || mouseX > x + width) {
      return [];
    }

    // Calculate which x-index we're at in the data
    const xRatio = (mouseX - x) / width;
    const dataIndex = Math.round(xRatio * (POINTS_PER_SERIES - 1)); // 0-99 data points

    if (dataIndex < 0 || dataIndex >= POINTS_PER_SERIES) return [];

    const totalDividerSpace = dividerWidth * (seriesCount + 1);
    const availableHeight = height - totalDividerSpace;
    const seriesHeight = availableHeight / seriesCount;

    // Show values for ALL series when mouse is within chart X bounds
    return data.map((series, index) => {
      const seriesBottom = y + dividerWidth + index * (seriesHeight + dividerWidth);
      const value = series.values[dataIndex];
      const seriesCenter = seriesBottom + seriesHeight / 2;

      return {
        text: `${value.toFixed(1)}`,
        position: [x + width + 10, seriesCenter, 0],
        size: 12,
        color: [80, 80, 80],
        angle: 0,
        textAnchor: 'start',
        alignmentBaseline: 'center'
      };
    });
  }, [mousePosition, data, x, y, width, height, seriesCount, dividerWidth]);

  // Vertical line data
  const verticalLineData = useMemo(() => {
    if (!mousePosition) return [];

    const [mouseX] = mousePosition;

    // Only show line if mouse is within chart X bounds
    if (mouseX < x || mouseX > x + width) return [];

    return [
      {
        sourcePosition: [mouseX, y, 0],
        targetPosition: [mouseX, y + height, 0]
      }
    ];
  }, [mousePosition, x, y, width, height]);

  const layers = [
    new MultiHorizonGraphLayer({
      id: 'horizon-graph-layer',
      data,
      bands,
      dividerWidth,
      positiveColor,
      negativeColor,
      dividerColor,
      x,
      y,
      width,
      height
    }),
    new TextLayer({
      id: 'series-labels',
      data: textLabels,
      getText: (d: any) => d.text,
      getPosition: (d: any) => d.position,
      getSize: (d: any) => d.size,
      getColor: (d: any) => d.color,
      getAngle: (d: any) => d.angle,
      getTextAnchor: (d: any) => d.textAnchor,
      getAlignmentBaseline: (d: any) => d.alignmentBaseline,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'normal'
    }),
    new LineLayer({
      id: 'vertical-crosshair',
      data: verticalLineData,
      getSourcePosition: (d: any) => d.sourcePosition,
      getTargetPosition: (d: any) => d.targetPosition,
      getColor: [0, 0, 0, 200],
      getWidth: 1,
      widthUnits: 'pixels'
    }),
    new TextLayer({
      id: 'intersection-values',
      data: intersectionData,
      getText: (d: any) => d.text,
      getPosition: (d: any) => d.position,
      getSize: (d: any) => d.size,
      getColor: (d: any) => d.color,
      getAngle: (d: any) => d.angle,
      getTextAnchor: (d: any) => d.textAnchor,
      getAlignmentBaseline: (d: any) => d.alignmentBaseline,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'normal'
    })
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 260px',
        width: '100vw',
        height: '100vh'
      }}
    >
      <div style={{minWidth: 0, position: 'relative', overflow: 'hidden'}}>
        <DeckGL
          views={new OrthographicView()}
          initialViewState={INITIAL_VIEW_STATE}
          controller={true}
          layers={layers}
          onHover={(info) => {
            if (info.coordinate) {
              setMousePosition([info.coordinate[0], info.coordinate[1]]);
            } else {
              setMousePosition(null);
            }
          }}
        />
      </div>
      <aside
        style={{
          width: '260px',
          height: '100vh',
          overflowY: 'auto',
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '15px',
          fontFamily: 'Arial, sans-serif',
          boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
          borderLeft: '1px solid #ddd'
        }}
      >
        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', fontWeight: 'bold', marginBottom: '5px'}}>
            Number of Series:
          </label>
          <select
            value={seriesCount}
            onChange={(e) => setSeriesCount(Number(e.target.value))}
            style={{width: '100%', padding: '5px'}}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={100}>100</option>
            <option value={1000}>1000</option>
            <option value={10000}>10000</option>
          </select>
        </div>

        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', fontWeight: 'bold', marginBottom: '5px'}}>Bands:</label>
          <select
            value={bands}
            onChange={(e) => setBands(Number(e.target.value))}
            style={{width: '100%', padding: '5px'}}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
            <option value={6}>6</option>
          </select>
        </div>

        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', fontWeight: 'bold', marginBottom: '5px'}}>
            Divider Line Width:
          </label>
          <input
            type="range"
            min="0"
            max="10"
            step="0.25"
            value={dividerWidth}
            onChange={(e) => setDividerWidth(Number(e.target.value))}
            style={{width: '100%'}}
          />
          <div style={{fontSize: '12px', color: '#666', textAlign: 'center'}}>{dividerWidth}</div>
        </div>

        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', fontWeight: 'bold', marginBottom: '10px'}}>
            Series Data Types:
          </label>
          {Array.from({length: 5}, (_, i) => (
            <div key={i} style={{marginBottom: '8px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '3px'}}>
                Series {i + 1}:
              </label>
              <select
                value={seriesTypes[i]}
                onChange={(e) => {
                  const newTypes = [...seriesTypes];
                  newTypes[i] = e.target.value as ExampleDataType;
                  setSeriesTypes(newTypes);
                }}
                style={{width: '100%', padding: '3px', fontSize: '12px'}}
              >
                <option value="sine">Sine Wave</option>
                <option value="sine+noise">Sine Wave + Noise</option>
                <option value="noise">Noise Only</option>
                <option value="flat">Flat Line</option>
                <option value="sawtooth">Sawtooth</option>
                <option value="square">Square Wave</option>
              </select>
            </div>
          ))}
        </div>

        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', fontWeight: 'bold', marginBottom: '10px'}}>
            Colors:
          </label>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '5px'}}>
              Positive Color:
            </label>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <input
                type="color"
                value={rgbToHex(positiveColor)}
                onChange={(e) => setPositiveColor(hexToRgb(e.target.value))}
                style={{
                  width: '50px',
                  height: '30px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              />
              <span style={{fontSize: '11px', color: '#666', fontFamily: 'monospace'}}>
                RGB({positiveColor.join(', ')})
              </span>
            </div>
          </div>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '5px'}}>
              Negative Color:
            </label>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <input
                type="color"
                value={rgbToHex(negativeColor)}
                onChange={(e) => setNegativeColor(hexToRgb(e.target.value))}
                style={{
                  width: '50px',
                  height: '30px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              />
              <span style={{fontSize: '11px', color: '#666', fontFamily: 'monospace'}}>
                RGB({negativeColor.join(', ')})
              </span>
            </div>
          </div>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '5px'}}>
              Divider Color:
            </label>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <input
                type="color"
                value={rgbToHex(dividerColor)}
                onChange={(e) => setDividerColor(hexToRgb(e.target.value))}
                style={{
                  width: '50px',
                  height: '30px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              />
              <span style={{fontSize: '11px', color: '#666', fontFamily: 'monospace'}}>
                RGB({dividerColor.join(', ')})
              </span>
            </div>
          </div>
        </div>

        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', fontWeight: 'bold', marginBottom: '10px'}}>
            Position & Size:
          </label>
          <div style={{marginBottom: '8px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '3px'}}>
              X Position: {x}
            </label>
            <input
              type="range"
              min="-2000"
              max="2000"
              value={x}
              onChange={(e) => setX(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
          <div style={{marginBottom: '8px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '3px'}}>
              Y Position: {y}
            </label>
            <input
              type="range"
              min="-2000"
              max="2000"
              value={y}
              onChange={(e) => setY(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
          <div style={{marginBottom: '8px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '3px'}}>
              Width: {width}
            </label>
            <input
              type="range"
              min="1"
              max="5000"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
          <div style={{marginBottom: '8px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '3px'}}>
              Height (per series): {heightPerSeries}
            </label>
            <input
              type="range"
              min="1"
              max="500"
              value={heightPerSeries}
              onChange={(e) => setHeightPerSeries(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
