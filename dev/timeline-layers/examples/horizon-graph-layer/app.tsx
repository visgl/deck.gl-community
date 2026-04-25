// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView, type OrthographicViewState} from '@deck.gl/core';
import {LineLayer, TextLayer} from '@deck.gl/layers';
import {MultiHorizonGraphLayer} from '@deck.gl-community/timeline-layers';
import {
  MarkdownPanel,
  SettingsPanel,
  type SettingsSchema,
  type SettingsState
} from '@deck.gl-community/panels';
import {
  BoxWidget,
  SidebarWidget
} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

type ExampleDataType = 'sine' | 'sine+noise' | 'noise' | 'flat' | 'sawtooth' | 'square';

type ExampleData = {
  name: string;
  type: ExampleDataType;
  values: Float32Array;
  scale: number;
};

type LabelDatum = {
  text: string;
  position: [number, number, number];
  size: number;
  color: [number, number, number];
  angle: number;
  textAnchor: 'start' | 'middle' | 'end';
  alignmentBaseline: 'top' | 'center' | 'bottom';
};

type CrosshairDatum = {
  sourcePosition: [number, number, number];
  targetPosition: [number, number, number];
};

type HorizonGraphSettings = {
  data: {
    bands: number;
    dividerWidth: number;
    seriesCount: number;
    seriesType1: ExampleDataType;
    seriesType2: ExampleDataType;
    seriesType3: ExampleDataType;
    seriesType4: ExampleDataType;
    seriesType5: ExampleDataType;
  };
  colors: {
    positiveHex: string;
    negativeHex: string;
    dividerHex: string;
  };
  layout: {
    x: number;
    y: number;
    width: number;
    heightPerSeries: number;
  };
};

type ExampleDerivedState = {
  data: ExampleData[];
  height: number;
  textLabels: LabelDatum[];
};

type ExampleState = {
  settings: HorizonGraphSettings;
  derived: ExampleDerivedState;
  mousePosition: [number, number] | null;
};

type HorizonExampleConfig = {
  layerId?: string;
  sidebarTitle?: string;
  infoTitle?: string;
  infoMarkdown?: string;
  showInfoWidget?: boolean;
};

const VIEW = new OrthographicView({id: 'ortho'});

const INITIAL_VIEW_STATE: OrthographicViewState = {
  target: [400, 300, 0],
  zoom: 0
};

const POINTS_PER_SERIES = 10000;
const MAX_SERIES_VARIANTS = 5;
const SERIES_COUNT_OPTIONS = [1, 2, 3, 4, 5, 10, 20, 100, 1000, 10000];
const BAND_OPTIONS = [1, 2, 3, 4, 5, 6];
const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%',
  overflow: 'hidden',
  background: 'rgb(255, 255, 255)'
} as const;

const SERIES_TYPE_OPTIONS: Array<{label: string; value: ExampleDataType}> = [
  {label: 'Sine Wave', value: 'sine'},
  {label: 'Sine Wave + Noise', value: 'sine+noise'},
  {label: 'Noise Only', value: 'noise'},
  {label: 'Flat Line', value: 'flat'},
  {label: 'Sawtooth', value: 'sawtooth'},
  {label: 'Square Wave', value: 'square'}
];

const INITIAL_SETTINGS: HorizonGraphSettings = {
  data: {
    bands: 2,
    dividerWidth: 0.75,
    seriesCount: 5,
    seriesType1: 'sine',
    seriesType2: 'sine+noise',
    seriesType3: 'noise',
    seriesType4: 'sawtooth',
    seriesType5: 'square'
  },
  colors: {
    positiveHex: '#008000',
    negativeHex: '#0000ff',
    dividerHex: '#000000'
  },
  layout: {
    x: 0,
    y: 0,
    width: 800,
    heightPerSeries: 25
  }
};

