/** @jsxImportSource preact */
// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {DarkTheme, LightTheme} from '@deck.gl/widgets';
import {ToastWidget, ToolbarWidget, toastManager} from '@deck.gl-community/panels';
import {h, type VNode} from 'preact';
import {
  DeviceManager,
  DeviceTabsWidget,
  HeapMemoryWidget,
  HtmlClusterWidget,
  HtmlOverlayItem,
  HtmlOverlayWidget,
  HtmlTooltipWidget,
  OmniBoxWidget,
  PanWidget,
  ResetViewWidget,
  TimeMeasureWidget,
  YZoomWidget,
  ZoomRangeWidget
} from '@deck.gl-community/widgets';

import '@deck.gl/widgets/stylesheet.css';

import type {PickingInfo} from '@deck.gl/core';

export type WidgetDocsExampleHighlight =
  | 'device-tabs-widget'
  | 'heap-memory-widget'
  | 'pan-widget'
  | 'reset-view-widget'
  | 'y-zoom-widget'
  | 'zoom-range-widget'
  | 'toolbar-widget'
  | 'html-overlay-widget'
  | 'html-cluster-widget'
  | 'html-overlay-item'
  | 'html-tooltip-widget'
  | 'omni-box-widget'
  | 'toast-widget'
  | 'time-measure-widget';

export type WidgetDocsExampleOptions = {
  highlight?: WidgetDocsExampleHighlight;
};

type PointDatum = {
  id: string;
  label: string;
  position: [number, number];
  color: [number, number, number, number];
};

const VIEW = new OrthographicView({id: 'main'});

const INITIAL_VIEW_STATE = {
  target: [0, 0] as [number, number],
  zoom: 0,
  minZoom: -4,
  maxZoom: 5
};

const POINTS: PointDatum[] = [
  {id: 'alpha', label: 'Alpha', position: [-150, 90], color: [14, 165, 233, 220]},
  {id: 'bravo', label: 'Bravo', position: [-65, -75], color: [236, 72, 153, 220]},
  {id: 'charlie', label: 'Charlie', position: [45, 120], color: [34, 197, 94, 220]},
  {id: 'delta', label: 'Delta', position: [135, -40], color: [249, 115, 22, 220]},
  {id: 'echo', label: 'Echo', position: [185, 80], color: [99, 102, 241, 220]}
];

const HIGHLIGHT_LABELS: Record<WidgetDocsExampleHighlight, string> = {
  'device-tabs-widget': 'DeviceTabsWidget',
  'heap-memory-widget': 'HeapMemoryWidget',
  'pan-widget': 'PanWidget',
  'reset-view-widget': 'ResetViewWidget',
  'y-zoom-widget': 'YZoomWidget',
  'zoom-range-widget': 'ZoomRangeWidget',
  'toolbar-widget': 'ToolbarWidget',
  'html-overlay-widget': 'HtmlOverlayWidget',
  'html-cluster-widget': 'HtmlClusterWidget',
  'html-overlay-item': 'HtmlOverlayItem',
  'html-tooltip-widget': 'HtmlTooltipWidget',
  'omni-box-widget': 'OmniBoxWidget',
  'toast-widget': 'ToastWidget',
  'time-measure-widget': 'TimeMeasureWidget'
};

const ROOT_STYLE = {
  position: 'relative',
  height: '100%',
  minHeight: '350px',
  width: '100%',
  overflow: 'hidden',
  borderRadius: '8px',
  background: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 58%, #fef3c7 100%)'
} as const;

const CAPTION_STYLE = {
  position: 'absolute',
  top: '16px',
  right: '16px',
  zIndex: '20',
  maxWidth: '340px',
  padding: '12px 14px',
  borderRadius: '14px',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#111827',
  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)',
  font: '600 13px/1.45 ui-sans-serif, system-ui, sans-serif',
  pointerEvents: 'none'
} as const;

const THEME_TOGGLE_STYLE = {
  position: 'absolute',
  bottom: '12px',
  left: '12px',
  zIndex: '1000',
  padding: '8px 10px',
  borderRadius: '999px',
  border: '1px solid var(--button-stroke, rgba(148, 163, 184, 0.5))',
  background: 'var(--button-background, #fff)',
  color: 'var(--button-text, #111827)',
  boxShadow: 'var(--button-shadow, 0 10px 30px rgba(15, 23, 42, 0.18))',
  cursor: 'pointer',
  font: '700 12px/1 ui-sans-serif, system-ui, sans-serif',
  pointerEvents: 'auto'
} as const;

