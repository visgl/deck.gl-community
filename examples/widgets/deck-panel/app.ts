// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView, type OrthographicViewState} from '@deck.gl/core';
import {LineLayer, ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {PanelManager} from '@deck.gl-community/panels';
import {DeckPanel, setDeckPropsWithPanels} from '@deck.gl-community/widgets';
import type {DeckPanelSceneProps} from '@deck.gl-community/widgets';

type Point = {position: [number, number]; district: number; name: string};
const DISTRICTS = [
  {name: 'Harbor', center: [-100, 40], color: [56, 189, 248]},
  {name: 'Market', center: [85, 55], color: [251, 191, 36]},
  {name: 'Gardens', center: [0, -90], color: [167, 139, 250]}
] as const;
const POINTS: Point[] = DISTRICTS.flatMap((district, index) =>
  Array.from({length: 9}, (_, i) => ({
    position: [
      district.center[0] + Math.cos(i * 2.4) * (14 + i * 5),
      district.center[1] + Math.sin(i * 2.4) * (14 + i * 5)
    ],
    district: index,
    name: `${district.name} ${i + 1}`
  }))
);
let nextExampleId = 0;

/** Mount the same shared-Deck demonstration used by the gallery and inline docs. */
export function mountDeckPanelExample(container: HTMLElement): () => void {
  const root = document.createElement('div');
  root.className = 'deck-panel-example';
  root.style.cssText =
    'height:100%;min-height:480px;display:flex;flex-direction:column;gap:16px;padding:22px;box-sizing:border-box;background:#0b1220;color:#e2e8f0;font:14px/1.5 system-ui;overflow:auto';
  root.innerHTML = `
    <header><div style="color:#7dd3fc;font-size:11px;letter-spacing:2px;font-weight:700">DECKPANEL / SHARED RENDERING</div>
    <h2 style="font:600 26px/1.25 system-ui;color:#f8fafc;margin:6px 0">One network. Two perspectives.</h2>
    <p style="color:#94a3b8;margin:0">Select a district, then pan and zoom either canvas independently.</p></header>
    <div data-controls style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <label>Layout <select aria-label="Canvas layout"><option value="panels">Two DeckPanels · no root canvas</option><option value="root">Root canvas + DeckPanel</option></select></label>
      <label>District <select aria-label="District">${DISTRICTS.map((d, i) => `<option value="${i}">${d.name}</option>`).join('')}</select></label>
      <button type="button" data-toggle>Hide detail</button>
      <button type="button" data-reset>Reset cameras</button>
    </div>
    <div data-scenes style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));grid-auto-rows:minmax(260px,1fr);gap:16px;flex:1 0 auto;min-height:280px"></div>
    <footer style="display:flex;justify-content:space-between;gap:10px;color:#94a3b8;font-size:12px"><span data-status role="status">Initializing shared Deck…</span><span>27 stops · 3 districts</span></footer>`;
  container.append(root);
  for (const control of root.querySelectorAll<HTMLElement>('select,button')) {
    control.style.cssText =
      'font:inherit;background:#18243a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px 9px;cursor:pointer';
  }
  const layout = root.querySelector<HTMLSelectElement>('[aria-label="Canvas layout"]')!;
  const districtSelect = root.querySelector<HTMLSelectElement>('[aria-label="District"]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-toggle]')!;
  const reset = root.querySelector<HTMLButtonElement>('[data-reset]')!;
  const scenes = root.querySelector<HTMLElement>('[data-scenes]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  let district = 0;
  let detailVisible = true;
  let cleanupRuntime: (() => void) | undefined;
  let selectDistrict = () => {};
  let toggleDetail = () => {};
  let resetCameras = () => {};

  function mountRuntime() {
    cleanupRuntime?.();
    scenes.replaceChildren();
    const withRoot = layout.value === 'root';
    const id = `deck-panel-example-${++nextExampleId}`;
    const overviewHost = createSceneHost(
      'Network overview',
      withRoot ? 'ROOT CANVAS' : 'DECKPANEL'
    );
    const detailHost = createSceneHost('District detail', 'DECKPANEL');
    const rootCanvas = withRoot ? document.createElement('canvas') : null;
    if (rootCanvas) {
      rootCanvas.id = `${id}-overview`;
      rootCanvas.style.cssText = 'width:100%;height:100%;display:block';
      overviewHost.append(rootCanvas);
    }
    const managers: PanelManager[] = [];
    const observers: ResizeObserver[] = [];
    let overviewPanel: DeckPanel | undefined;
    let detailPanel: DeckPanel;
    let detailManager: PanelManager;
    let disposed = false;
    let loaded = false;
    const camera = (): OrthographicViewState => ({target: [0, 0, 0], zoom: -0.25});
    const detailCamera = (): OrthographicViewState => ({
      target: [...DISTRICTS[district].center, 0],
      zoom: 1
    });
    function makeLayers(prefix: string, detail: boolean) {
      const data = detail ? POINTS.filter(point => point.district === district) : POINTS;
      return [
        new LineLayer({
          id: `${prefix}-routes`,
          data: data.filter(point => Number(point.name.split(' ').at(-1)) > 1),
          getSourcePosition: (point: Point) => DISTRICTS[point.district].center,
          getTargetPosition: (point: Point) => point.position,
          getColor: (point: Point) => [...DISTRICTS[point.district].color, 90],
          getWidth: 2
        }),
        new ScatterplotLayer<Point>({
          id: `${prefix}-stops`,
          data,
          pickable: true,
          getPosition: point => point.position,
          getFillColor: point => [
            ...DISTRICTS[point.district].color,
            detail || point.district === district ? 255 : 100
          ],
          getRadius: detail ? 7 : 5,
          radiusUnits: 'pixels',
          onClick: ({object}) => {
            if (object) {
              district = object.district;
              districtSelect.value = String(district);
              selectDistrict();
            }
          }
        }),
        new TextLayer<Point>({
          id: `${prefix}-labels`,
          data: detail ? data : [],
          getPosition: point => point.position,
          getText: point => point.name,
          getSize: 12,
          getColor: [226, 232, 240],
          getPixelOffset: [0, 15],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top'
        })
      ];
    }
    const deck = new Deck({
      parent: overviewHost,
      _canvases: rootCanvas ? [rootCanvas] : [],
      views: rootCanvas
        ? [new OrthographicView({id: 'overview', canvasId: rootCanvas.id, controller: true})]
        : [],
      initialViewState: {overview: camera()},
      layers: rootCanvas ? makeLayers('overview', false) : [],
      getTooltip: ({object}) => object?.name || null,
      onError: error => {
        status.textContent = `Unable to render: ${error.message}`;
      },
      onLoad: () => {
        if (disposed) return;
        loaded = true;
        if (!withRoot) overviewPanel = mountPanel(overviewHost, 'overview', false).panel;
        const detail = mountPanel(detailHost, 'detail', true);
        detailPanel = detail.panel;
        detailManager = detail.manager;
        toggleDetail();
      }
    });
    function mountPanel(host: HTMLElement, viewId: string, detail: boolean) {
      const sceneProps: DeckPanelSceneProps = {
        view: new OrthographicView({id: viewId, controller: true}),
        viewState: detail ? detailCamera() : camera(),
        layers: makeLayers(viewId, detail),
        onViewStateChange: ({viewState}) =>
          panel.setProps({sceneProps: {...panel.props.sceneProps, viewState}})
      };
      const panel = new DeckPanel({
        id: viewId,
        deck,
        theme: 'sleek-dark',
        sceneProps,
        height: Math.max(1, host.clientHeight),
        style: {width: '100%'}
      });
      panel.placement = 'fill';
      const manager = new PanelManager({parentElement: host, components: [panel]});
      managers.push(manager);
      const observer = new ResizeObserver(() =>
        panel.setProps({height: Math.max(1, host.clientHeight)})
      );
      observer.observe(host);
      observers.push(observer);
      return {panel, manager};
    }
    selectDistrict = () => {
      if (!loaded) return;
      if (overviewPanel)
        overviewPanel.setProps({
          sceneProps: {...overviewPanel.props.sceneProps, layers: makeLayers('overview', false)}
        });
      else setDeckPropsWithPanels(deck, {layers: makeLayers('overview', false)});
      detailPanel.setProps({
        sceneProps: {
          ...detailPanel.props.sceneProps,
          layers: makeLayers('detail', true),
          viewState: detailCamera()
        }
      });
      updateStatus();
    };
    toggleDetail = () => {
      if (!loaded) return;
      detailManager.setProps({components: detailVisible ? [detailPanel] : []});
      detailHost.style.visibility = detailVisible ? 'visible' : 'hidden';
      toggle.textContent = detailVisible ? 'Hide detail' : 'Show detail';
      updateStatus();
    };
    resetCameras = () => {
      if (!loaded) return;
      if (overviewPanel)
        overviewPanel.setProps({
          sceneProps: {...overviewPanel.props.sceneProps, viewState: camera()}
        });
      else setDeckPropsWithPanels(deck, {initialViewState: {overview: camera()}});
      detailPanel.setProps({
        sceneProps: {...detailPanel.props.sceneProps, viewState: detailCamera()}
      });
    };
    function updateStatus() {
      status.textContent = `1 shared Deck · ${detailVisible ? 2 : 1} ${detailVisible ? 'canvases' : 'canvas'} · ${withRoot ? 'root + panel' : 'no root canvas'} · ${DISTRICTS[district].name}`;
    }
    cleanupRuntime = () => {
      disposed = true;
      observers.forEach(observer => observer.disconnect());
      managers.forEach(manager => manager.finalize());
      deck.finalize();
    };
  }
  function createSceneHost(title: string, badge: string) {
    const card = document.createElement('section');
    card.style.cssText =
      'border:1px solid #29374d;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;background:#111c2e;min-height:260px';
    card.innerHTML = `<header style="padding:12px 14px;border-bottom:1px solid #29374d;display:flex;justify-content:space-between;align-items:center"><strong>${title}</strong><span style="font-size:10px;letter-spacing:1px;color:#94a3b8">${badge}</span></header>`;
    const host = document.createElement('div');
    host.style.cssText = 'position:relative;flex:1;min-height:200px';
    card.append(host);
    scenes.append(card);
    return host;
  }
  layout.onchange = mountRuntime;
  districtSelect.onchange = () => {
    district = Number(districtSelect.value);
    selectDistrict();
  };
  toggle.onclick = () => {
    detailVisible = !detailVisible;
    toggleDetail();
  };
  reset.onclick = () => resetCameras();
  mountRuntime();
  return () => {
    cleanupRuntime?.();
    root.remove();
  };
}