const SETTINGS_SCHEMA: SettingsSchema = {
  title: 'Horizon Graph Controls',
  sections: [
    {
      id: 'data',
      name: 'Data',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'data.seriesCount',
          label: 'Number of Series',
          type: 'select',
          options: SERIES_COUNT_OPTIONS.map((value) => ({label: String(value), value})),
          description: 'Controls how many repeated series rows are drawn.'
        },
        {
          name: 'data.bands',
          label: 'Bands',
          type: 'select',
          options: BAND_OPTIONS.map((value) => ({label: String(value), value})),
          description: 'Number of horizon bands per series.'
        },
        {
          name: 'data.dividerWidth',
          label: 'Divider Line Width',
          type: 'number',
          min: 0,
          max: 10,
          step: 0.25,
          description: 'Thickness of the divider line between series.'
        }
      ]
    },
    {
      id: 'series-types',
      name: 'Series Data Types',
      initiallyCollapsed: false,
      settings: Array.from({length: MAX_SERIES_VARIANTS}, (_, index) => ({
        name: `data.seriesType${index + 1}`,
        label: `Series ${index + 1}`,
        type: 'select' as const,
        options: SERIES_TYPE_OPTIONS,
        description: 'Source waveform reused across repeated rows.'
      }))
    },
    {
      id: 'colors',
      name: 'Colors',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'colors.positiveHex',
          label: 'Positive Color',
          type: 'string',
          description: 'Hex color for positive values, for example #008000.'
        },
        {
          name: 'colors.negativeHex',
          label: 'Negative Color',
          type: 'string',
          description: 'Hex color for negative values, for example #0000ff.'
        },
        {
          name: 'colors.dividerHex',
          label: 'Divider Color',
          type: 'string',
          description: 'Hex color for divider lines, for example #000000.'
        }
      ]
    },
    {
      id: 'layout',
      name: 'Position & Size',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'layout.x',
          label: 'X Position',
          type: 'number',
          min: -2000,
          max: 2000,
          step: 1
        },
        {
          name: 'layout.y',
          label: 'Y Position',
          type: 'number',
          min: -2000,
          max: 2000,
          step: 1
        },
        {
          name: 'layout.width',
          label: 'Width',
          type: 'number',
          min: 1,
          max: 5000,
          step: 1
        },
        {
          name: 'layout.heightPerSeries',
          label: 'Height (per series)',
          type: 'number',
          min: 1,
          max: 500,
          step: 1
        }
      ]
    }
  ]
};

const DEFAULT_EXAMPLE_CONFIG: Required<HorizonExampleConfig> = {
  layerId: 'horizon-graph-layer',
  sidebarTitle: 'Horizon Graph Controls',
  infoTitle: 'HorizonGraphLayer',
  infoMarkdown:
    'Interactive horizon graph demo built with `MultiHorizonGraphLayer`.\n\nAdjust the series count, waveform inputs, colors, and layout from the sidebar.',
  showInfoWidget: true
};