const OVERLAY_CARD_STYLE = {
  transform: 'translate(-50%, -115%)',
  padding: '8px 10px',
  borderRadius: '12px',
  border: '1px solid rgba(255, 255, 255, 0.65)',
  background: 'rgba(17, 24, 39, 0.9)',
  color: 'white',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.28)',
  minWidth: '112px',
  font: '700 12px/1.3 ui-sans-serif, system-ui, sans-serif'
} as const;

const CLUSTER_STYLE = {
  transform: 'translate(-50%, -115%)',
  width: 36,
  height: 36,
  borderRadius: '999px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px solid rgba(255, 255, 255, 0.86)',
  background: '#111827',
  color: 'white',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.28)',
  font: '800 13px/1 ui-sans-serif, system-ui, sans-serif'
} as const;

const DEVICE_SURFACE_STYLE = {
  position: 'absolute',
  right: '16px',
  bottom: '16px',
  zIndex: '25',
  width: '260px',
  minHeight: '180px',
  borderRadius: '12px',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  background: 'rgba(255, 255, 255, 0.9)',
  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)',
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: 'auto auto 1fr'
} as const;

const DEVICE_SURFACE_HEADER_STYLE = {
  padding: '10px 12px 0',
  color: '#0f172a',
  font: '700 12px/1.4 ui-sans-serif, system-ui, sans-serif'
} as const;

const DEVICE_SURFACE_STATUS_STYLE = {
  padding: '2px 12px 10px',
  color: '#475569',
  font: '600 11px/1.4 ui-sans-serif, system-ui, sans-serif'
} as const;

const DEVICE_SURFACE_CANVAS_STYLE = {
  margin: '0 12px 12px',
  minHeight: '112px',
  borderRadius: '10px',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'linear-gradient(180deg, rgba(226, 232, 240, 0.9), rgba(241, 245, 249, 0.92))',
  overflow: 'hidden',
  position: 'relative'
} as const;

