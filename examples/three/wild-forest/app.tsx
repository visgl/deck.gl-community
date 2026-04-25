// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type MapViewState} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/three';
import type {CropConfig, Season, TreeType} from '@deck.gl-community/three';
import {
  ColumnPanel,
  CustomPanel,
  MarkdownPanel,
  SettingsPanel,
  type SettingsSchema,
  type SettingsState
} from '@deck.gl-community/panels';
import {
  BoxWidget
} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

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

type WildForestSettings = {
  render: {
    sizeScale: number;
    showCrops: boolean;
  };
};

type WildForestState = {
  settings: WildForestSettings;
};

type WildForestExampleOptions = {
  showControlsWidget?: boolean;
};

type ZoneInfo = {
  label: string;
  color: string;
};

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -0.022,
  latitude: 51.503,
  zoom: 13,
  pitch: 62,
  bearing: 20
};

const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%'
} as const;

const INITIAL_SETTINGS: WildForestSettings = {
  render: {
    sizeScale: 30,
    showCrops: true
  }
};

const SETTINGS_SCHEMA: SettingsSchema = {
  title: 'Wild Forest Controls',
  sections: [
    {
      id: 'render',
      name: 'Render',
      initiallyCollapsed: false,
      settings: [
        {
          name: 'render.sizeScale',
          label: 'Size Scale',
          type: 'number',
          min: 5,
          max: 80,
          step: 1,
          description: 'Scales tree geometry uniformly.'
        },
        {
          name: 'render.showCrops',
          label: 'Show Crops',
          type: 'boolean',
          description: 'Toggle blossoms, oranges, and almonds.'
        }
      ]
    }
  ]
};

const ZONES: ZoneInfo[] = [
  {label: 'Pine Forest (Summer)', color: '#006400'},
  {label: 'Oak Grove (Autumn)', color: '#b45314'},
  {label: 'Cherry Blossom (Spring)', color: '#ffb4c8'},
  {label: 'Palm Grove (Summer)', color: '#14911e'},
  {label: 'Birch Glade (Autumn)', color: '#e6b928'},
  {label: 'Oak Silhouettes (Winter)', color: 'rgba(100,80,80,0.4)'},
  {label: 'Birch Grove (Spring)', color: '#96d26e'},
  {label: 'Citrus Orchard (Fruiting)', color: '#ff8c00'},
  {label: 'Almond Grove (Harvest)', color: '#c39b5a'}
];

const FOREST_DATA = generateForest();

export function mountWildForestExample(
  container: HTMLElement,
  options: WildForestExampleOptions = {}
): () => void {
  const rootElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  container.replaceChildren(rootElement);

  const state: WildForestState = {
    settings: cloneSettings(INITIAL_SETTINGS)
  };

  const controlsWidget =
    options.showControlsWidget === false
      ? null
      : new BoxWidget({
          id: 'wild-forest-controls',
          placement: 'top-right',
          widthPx: 320,
          title: 'Wild Forest + Orchards',
          panel: buildControlPanel(state, handleSettingsChange)
        });

  const deck = new Deck({
    parent: rootElement,
    initialViewState: INITIAL_VIEW_STATE,
    controller: {
      maxPitch: 80
    },
    layers: buildLayers(state),
    parameters: {clearColor: [0.06, 0.1, 0.06, 1]},
    getTooltip: getTooltip,
    widgets: controlsWidget ? [controlsWidget] : []
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };

  function handleSettingsChange(nextSettings: SettingsState) {
    state.settings = cloneSettings(nextSettings as WildForestSettings);
    deck.setProps({layers: buildLayers(state)});
    controlsWidget?.setProps({
      panel: buildControlPanel(state, handleSettingsChange)
    });
  }
}

function buildLayers(state: WildForestState) {
  return [
    new TreeLayer<TreeDatum>({
      id: 'wild-forest',
      data: FOREST_DATA,
      getPosition: (datum) => datum.position,
      getTreeType: (datum) => datum.type,
      getHeight: (datum) => datum.height,
      getTrunkRadius: (datum) => datum.trunkRadius,
      getCanopyRadius: (datum) => datum.canopyRadius,
      getTrunkHeightFraction: (datum) => datum.trunkHeightFraction,
      getSeason: (datum) => datum.season,
      getBranchLevels: (datum) => datum.branchLevels || 3,
      getCrop: state.settings.render.showCrops ? (datum) => datum.crop : () => null,
      sizeScale: state.settings.render.sizeScale,
      pickable: true,
      updateTriggers: {
        getCrop: [state.settings.render.showCrops],
        sizeScale: [state.settings.render.sizeScale]
      }
    })
  ];
}

function buildControlPanel(
  state: WildForestState,
  onSettingsChange: (nextSettings: SettingsState) => void
) {
  return new ColumnPanel({
    id: 'wild-forest-panel',
    title: 'Wild Forest + Orchards',
    panels: {
      summary: new MarkdownPanel({
        id: 'summary',
        title: '',
        markdown: [
          'A procedural forest scene rendered with `TreeLayer`.',
          '',
          `- Trees: **${FOREST_DATA.length}**`,
          `- Size scale: **${state.settings.render.sizeScale.toFixed(1)}x**`,
          `- Crops: **${state.settings.render.showCrops ? 'visible' : 'hidden'}**`
        ].join('\n')
      }),
      settings: new SettingsPanel({
        id: 'settings',
        label: 'Controls',
        schema: SETTINGS_SCHEMA,
        settings: state.settings,
        onSettingsChange
      }),
      legend: new CustomPanel({
        id: 'legend',
        title: 'Forest Zones',
        onRenderHTML(hostElement) {
          const legend = hostElement.ownerDocument.createElement('div');
          applyElementStyle(legend, {
            display: 'grid',
            gap: '6px',
            fontSize: '12px'
          });

          for (const zone of ZONES) {
            const row = hostElement.ownerDocument.createElement('div');
            const swatch = hostElement.ownerDocument.createElement('span');
            const label = hostElement.ownerDocument.createElement('span');

            applyElementStyle(row, {
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            });
            applyElementStyle(swatch, {
              display: 'inline-block',
              width: '12px',
              height: '12px',
              borderRadius: '3px',
              background: zone.color,
              border: '1px solid rgba(0, 0, 0, 0.12)',
              flexShrink: '0'
            });

            label.textContent = zone.label;
            row.append(swatch, label);
            legend.append(row);
          }

          hostElement.replaceChildren(legend);

          return () => {
            hostElement.replaceChildren();
          };
        }
      })
    }
  });
}

function getTooltip({object}: {object?: unknown}) {
  const datum = object as TreeDatum | null;
  return datum
    ? {
        text: `${datum.label}\nHeight: ${datum.height.toFixed(1)} m\nCanopy ⌀: ${(datum.canopyRadius * 2).toFixed(1)} m`,
        style: {
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '12px'
        }
      }
    : null;
}

function cloneSettings(settings: WildForestSettings): WildForestSettings {
  return {
    render: {...settings.render}
  };
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateForest(): TreeDatum[] {
  const trees: TreeDatum[] = [];

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

  const citrusRng = makeRng(8);
  for (let i = 0; i < 50; i++) {
    const r = citrusRng;
    trees.push({
      position: [-0.01 + r() * 0.04, 51.481 + r() * 0.012],
      type: 'cherry',
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

  const almondRng = makeRng(9);
  for (let i = 0; i < 45; i++) {
    const r = almondRng;
    trees.push({
      position: [-0.065 + r() * 0.03, 51.481 + r() * 0.012],
      type: 'oak',
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