export function mountHorizonGraphLayerExample(
  container: HTMLElement,
  config: HorizonExampleConfig = {}
): () => void {
  const resolvedConfig = {...DEFAULT_EXAMPLE_CONFIG, ...config};
  const rootElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  container.replaceChildren(rootElement);

  const state: ExampleState = {
    settings: cloneSettings(INITIAL_SETTINGS),
    derived: buildDerivedState(INITIAL_SETTINGS),
    mousePosition: null
  };

  const settingsPanel = new SettingsPanel({
    id: 'horizon-graph-controls',
    label: resolvedConfig.sidebarTitle,
    schema: SETTINGS_SCHEMA,
    settings: state.settings,
    onSettingsChange: handleSettingsChange
  });

  const sidebarWidget = new SidebarWidget({
    id: 'horizon-graph-sidebar',
    placement: 'top-right',
    side: 'right',
    widthPx: 360,
    title: resolvedConfig.sidebarTitle,
    triggerLabel: 'Toggle controls',
    button: true,
    defaultOpen: true,
    panel: settingsPanel
  });

  const widgets = [];

  if (resolvedConfig.showInfoWidget && resolvedConfig.infoTitle && resolvedConfig.infoMarkdown) {
    widgets.push(
      new BoxWidget({
        id: `${resolvedConfig.layerId}-info`,
        placement: 'top-left',
        widthPx: 360,
        title: resolvedConfig.infoTitle,
        collapsible: false,
        panel: new MarkdownPanel({
          id: `${resolvedConfig.layerId}-info-panel`,
          title: '',
          markdown: resolvedConfig.infoMarkdown
        })
      })
    );
  }

  widgets.push(sidebarWidget);

  const deck = new Deck({
    parent: rootElement,
    width: '100%',
    height: '100%',
    views: VIEW,
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    widgets,
    layers: buildLayers(state, resolvedConfig),
    onHover: (info) => {
      const nextMousePosition = info.coordinate
        ? [info.coordinate[0], info.coordinate[1]] as [number, number]
        : null;

      if (isSameMousePosition(state.mousePosition, nextMousePosition)) {
        return;
      }

      state.mousePosition = nextMousePosition;
      syncDeck();
    }
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };

  function handleSettingsChange(nextSettingsState: SettingsState): void {
    state.settings = sanitizeSettings(state.settings, nextSettingsState);
    state.derived = buildDerivedState(state.settings);
    syncDeck();
  }

  function syncDeck(): void {
    deck.setProps({
      layers: buildLayers(state, resolvedConfig)
    });
  }
}

export function mountMultiHorizonGraphLayerExample(
  container: HTMLElement,
  config: HorizonExampleConfig = {}
): () => void {
  return mountHorizonGraphLayerExample(container, {
    layerId: 'multi-horizon-graph-layer',
    sidebarTitle: 'Multi Horizon Graph Controls',
    infoTitle: 'MultiHorizonGraphLayer',
    infoMarkdown:
      'Multiple stacked horizon graphs rendered inside one example frame.\n\nUse the sidebar to change the repeated waveforms, band count, colors, and overall layout.',
    ...config
  });
}

function buildLayers(state: ExampleState, config: Required<HorizonExampleConfig>) {
  const {settings, derived, mousePosition} = state;
  const {x, y, width} = settings.layout;
  const {height} = derived;
  const positiveColor = hexToRgb(settings.colors.positiveHex);
  const negativeColor = hexToRgb(settings.colors.negativeHex);
  const dividerColor = hexToRgb(settings.colors.dividerHex);

  return [
    new MultiHorizonGraphLayer({
      id: config.layerId,
      data: derived.data,
      bands: settings.data.bands,
      dividerWidth: settings.data.dividerWidth,
      positiveColor,
      negativeColor,
      dividerColor,
      x,
      y,
      width,
      height
    }),
    new TextLayer<LabelDatum>({
      id: 'series-labels',
      data: derived.textLabels,
      getText: (datum) => datum.text,
      getPosition: (datum) => datum.position,
      getSize: (datum) => datum.size,
      getColor: (datum) => datum.color,
      getAngle: (datum) => datum.angle,
      getTextAnchor: (datum) => datum.textAnchor,
      getAlignmentBaseline: (datum) => datum.alignmentBaseline,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'normal'
    }),
    new LineLayer<CrosshairDatum>({
      id: 'vertical-crosshair',
      data: buildVerticalLineData(mousePosition, x, y, width, height),
      getSourcePosition: (datum) => datum.sourcePosition,
      getTargetPosition: (datum) => datum.targetPosition,
      getColor: [0, 0, 0, 200],
      getWidth: 1,
      widthUnits: 'pixels'
    }),
    new TextLayer<LabelDatum>({
      id: 'intersection-values',
      data: buildIntersectionData(state),
      getText: (datum) => datum.text,
      getPosition: (datum) => datum.position,
      getSize: (datum) => datum.size,
      getColor: (datum) => datum.color,
      getAngle: (datum) => datum.angle,
      getTextAnchor: (datum) => datum.textAnchor,
      getAlignmentBaseline: (datum) => datum.alignmentBaseline,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'normal'
    })
  ];
}

function buildDerivedState(settings: HorizonGraphSettings): ExampleDerivedState {
  const height = settings.layout.heightPerSeries * settings.data.seriesCount;
  const seriesTypes = getSeriesTypes(settings);
  const sampleData = seriesTypes.map((seriesType) => generateSeriesData(seriesType));
  const data = Array.from({length: settings.data.seriesCount}, (_, seriesIndex) => ({
    name: `Series ${seriesIndex + 1}`,
    type: seriesTypes[seriesIndex % MAX_SERIES_VARIANTS],
    values: sampleData[seriesIndex % MAX_SERIES_VARIANTS],
    scale: 120
  }));

  const totalDividerSpace = settings.data.dividerWidth * (settings.data.seriesCount + 1);
  const availableHeight = height - totalDividerSpace;
  const seriesHeight = availableHeight / settings.data.seriesCount;
  const textLabels = data.map((series, index) => ({
    text: `${series.name} (${series.type})`,
    position: [
      settings.layout.x - 10,
      settings.layout.y +
        settings.data.dividerWidth +
        index * (seriesHeight + settings.data.dividerWidth) +
        seriesHeight / 2,
      0
    ] as [number, number, number],
    size: 12,
    color: [80, 80, 80] as [number, number, number],
    angle: 0,
    textAnchor: 'end' as const,
    alignmentBaseline: 'center' as const
  }));

  return {
    data,
    height,
    textLabels
  };
}

function buildIntersectionData(state: ExampleState): LabelDatum[] {
  const {mousePosition, settings, derived} = state;
  if (!mousePosition) {
    return [];
  }

  const [mouseX] = mousePosition;
  const {x, y, width} = settings.layout;
  if (mouseX < x || mouseX > x + width) {
    return [];
  }

  const dataIndex = Math.round(((mouseX - x) / width) * (POINTS_PER_SERIES - 1));
  if (dataIndex < 0 || dataIndex >= POINTS_PER_SERIES) {
    return [];
  }

  const totalDividerSpace = settings.data.dividerWidth * (settings.data.seriesCount + 1);
  const availableHeight = derived.height - totalDividerSpace;
  const seriesHeight = availableHeight / settings.data.seriesCount;

  return derived.data.map((series, index) => {
    const seriesBottom =
      y + settings.data.dividerWidth + index * (seriesHeight + settings.data.dividerWidth);
    const value = series.values[dataIndex];
    const seriesCenter = seriesBottom + seriesHeight / 2;

    return {
      text: value.toFixed(1),
      position: [x + width + 10, seriesCenter, 0],
      size: 12,
      color: [80, 80, 80],
      angle: 0,
      textAnchor: 'start',
      alignmentBaseline: 'center'
    };
  });
}

function buildVerticalLineData(
  mousePosition: [number, number] | null,
  x: number,
  y: number,
  width: number,
  height: number
): CrosshairDatum[] {
  if (!mousePosition) {
    return [];
  }

  const [mouseX] = mousePosition;
  if (mouseX < x || mouseX > x + width) {
    return [];
  }

  return [
    {
      sourcePosition: [mouseX, y, 0],
      targetPosition: [mouseX, y + height, 0]
    }
  ];
}

function generateSeriesData(
  type: ExampleDataType,
  count: number = POINTS_PER_SERIES
): Float32Array {
  const seriesValues = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const t = index * 0.0015;

    switch (type) {
      case 'sine':
        seriesValues[index] = Math.sin(t) * 100;
        break;
      case 'sine+noise':
        seriesValues[index] = Math.sin(t) * 100 + (Math.random() - 0.5) * 30;
        break;
      case 'noise':
        seriesValues[index] = (Math.random() - 0.5) * 100;
        break;
      case 'flat':
        seriesValues[index] = 42;
        break;
      case 'sawtooth': {
        const period = 2 * Math.PI;
        const phaseShifted = t % period;
        seriesValues[index] = (phaseShifted / Math.PI - 1) * 100;
        break;
      }
      case 'square':
        seriesValues[index] = Math.sin(t) > 0 ? 100 : -100;
        break;
      default:
        throw new Error('Unsupported data type');
    }
  }

  return seriesValues;
}