export function mountWidgetDocsExample(
  container: HTMLElement,
  options: WidgetDocsExampleOptions = {}
): () => void {
  const highlight = options.highlight ?? 'pan-widget';
  const rootElement = container.ownerDocument.createElement('div');
  rootElement.className = 'widget-docs-example deck-widget-container';
  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(rootElement, LightTheme);
  container.replaceChildren(rootElement);

  const cleanupThemeToggle = renderDocsThemeToggle(rootElement);
  renderCaption(rootElement, highlight);
  const cleanupDeviceSurface =
    highlight === 'device-tabs-widget' ? renderDeviceTabsExampleSurface(rootElement) : null;

  const tooltipWidget =
    highlight === 'html-tooltip-widget'
      ? new HtmlTooltipWidget({
          id: 'docs-html-tooltip-widget',
          showDelay: 0,
          getTooltip: getPointTooltip
        })
      : null;

  const deck = new Deck({
    parent: rootElement,
    views: VIEW,
    initialViewState: INITIAL_VIEW_STATE,
    controller: {dragMode: 'pan'},
    layers: buildLayers(highlight),
    widgets: [
      ...buildClassicWidgets(highlight),
      ...buildOverlayWidgets(highlight, tooltipWidget),
      ...buildAdvancedWidgets(highlight, target => {
        deck.setProps({
          viewState: {
            ...INITIAL_VIEW_STATE,
            target,
            zoom: 1.1
          }
        });
      })
    ],
    style: {
      position: 'absolute',
      inset: '0',
      background: 'transparent'
    }
  });

  if (highlight === 'toast-widget') {
    toastManager.clear();
  }

  const tooltipFrame =
    tooltipWidget &&
    window.requestAnimationFrame(() => {
      tooltipWidget.onHover({
        object: POINTS[2],
        coordinate: POINTS[2].position,
        x: 0,
        y: 0
      } as never);
    });

  return () => {
    if (tooltipFrame) {
      window.cancelAnimationFrame(tooltipFrame);
    }
    cleanupDeviceSurface?.();
    cleanupThemeToggle();
    toastManager.clear();
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

function getPointTooltip(info: PickingInfo): string | null {
  const point = info.object as PointDatum | null | undefined;
  return point?.label ?? null;
}

function buildClassicWidgets(highlight: WidgetDocsExampleHighlight) {
  switch (highlight) {
    case 'device-tabs-widget':
      return [new DeviceTabsWidget({placement: 'top-left'})];
    case 'heap-memory-widget':
      return [new HeapMemoryWidget({placement: 'top-left', pollIntervalMs: 1000})];
    case 'pan-widget':
      return [new PanWidget({placement: 'top-left', step: 64, style: {margin: '16px 0 0 16px'}})];
    case 'reset-view-widget':
      return [
        new ResetViewWidget({
          placement: 'top-left',
          label: 'Reset example view',
          onResetView: () => {}
        })
      ];
    case 'y-zoom-widget':
      return [new YZoomWidget({placement: 'top-left', minZoom: -4, maxZoom: 5, step: 0.2})];
    case 'zoom-range-widget':
      return [new ZoomRangeWidget({placement: 'top-left', minZoom: -4, maxZoom: 5, step: 0.2})];
    case 'toolbar-widget':
      return [
        new ToolbarWidget({
          placement: 'top-left',
          items: [
            {kind: 'action', id: 'inspect', label: 'Inspect', active: true},
            {
              kind: 'toggle-group',
              id: 'mode',
              label: 'Mode',
              selectedId: 'pan',
              options: [
                {id: 'pan', label: 'Pan'},
                {id: 'select', label: 'Select'}
              ]
            },
            {kind: 'badge', id: 'count', label: `${POINTS.length} points`}
          ]
        })
      ];
    default:
      return [];
  }
}

function buildOverlayWidgets(
  highlight: WidgetDocsExampleHighlight,
  tooltipWidget: HtmlTooltipWidget | null
) {
  switch (highlight) {
    case 'html-overlay-widget':
    case 'html-overlay-item':
      return [
        new HtmlOverlayWidget({
          id: 'docs-html-overlay-widget',
          overflowMargin: 96,
          zIndex: 3,
          items: buildOverlayItems()
        })
      ];
    case 'html-cluster-widget':
      return [new DocsClusterWidget({id: 'docs-html-cluster-widget', zIndex: 4})];
    case 'html-tooltip-widget':
      return tooltipWidget ? [tooltipWidget] : [];
    default:
      return [];
  }
}

function buildAdvancedWidgets(
  highlight: WidgetDocsExampleHighlight,
  onCenterView: (target: [number, number]) => void
) {
  switch (highlight) {
    case 'omni-box-widget':
      return [
        new OmniBoxWidget({
          placement: 'top-left',
          defaultOpen: true,
          placeholder: 'Search example points...',
          getOptions: query =>
            POINTS.filter(point => point.label.toLowerCase().includes(query.toLowerCase())).map(
              point => ({
                id: point.id,
                label: point.label,
                description: `${point.position[0]}, ${point.position[1]}`,
                data: point
              })
            ),
          onSelectOption: option => {
            const point = option.data as PointDatum | undefined;
            if (!point) {
              return;
            }
            onCenterView(point.position);
          },
          onNavigateOption: option => {
            const point = option.data as PointDatum | undefined;
            if (!point) {
              return;
            }
            onCenterView(point.position);
          }
        })
      ];
    case 'toast-widget':
      return [new ToastWidget({placement: 'top-left', showBorder: true})];
    case 'time-measure-widget':
      return [
        new TimeMeasureWidget({
          placement: 'top-left',
          eventViewId: 'main',
          projectionViewId: 'main'
        })
      ];
    default:
      return [];
  }
}

function buildOverlayItems() {
  return POINTS.slice(0, 4).map(point =>
    h(
      HtmlOverlayItem,
      {
        key: point.id,
        coordinates: point.position,
        style: OVERLAY_CARD_STYLE
      },
      [
        h('div', {style: {fontSize: '13px'}}, point.label),
        h('div', {style: {opacity: 0.72, fontWeight: 600, marginTop: '2px'}}, 'HtmlOverlayItem')
      ]
    )
  );
}

class DocsClusterWidget extends HtmlClusterWidget<PointDatum> {
  override getAllObjects() {
    return POINTS;
  }

  override getObjectCoordinates(point: PointDatum): [number, number] {
    return point.position;
  }

  override renderObject(coordinates: number[], point: PointDatum): VNode {
    return h(HtmlOverlayItem, {key: point.id, coordinates, style: OVERLAY_CARD_STYLE}, point.label);
  }

  override renderCluster(coordinates: number[], clusterId: number, pointCount: number): VNode {
    return h(
      HtmlOverlayItem,
      {key: `cluster-${clusterId}`, coordinates, style: CLUSTER_STYLE},
      pointCount
    );
  }
}

function buildLayers(highlight: WidgetDocsExampleHighlight) {
  const scatterplotLayer = new ScatterplotLayer<PointDatum>({
    id: 'widget-docs-points',
    data: POINTS,
    getPosition: point => point.position,
    getFillColor: point => point.color,
    getLineColor: [15, 23, 42, 220],
    getRadius: 18,
    radiusUnits: 'pixels',
    radiusMinPixels: 8,
    radiusMaxPixels: 28,
    stroked: true,
    lineWidthMinPixels: 2,
    pickable: highlight === 'html-tooltip-widget' || highlight === 'toast-widget',
    onClick:
      highlight === 'toast-widget'
        ? ({object}) => {
            if (object) {
              openToastForPoint(object as PointDatum);
            }
          }
        : undefined
  });

  const labelLayer = new TextLayer<PointDatum>({
    id: 'widget-docs-labels',
    data: POINTS,
    getPosition: point => point.position,
    getText: point => (highlight === 'toast-widget' ? 'Click me' : point.label),
    getSize: 13,
    getColor: [15, 23, 42, 230],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'top',
    getPixelOffset: [0, 22],
    pickable: highlight === 'toast-widget',
    onClick:
      highlight === 'toast-widget'
        ? ({object}) => {
            if (object) {
              openToastForPoint(object as PointDatum);
            }
          }
        : undefined
  });

  return [scatterplotLayer, labelLayer];
}

function renderDeviceTabsExampleSurface(rootElement: HTMLElement): () => void {
  const panelElement = rootElement.ownerDocument.createElement('section');
  const headerElement = rootElement.ownerDocument.createElement('div');
  const statusElement = rootElement.ownerDocument.createElement('div');
  const canvasHostElement = rootElement.ownerDocument.createElement('div');

  applyElementStyle(panelElement, DEVICE_SURFACE_STYLE);
  applyElementStyle(headerElement, DEVICE_SURFACE_HEADER_STYLE);
  applyElementStyle(statusElement, DEVICE_SURFACE_STATUS_STYLE);
  applyElementStyle(canvasHostElement, DEVICE_SURFACE_CANVAS_STYLE);

  headerElement.textContent = 'Managed device canvas';
  panelElement.append(headerElement, statusElement, canvasHostElement);
  rootElement.append(panelElement);

  const updateStatus = () => {
    const state = DeviceManager.getState();
    const backendLabel =
      state.deviceType === 'webgpu' ? 'WebGPU' : state.deviceType === 'webgl' ? 'WebGL2' : 'None';

    statusElement.textContent = state.deviceError
      ? `Error: ${state.deviceError}`
      : state.isLoading
        ? `Creating ${backendLabel} device...`
        : `Active backend: ${backendLabel}`;

    const canvas = DeviceManager.reparentCanvas(canvasHostElement);
    if (canvas instanceof HTMLCanvasElement) {
      canvas.style.width = '100%';
      canvas.style.height = '112px';
      canvas.style.display = 'block';
      canvas.style.background =
        'radial-gradient(circle at 20% 20%, rgba(37, 99, 235, 0.45), rgba(15, 23, 42, 0.88))';
    }
  };

  const unsubscribe = DeviceManager.subscribe(() => {
    updateStatus();
  });

  updateStatus();
  DeviceManager.initialize()
    .then(() => {
      updateStatus();
    })
    .catch(() => {});

  return () => {
    unsubscribe();
    DeviceManager.reparentCanvas(null);
    DeviceManager.reset();
    panelElement.remove();
  };
}

function openToastForPoint(point: PointDatum) {
  toastManager.toast({
    type: 'info',
    title: point.label,
    message: `Toast opened from ${point.label}.`
  });
}

function renderCaption(rootElement: HTMLElement, highlight: WidgetDocsExampleHighlight) {
  const captionElement = rootElement.ownerDocument.createElement('div');
  applyElementStyle(captionElement, CAPTION_STYLE);
  captionElement.textContent = `${HIGHLIGHT_LABELS[highlight]} live example`;
  rootElement.append(captionElement);
}

function renderDocsThemeToggle(rootElement: HTMLElement): () => void {
  const buttonElement = rootElement.ownerDocument.createElement('button');
  let themeMode: 'light' | 'dark' = 'light';

  buttonElement.type = 'button';
  buttonElement.textContent = 'Dark theme';
  applyElementStyle(buttonElement, THEME_TOGGLE_STYLE);
  rootElement.append(buttonElement);

  buttonElement.onclick = () => {
    themeMode = themeMode === 'light' ? 'dark' : 'light';
    applyElementStyle(rootElement, themeMode === 'light' ? LightTheme : DarkTheme);
    buttonElement.textContent = themeMode === 'light' ? 'Dark theme' : 'Light theme';
  };

  return () => {
    buttonElement.onclick = null;
    buttonElement.remove();
  };
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
}