function sanitizeSettings(
  previous: HorizonGraphSettings,
  nextState: SettingsState
): HorizonGraphSettings {
  const nextData = asRecord(nextState.data);
  const nextColors = asRecord(nextState.colors);
  const nextLayout = asRecord(nextState.layout);

  return {
    data: {
      seriesCount: readNumber(
        nextData.seriesCount,
        previous.data.seriesCount,
        1,
        10000,
        1
      ),
      bands: readNumber(nextData.bands, previous.data.bands, 1, 6, 1),
      dividerWidth: readNumber(
        nextData.dividerWidth,
        previous.data.dividerWidth,
        0,
        10,
        0.25
      ),
      seriesType1: readSeriesType(nextData.seriesType1, previous.data.seriesType1),
      seriesType2: readSeriesType(nextData.seriesType2, previous.data.seriesType2),
      seriesType3: readSeriesType(nextData.seriesType3, previous.data.seriesType3),
      seriesType4: readSeriesType(nextData.seriesType4, previous.data.seriesType4),
      seriesType5: readSeriesType(nextData.seriesType5, previous.data.seriesType5)
    },
    colors: {
      positiveHex: readHexColor(nextColors.positiveHex, previous.colors.positiveHex),
      negativeHex: readHexColor(nextColors.negativeHex, previous.colors.negativeHex),
      dividerHex: readHexColor(nextColors.dividerHex, previous.colors.dividerHex)
    },
    layout: {
      x: readNumber(nextLayout.x, previous.layout.x, -2000, 2000, 1),
      y: readNumber(nextLayout.y, previous.layout.y, -2000, 2000, 1),
      width: readNumber(nextLayout.width, previous.layout.width, 1, 5000, 1),
      heightPerSeries: readNumber(
        nextLayout.heightPerSeries,
        previous.layout.heightPerSeries,
        1,
        500,
        1
      )
    }
  };
}

function getSeriesTypes(settings: HorizonGraphSettings): ExampleDataType[] {
  return [
    settings.data.seriesType1,
    settings.data.seriesType2,
    settings.data.seriesType3,
    settings.data.seriesType4,
    settings.data.seriesType5
  ];
}

function readHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = normalizeHexColor(value);
  return normalized ?? fallback;
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(trimmed);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function readNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  step: number
): number {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const clamped = Math.min(max, Math.max(min, numericValue));
  return step >= 1 ? Math.round(clamped / step) * step : Number(clamped.toFixed(4));
}

function readSeriesType(value: unknown, fallback: ExampleDataType): ExampleDataType {
  return SERIES_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as ExampleDataType)
    : fallback;
}

function cloneSettings(settings: HorizonGraphSettings): HorizonGraphSettings {
  return {
    data: {...settings.data},
    colors: {...settings.colors},
    layout: {...settings.layout}
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return [0, 0, 0];
  }

  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16)
  ];
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function isSameMousePosition(
  previous: [number, number] | null,
  next: [number, number] | null
): boolean {
  if (previous === next) {
    return true;
  }

  if (!previous || !next) {
    return false;
  }

  return previous[0] === next[0] && previous[1] === next[1];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
